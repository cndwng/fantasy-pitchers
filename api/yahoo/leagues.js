import { requireUser } from '../_lib/session.js';
import { yahooFetch } from '../_lib/yahoo.js';

export default async function handler(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;

  try {
    const json = await yahooFetch(
      userId,
      '/users;use_login=1/games;game_codes=mlb/teams'
    );
    const teams = parseTeams(json);
    res.status(200).json(teams);
  } catch (e) {
    console.error('leagues error:', e);
    res.status(500).json({ error: e.message || 'leagues_failed' });
  }
}

function flatten(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (item == null) continue;
    if (Array.isArray(item)) Object.assign(out, flatten(item));
    else if (typeof item === 'object') Object.assign(out, item);
  }
  return out;
}

function parseTeams(json) {
  const out = [];
  const user = json?.fantasy_content?.users?.['0']?.user;
  if (!user) return out;
  const gamesSlot = Array.isArray(user) ? user.find(x => x && typeof x === 'object' && x.games) : null;
  const games = gamesSlot?.games;
  if (!games) return out;
  for (const [gk, gv] of Object.entries(games)) {
    if (gk === 'count' || !gv?.game) continue;
    const game = gv.game;
    const teamsSlot = Array.isArray(game) ? game.find(x => x && typeof x === 'object' && x.teams) : null;
    const teams = teamsSlot?.teams;
    if (!teams) continue;
    for (const [tk, tv] of Object.entries(teams)) {
      if (tk === 'count' || !tv?.team) continue;
      const teamArr = Array.isArray(tv.team) && Array.isArray(tv.team[0]) ? tv.team[0] : tv.team;
      const flat = flatten(teamArr);
      const teamKey = flat.team_key;
      const teamName = flat.name;
      const leagueKey = teamKey ? teamKey.split('.t.')[0] : null;
      if (!teamKey || !leagueKey) continue;
      out.push({
        team_key: teamKey,
        team_name: teamName || teamKey,
        league_key: leagueKey,
        league_name: flat.league_name || null
      });
    }
  }
  return out;
}
