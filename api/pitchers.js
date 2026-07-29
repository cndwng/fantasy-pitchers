import { getUserId } from './_lib/session.js';
import { db } from './_lib/db.js';

export default async function handler(req, res) {
  const userId = await getUserId(req);
  const supabase = db();

  const sharedPromises = [
    supabase.from('pitchers').select('name, name_norm, team, schedule'),
    supabase.from('col_dates').select('date, day, ord').order('ord')
  ];
  const userPromises = userId
    ? [
        supabase.from('user_pitcher_status').select('pitcher_name_norm, status').eq('user_id', userId),
        supabase.from('user_pitcher_stars').select('pitcher_name_norm').eq('user_id', userId)
      ]
    : [Promise.resolve({ data: [] }), Promise.resolve({ data: [] })];

  const [pitchersRes, datesRes, statusRes, starsRes] = await Promise.all([...sharedPromises, ...userPromises]);

  if (pitchersRes.error) {
    res.status(500).json({ error: pitchersRes.error.message });
    return;
  }

  const roster = [];
  const available = [];
  for (const row of statusRes.data || []) {
    (row.status === 'roster' ? roster : available).push(row.pitcher_name_norm);
  }
  const starred = (starsRes.data || []).map(r => r.pitcher_name_norm);

  res.status(200).json({
    pitchers: pitchersRes.data || [],
    colDates: (datesRes.data || []).map(d => ({ date: d.date, day: d.day })),
    roster,
    available,
    starred,
    authenticated: !!userId
  });
}
