import { db } from './db.js';
import { yahooFetch } from './yahoo.js';
import { playersFromRosterResponse, playersFromLeagueResponse, playerAsciiName } from './yahoo-parse.js';
import { normalizeName } from './normalize.js';

const FA_PAGE_SIZE = 25;

function isPitcher(p) {
  if (p?.position_type === 'P') return true;
  const eligible = p?.eligible_positions;
  if (Array.isArray(eligible)) {
    for (const slot of eligible) {
      const pos = slot?.position || slot;
      if (pos === 'P' || pos === 'SP' || pos === 'RP') return true;
    }
  }
  return false;
}

async function fetchRoster(userId, teamKey) {
  const json = await yahooFetch(userId, `/team/${teamKey}/roster`);
  return playersFromRosterResponse(json).filter(isPitcher);
}

async function fetchFreeAgentPitchers(userId, leagueKey) {
  const out = [];
  let start = 0;
  for (let page = 0; page < 20; page++) {
    const json = await yahooFetch(
      userId,
      `/league/${leagueKey}/players;status=FA;position=P;start=${start};count=${FA_PAGE_SIZE}`
    );
    const players = playersFromLeagueResponse(json);
    if (!players.length) break;
    out.push(...players);
    if (players.length < FA_PAGE_SIZE) break;
    start += FA_PAGE_SIZE;
  }
  return out;
}

function toStatusRow(userId, status, p) {
  const name = playerAsciiName(p);
  const norm = normalizeName(name);
  if (!norm) return null;
  return {
    user_id: userId,
    pitcher_name_norm: norm,
    status,
    yahoo_player_key: p.player_key || null,
    synced_at: new Date().toISOString()
  };
}

export async function syncUser(userId) {
  const supabase = db();
  const { data: sel, error: selErr } = await supabase
    .from('user_selections')
    .select('league_key, team_key')
    .eq('user_id', userId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!sel) return { roster: 0, available: 0, skipped: 'no_selection' };

  const [rosterPlayers, faPlayers] = await Promise.all([
    fetchRoster(userId, sel.team_key),
    fetchFreeAgentPitchers(userId, sel.league_key)
  ]);

  const rows = [];
  const seen = new Set();
  for (const p of rosterPlayers) {
    const r = toStatusRow(userId, 'roster', p);
    if (r && !seen.has(r.pitcher_name_norm)) {
      rows.push(r);
      seen.add(r.pitcher_name_norm);
    }
  }
  for (const p of faPlayers) {
    const r = toStatusRow(userId, 'available', p);
    if (r && !seen.has(r.pitcher_name_norm)) {
      rows.push(r);
      seen.add(r.pitcher_name_norm);
    }
  }

  const { error: delErr } = await supabase.from('user_pitcher_status').delete().eq('user_id', userId);
  if (delErr) throw delErr;
  if (rows.length) {
    const { error: insErr } = await supabase.from('user_pitcher_status').insert(rows);
    if (insErr) throw insErr;
  }

  const roster = rows.filter(r => r.status === 'roster').length;
  const available = rows.filter(r => r.status === 'available').length;
  return { roster, available, synced_at: new Date().toISOString() };
}
