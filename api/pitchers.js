import { requireUser } from './_lib/session.js';
import { db } from './_lib/db.js';

export default async function handler(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const supabase = db();
  const [pitchersRes, datesRes, statusRes] = await Promise.all([
    supabase.from('pitchers').select('name, name_norm, team, schedule'),
    supabase.from('col_dates').select('date, day, ord').order('ord'),
    supabase.from('user_pitcher_status').select('pitcher_name_norm, status').eq('user_id', userId)
  ]);

  if (pitchersRes.error) {
    res.status(500).json({ error: pitchersRes.error.message });
    return;
  }

  const roster = [];
  const available = [];
  for (const row of statusRes.data || []) {
    (row.status === 'roster' ? roster : available).push(row.pitcher_name_norm);
  }

  res.status(200).json({
    pitchers: pitchersRes.data || [],
    colDates: (datesRes.data || []).map(d => ({ date: d.date, day: d.day })),
    roster,
    available
  });
}
