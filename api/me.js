import { getUserId } from './_lib/session.js';
import { db } from './_lib/db.js';

export default async function handler(req, res) {
  const userId = await getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  const supabase = db();
  const [{ data: user }, { data: selection }] = await Promise.all([
    supabase.from('users').select('id, email, display_name').eq('id', userId).maybeSingle(),
    supabase
      .from('user_selections')
      .select('league_key, team_key, league_name, team_name, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
  ]);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  res.status(200).json({ user, selection: selection || null });
}
