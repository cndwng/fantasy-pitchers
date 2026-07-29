import { requireUser } from '../_lib/session.js';
import { syncUser } from '../_lib/sync.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    const result = await syncUser(userId);
    res.status(200).json(result);
  } catch (e) {
    console.error('sync error:', e);
    res.status(500).json({ error: e.message || 'sync_failed' });
  }
}
