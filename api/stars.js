import { requireUser } from './_lib/session.js';
import { db } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const userId = await requireUser(req, res);
  if (!userId) return;

  const body = await readJson(req);
  const name = body?.name_norm;
  const action = body?.action;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name_norm required' });
    return;
  }

  const supabase = db();
  let starred;

  if (action === 'add') {
    const { error } = await supabase
      .from('user_pitcher_stars')
      .upsert({ user_id: userId, pitcher_name_norm: name }, { onConflict: 'user_id,pitcher_name_norm' });
    if (error) return fail(res, error);
    starred = true;
  } else if (action === 'remove') {
    const { error } = await supabase
      .from('user_pitcher_stars')
      .delete()
      .eq('user_id', userId)
      .eq('pitcher_name_norm', name);
    if (error) return fail(res, error);
    starred = false;
  } else {
    const { data: existing, error: selErr } = await supabase
      .from('user_pitcher_stars')
      .select('pitcher_name_norm')
      .eq('user_id', userId)
      .eq('pitcher_name_norm', name)
      .maybeSingle();
    if (selErr) return fail(res, selErr);
    if (existing) {
      const { error } = await supabase
        .from('user_pitcher_stars')
        .delete()
        .eq('user_id', userId)
        .eq('pitcher_name_norm', name);
      if (error) return fail(res, error);
      starred = false;
    } else {
      const { error } = await supabase
        .from('user_pitcher_stars')
        .insert({ user_id: userId, pitcher_name_norm: name });
      if (error) return fail(res, error);
      starred = true;
    }
  }

  res.status(200).json({ name_norm: name, starred });
}

function fail(res, error) {
  console.error('stars error:', error);
  res.status(500).json({ error: error.message });
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
