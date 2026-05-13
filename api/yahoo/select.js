import { requireUser } from '../_lib/session.js';
import { db } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const userId = await requireUser(req, res);
  if (!userId) return;

  const body = await readJson(req);
  const { team_key, league_key, team_name, league_name } = body || {};
  if (!team_key || !league_key) {
    res.status(400).json({ error: 'team_key and league_key required' });
    return;
  }

  const { error } = await db()
    .from('user_selections')
    .upsert(
      {
        user_id: userId,
        team_key,
        league_key,
        team_name: team_name || null,
        league_name: league_name || null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
  if (error) {
    console.error('select error:', error);
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ ok: true });
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
