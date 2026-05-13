import { db } from '../_lib/db.js';
import { isAuthorizedCron } from '../_lib/session.js';
import { syncUser } from '../_lib/sync.js';

const DELAY_MS = 250;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const { data: users, error } = await db().from('users').select('id');
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const results = [];
  for (const u of users || []) {
    try {
      const r = await syncUser(u.id);
      results.push({ user_id: u.id, ...r });
    } catch (e) {
      console.error(`sync failed for ${u.id}:`, e);
      results.push({ user_id: u.id, error: e.message });
    }
    await sleep(DELAY_MS);
  }
  res.status(200).json({ count: results.length, results });
}
