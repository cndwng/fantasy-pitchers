import fetch from 'node-fetch';
import { parse } from 'node-html-parser';

const BIN_ID  = process.env.JSONBIN_BIN_ID;
const BIN_KEY = process.env.JSONBIN_ACCESS_KEY;
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Access-Key': BIN_KEY };

const YAHOO_CLIENT_ID     = process.env.YAHOO_CLIENT_ID;
const YAHOO_CLIENT_SECRET = process.env.YAHOO_CLIENT_SECRET;
const YAHOO_REFRESH_TOKEN = process.env.YAHOO_REFRESH_TOKEN;
const YAHOO_LEAGUE_ID     = process.env.YAHOO_LEAGUE_ID; // optional: pick a specific league

// Lowercase + strip diacritics so "Reynaldo López" matches "Reynaldo Lopez"
function norm(n) {
  return n.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
        const dayMatch  = th.text.trim().match(/^([A-Za-z]+)/);
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

// ── Yahoo Fantasy ─────────────────────────────────────────────────────────────

async function getYahooToken() {
  const res = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: YAHOO_REFRESH_TOKEN }),
  });
  if(!res.ok) throw new Error(`Yahoo token refresh failed: ${res.status}`);
  const data = await res.json();
  if(data.error) throw new Error(`Yahoo token error: ${data.error_description || data.error}`);
  return data.access_token;
}

