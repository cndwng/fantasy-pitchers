import { exchangeCode, storeInitialTokens, fetchUserProfile } from '../../_lib/yahoo.js';
import { signSession, setSessionCookie, readStateCookie } from '../../_lib/session.js';
import { db } from '../../_lib/db.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) return redirect(res, `/?auth_error=${encodeURIComponent(error)}`);
    if (!code || !state) return redirect(res, '/?auth_error=missing_code');

    const expected = readStateCookie(req);
    if (!expected || expected !== state) return redirect(res, '/?auth_error=bad_state');

    const tokens = await exchangeCode(code);
    const profile = await fetchUserProfile(tokens.access_token);
    const yahooGuid = profile.sub;
    if (!yahooGuid) return redirect(res, '/?auth_error=no_guid');

    const supabase = db();
    const { data: user, error: upsertErr } = await supabase
      .from('users')
      .upsert(
        {
          yahoo_guid: yahooGuid,
          email: profile.email || null,
          display_name: profile.name || profile.given_name || null
        },
        { onConflict: 'yahoo_guid' }
      )
      .select('id')
      .single();
    if (upsertErr) throw upsertErr;

    await storeInitialTokens(user.id, tokens);

    const sessionToken = await signSession(user.id);
    setSessionCookie(res, sessionToken);
    redirect(res, '/');
  } catch (e) {
    console.error('Yahoo callback error:', e);
    redirect(res, `/?auth_error=${encodeURIComponent(e.message || 'unknown')}`);
  }
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}
