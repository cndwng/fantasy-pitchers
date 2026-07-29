import fetch from 'node-fetch';
import { parse } from 'node-html-parser';
import { db } from '../_lib/db.js';
import { isAuthorizedCron } from '../_lib/session.js';
import { normalizeName } from '../_lib/normalize.js';

async function fetchFangraphs() {
  const res = await fetch('https://www.fangraphs.com/roster-resource/probables-grid', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`Fangraphs returned ${res.status}`);
  return res.text();
}

function parseTable(html) {
  const root = parse(html);
  const tables = root.querySelectorAll('table');

  for (const table of tables) {
    let dateCols = [];
    for (const row of table.querySelectorAll('tbody tr')) {
      const ths = row.querySelectorAll('th');
      if (ths.length < 4) continue;
      const candidates = [];
      ths.forEach((th, i) => {
        if (i === 0) return;
        const dateMatch = th.innerHTML.match(/(\d+\/\d+)/);
        const dayMatch = th.text.trim().match(/^([A-Za-z]+)/);
        if (dateMatch) candidates.push({ idx: i, date: dateMatch[1], day: dayMatch ? dayMatch[1] : '' });
      });
      if (candidates.length >= 5) { dateCols = candidates; break; }
    }
    if (dateCols.length < 3) continue;

    const pitcherMap = {};
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const teamCell = [...cells].find(c => c.getAttribute('data-stat') === 'Team');
      if (!teamCell) continue;
      const team = teamCell.text.trim();

      dateCols.forEach(({ idx, date }) => {
        const cell = cells[idx];
        if (!cell) return;
        const anchor = cell.querySelector('a');
        if (!anchor) return;
        const name = anchor.text.trim().replace(/\s*\([LRS]\)\s*$/, '');
        if (!name || name.length < 3) return;
        const opp = cell.childNodes[0]?.text?.trim() || '';
        const key = normalizeName(name);
        if (!key) return;
        if (!pitcherMap[key]) pitcherMap[key] = { name, team, schedule: {} };
        pitcherMap[key].schedule[date] = opp || '?';
      });
    }

    if (!Object.keys(pitcherMap).length) continue;
    return {
      pitchers: Object.entries(pitcherMap).map(([name_norm, p]) => ({ name_norm, ...p })),
      colDates: dateCols.map(c => ({ date: c.date, day: c.day }))
    };
  }

  throw new Error('Could not find pitcher table in Fangraphs HTML');
}

export default async function handler(req, res) {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const html = await fetchFangraphs();
    const { pitchers, colDates } = parseTable(html);
    const sb = db();

    await sb.from('col_dates').delete().neq('date', '__never__');
    if (colDates.length) {
      const { error } = await sb.from('col_dates').insert(
        colDates.map((c, i) => ({ date: c.date, day: c.day, ord: i }))
      );
      if (error) throw error;
    }

    const now = new Date().toISOString();
    const rows = pitchers.map(p => ({
      name_norm: p.name_norm,
      name: p.name,
      team: p.team,
      schedule: p.schedule,
      updated_at: now
    }));
    if (rows.length) {
      const { error } = await sb.from('pitchers').upsert(rows, { onConflict: 'name_norm' });
      if (error) throw error;
    }

    res.status(200).json({ pitchers: rows.length, days: colDates.length });
  } catch (e) {
    console.error('fetch-pitchers error:', e);
    res.status(500).json({ error: e.message });
  }
}