async function yahooGet(token, path) {
  const res = await fetch(
    `https://fantasysports.yahooapis.com/fantasy/v2/${path}?format=json`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if(!res.ok) throw new Error(`Yahoo API ${res.status}: ${path}`);
  return res.json();
}

// Walk Yahoo's nested users→games→teams structure to collect team_key strings.
function extractTeamKeys(data) {
  const keys = [];
  try {
    const users = data.fantasy_content.users;
    for(let u = 0; u < (users.count || 0); u++) {
      const games = users[String(u)].user[1].games;
      for(let g = 0; g < (games.count || 0); g++) {
        const game      = games[String(g)].game;
        const teamsObj  = game[1].teams;
        for(let t = 0; t < (teamsObj.count || 0); t++) {
          const attrs    = teamsObj[String(t)].team[0];
          const keyAttr  = attrs.find(x => x.team_key);
          const teamKey  = keyAttr?.team_key;
          if(!teamKey) continue;
          // Filter to a specific league if YAHOO_LEAGUE_ID is set
          if(YAHOO_LEAGUE_ID) {
            const m = teamKey.match(/\.l\.(\d+)\./);
            if(!m || m[1] !== YAHOO_LEAGUE_ID) continue;
          }
          keys.push(teamKey);
        }
      }
    }
  } catch(e) {
    console.warn('Could not parse Yahoo team list:', e.message);
  }
  return keys;
}

// Extract pitcher names from a /team/{key}/roster/players response.
function extractRosterPitchers(rosterData) {
  const names = [];
  try {
    const players = rosterData.fantasy_content.team[1].roster['0'].players;
    for(let i = 0; i < (players.count || 0); i++) {
      const attrs   = players[String(i)].player[0];
      let name      = '';
      let positions = [];
      for(const attr of attrs) {
        if(attr.full_name) name = attr.full_name;
        if(Array.isArray(attr.eligible_positions))
          positions = attr.eligible_positions.map(p => p.position);
      }
      if(name && positions.some(p => ['SP', 'RP', 'P'].includes(p)))
        names.push(name);
    }
  } catch(e) {
    console.warn('Could not parse Yahoo roster players:', e.message);
  }
  return names;
}

// Paginate through all available (FA + waiver) pitchers for a given position
// filter ('SP' or 'RP') in the league. Deduplicated via the passed-in Set.
async function fetchAvailableByPosition(token, leagueKey, position, seen) {
  const PAGE = 25;
  let start  = 0;
  while(true) {
    const path = `league/${leagueKey}/players;status=A;position=${position};count=${PAGE};start=${start}`;
    const data = await yahooGet(token, path);
    let count = 0;
    try {
      const playersObj = data.fantasy_content.league[1].players;
      count = playersObj.count || 0;
      for(let i = 0; i < count; i++) {
        const attrs = playersObj[String(i)]?.player?.[0];
        if(!attrs) continue;
        let name = '';
        for(const attr of attrs) { if(attr.full_name) { name = attr.full_name; break; } }
        if(name) seen.add(name);
      }
    } catch(e) {
      console.warn(`Could not parse ${position} available page (start=${start}):`, e.message);
      break;
    }
    if(count < PAGE) break;
    start += PAGE;
  }
}

// Returns { roster, available } of normalized pitcher name arrays,
// or null if Yahoo credentials aren't configured.
async function syncFromYahoo() {
  if(!YAHOO_CLIENT_ID || !YAHOO_CLIENT_SECRET || !YAHOO_REFRESH_TOKEN) {
    console.log('Yahoo credentials not set — skipping sync.');
    return null;
  }

  console.log('Syncing from Yahoo Fantasy...');
  const token     = await getYahooToken();
  const teamsData = await yahooGet(token, 'users;use_login=1/games;game_keys=mlb/teams');
  const teamKeys  = extractTeamKeys(teamsData);

  if(!teamKeys.length) {
    console.warn('No Yahoo Fantasy MLB teams found for this account.');
    return null;
  }
  if(teamKeys.length > 1) {
    console.log(`Found ${teamKeys.length} MLB teams; using ${teamKeys[0]}.`);
    console.log('Set YAHOO_LEAGUE_ID secret to pin a specific league.');
  }

  const teamKey   = teamKeys[0];
  const leagueKey = teamKey.match(/^(\d+\.l\.\d+)/)?.[1];

  // ── Roster ────────────────────────────────────────────────────────────────
  const rosterData     = await yahooGet(token, `team/${teamKey}/roster/players`);
  const rosterPitchers = extractRosterPitchers(rosterData);
  console.log(`Yahoo roster: ${rosterPitchers.length} pitcher(s) — ${rosterPitchers.join(', ')}`);

  // ── Available (FA + waivers) ──────────────────────────────────────────────
  const availableNames = new Set();
  if(leagueKey) {
    // Fetch SP and RP separately so we cover leagues that don't use a generic P slot.
    await fetchAvailableByPosition(token, leagueKey, 'SP', availableNames);
    await fetchAvailableByPosition(token, leagueKey, 'RP', availableNames);
    console.log(`Yahoo available: ${availableNames.size} pitcher(s) in league.`);
  } else {
    console.warn('Could not derive league key from team key — skipping available sync.');
  }

  return {
    roster:    rosterPitchers.map(n => norm(n)),
    available: [...availableNames].map(n => norm(n)),
  };
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

    const existing = await loadBin();

    // Try Yahoo sync; fall back to stored values on any failure.
    const yahooSync = await syncFromYahoo().catch(e => {
      console.warn('Yahoo sync failed (keeping existing data):', e.message);
      return null;
    });

    let roster, available;
    if(yahooSync) {
      roster = yahooSync.roster;

      // Only keep available pitchers who actually have a start in the grid —
      // no point tracking closers or long relievers with no probable start.
      const inGrid = new Set(pitchers.map(p => norm(p.name)));
      available = yahooSync.available.filter(n => inGrid.has(n));
      console.log(`Roster: ${roster.length} pitcher(s) (from Yahoo).`);
      console.log(`Available: ${available.length} pitcher(s) with a start this week (from Yahoo).`);
    } else {
      roster    = existing.roster    || [];
      available = existing.available || [];
      console.log(`Roster: ${roster.length} pitcher(s) (preserved). Available: ${available.length} (preserved).`);
    }

    await saveBin({ pitchers, colDates, roster, available });
    console.log('Done.');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
