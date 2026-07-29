function flattenPlayerArray(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    if (item == null) continue;
    if (Array.isArray(item)) {
      Object.assign(out, flattenPlayerArray(item));
    } else if (typeof item === 'object') {
      Object.assign(out, item);
    }
  }
  return out;
}

export function extractPlayers(containerNode) {
  if (!containerNode) return [];
  const players = [];
  for (const [k, v] of Object.entries(containerNode)) {
    if (k === 'count' || !v || typeof v !== 'object') continue;
    const playerWrapper = v.player;
    if (!playerWrapper) continue;
    const meta = Array.isArray(playerWrapper[0]) ? playerWrapper[0] : playerWrapper;
    players.push(flattenPlayerArray(meta));
  }
  return players;
}

export function playersFromRosterResponse(json) {
  const team = json?.fantasy_content?.team;
  if (!team) return [];
  const rosterSlot = team.find?.(x => x && typeof x === 'object' && !Array.isArray(x) && x.roster);
  const playersNode = rosterSlot?.roster?.['0']?.players ?? rosterSlot?.roster?.players;
  return extractPlayers(playersNode);
}

export function playersFromLeagueResponse(json) {
  const league = json?.fantasy_content?.league;
  if (!Array.isArray(league)) return [];
  const playersSlot = league.find(x => x && typeof x === 'object' && !Array.isArray(x) && x.players);
  return extractPlayers(playersSlot?.players);
}

export function leaguesFromUserResponse(json) {
  const users = json?.fantasy_content?.users;
  const user = users?.['0']?.user;
  if (!user) return [];
  const gamesSlot = user.find?.(x => x && typeof x === 'object' && x.games);
  const games = gamesSlot?.games;
  const out = [];
  if (!games) return out;
  for (const [gk, gv] of Object.entries(games)) {
    if (gk === 'count' || !gv?.game) continue;
    const game = gv.game;
    const leaguesSlot = Array.isArray(game) ? game.find(x => x && typeof x === 'object' && x.leagues) : null;
    const leagues = leaguesSlot?.leagues;
    if (!leagues) continue;
    for (const [lk, lv] of Object.entries(leagues)) {
      if (lk === 'count' || !lv?.league) continue;
      const leagueArr = Array.isArray(lv.league[0]) ? lv.league[0] : lv.league;
      const flat = flattenPlayerArray(leagueArr);
      out.push(flat);
    }
  }
  return out;
}

export function teamsFromUserResponse(json) {
  const users = json?.fantasy_content?.users;
  const user = users?.['0']?.user;
  if (!user) return [];
  const gamesSlot = user.find?.(x => x && typeof x === 'object' && x.games);
  const games = gamesSlot?.games;
  const out = [];
  if (!games) return out;
  for (const [gk, gv] of Object.entries(games)) {
    if (gk === 'count' || !gv?.game) continue;
    const game = gv.game;
    const teamsSlot = Array.isArray(game) ? game.find(x => x && typeof x === 'object' && x.teams) : null;
    const teams = teamsSlot?.teams;
    if (!teams) continue;
    for (const [tk, tv] of Object.entries(teams)) {
      if (tk === 'count' || !tv?.team) continue;
      const teamArr = Array.isArray(tv.team[0]) ? tv.team[0] : tv.team;
      const flat = flattenPlayerArray(teamArr);
      out.push(flat);
    }
  }
  return out;
}

export function playerName(p) {
  return p?.name?.full || `${p?.name?.first || ''} ${p?.name?.last || ''}`.trim();
}

export function playerAsciiName(p) {
  if (p?.name?.ascii_first || p?.name?.ascii_last) {
    return `${p.name.ascii_first || ''} ${p.name.ascii_last || ''}`.trim();
  }
  return playerName(p);
}
