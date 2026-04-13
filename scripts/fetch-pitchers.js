import fetch from 'node-fetch';
import { parse } from 'node-html-parser';

const BIN_ID  = process.env.JSONBIN_BIN_ID;
const BIN_KEY = process.env.JSONBIN_ACCESS_KEY;
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Access-Key': BIN_KEY };

function norm(n) { return n.trim().toLowerCase(); }

// ── Fetch Fangraphs ──────────────────────────────────────────────────────────

async function fetchFangraphs() {
  console.log('Fetching Fangraphs...');
  const res = await fetch('https://www.fangraphs.com/roster-resource/probables-grid', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });
  if(!res.ok) throw new Error(`Fangraphs returned ${res.status}`);
  return res.text();
}

// ── Parse table ──────────────────────────────────────────────────────────────

function parseTable(html) {
  const root = parse(html);
  const tables = root.querySelectorAll('table');

  for(const table of tables) {
    // Find a tbody row with date headers (e.g. "Mon\n4/13")
    let dateCols = [];
    for(const row of table.querySelectorAll('tbody tr')) {
      const ths = row.querySelectorAll('th');
      if(ths.length < 4) continue;
      const candidates = [];
      ths.forEach((th, i) => {
        if(i === 0) return;
        const dateMatch = th.innerHTML.match(/(\d+\/\d+)/);
        const dayMatch  = th.text.trim().match(/^(\w+)/);
        if(dateMatch) candidates.push({ idx: i, date: dateMatch[1], day: dayMatch ? dayMatch[1] : '' });
      });
      if(candidates.length >= 5) { dateCols = candidates; break; }
    }
    if(dateCols.length < 3) continue;

    const pitcherMap = {};
    for(const row of table.querySelectorAll('tbody tr')) {
      const cells = row.querySelectorAll('td');
      if(cells.length < 2) continue;
      const teamCell = [...cells].find(c => c.getAttribute('data-stat') === 'Team');
      if(!teamCell) continue;
      const team = teamCell.text.trim();

      dateCols.forEach(({ idx, date }) => {
        const cell = cells[idx];
        if(!cell) return;
        const anchor = cell.querySelector('a');
        if(!anchor) return;
        const name = anchor.text.trim().replace(/\s*\([LRS]\)\s*$/, '');
        if(!name || name.length < 3) return;
        const opp = cell.childNodes[0]?.text?.trim() || '';
        const key = norm(name);
        if(!pitcherMap[key]) pitcherMap[key] = { name, team, schedule: {} };
        pitcherMap[key].schedule[date] = opp || '?';
      });
    }

    if(!Object.keys(pitcherMap).length) continue;
    console.log(`Parsed ${Object.keys(pitcherMap).length} pitchers across ${dateCols.length} days.`);
    return {
      pitchers: Object.values(pitcherMap),
      colDates: dateCols.map(c => ({ date: c.date, day: c.day }))
    };
  }

  throw new Error('Could not find pitcher table in Fangraphs HTML');
}

// ── JSONBin ──────────────────────────────────────────────────────────────────

async function loadBin() {
  const res = await fetch(BIN_URL + '/latest', { headers: { 'X-Access-Key': BIN_KEY } });
  if(!res.ok) throw new Error(`JSONBin load failed: ${res.status}`);
  const json = await res.json();
  return json.record;
}

async function saveBin(data) {
  const res = await fetch(BIN_URL, { method: 'PUT', headers: HEADERS, body: JSON.stringify(data) });
  if(!res.ok) throw new Error(`JSONBin save failed: ${res.status}`);
  console.log('Saved to JSONBin.');
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const html = await fetchFangraphs();
    const { pitchers, colDates } = parseTable(html);

    // Load existing bin so we preserve roster + available
    const existing = await loadBin();
    console.log(`Preserving ${existing.roster?.length || 0} roster, ${existing.available?.length || 0} available entries.`);

    await saveBin({
      pitchers,
      colDates,
      roster:    existing.roster    || [],
      available: existing.available || []
    });

    console.log('Done.');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
