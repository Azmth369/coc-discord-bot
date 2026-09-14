import { getPlayers, getCurrentWar, getWarMembers, getWarAttacks, getSnapshots } from './retrieval.js';

export async function currentWarAnalysis() {
  const war = await getCurrentWar();
  if (!war?.war_key) return { state: 'notInWar', members: [], attacks: [] };
  const members = await getWarMembers(war.war_key);
  const attacks = await getWarAttacks(war.war_key);
  return {
    state: war.state,
    war_key: war.war_key,
    start_time: war.start_time,
    end_time: war.end_time,
    members,
    attacks,
    missed_attacks: members.filter(m => Number(m.attacks_available || 0) > Number(m.attacks_used || 0))
  };
}

export async function playerTrend(playerTag, since = null) {
  const snapshots = await getSnapshots(playerTag, since, 1000);
  if (snapshots.length < 2) return { snapshots, changes: null };
  const newest = snapshots[0]?.data ?? {};
  const oldest = snapshots[snapshots.length - 1]?.data ?? {};
  const num = (obj, key) => Number(obj[key] ?? 0);
  return {
    snapshots,
    changes: {
      trophies: num(newest, 'trophies') - num(oldest, 'trophies'),
      donations: num(newest, 'donations') - num(oldest, 'donations'),
      donationsReceived: num(newest, 'donationsReceived') - num(oldest, 'donationsReceived'),
      attackWins: num(newest, 'attackWins') - num(oldest, 'attackWins'),
      defenseWins: num(newest, 'defenseWins') - num(oldest, 'defenseWins')
    }
  };
}

export async function memberLeaderboard(metric = 'donations') {
  const allowed = new Set(['donations', 'donations_received', 'trophies', 'attack_wins', 'defense_wins']);
  const field = allowed.has(metric) ? metric : 'donations';
  const players = await getPlayers({ limit: 100 });
  return players
    .map(p => ({ name: p.name, tag: p.tag, value: Number(p[field] ?? 0) }))
    .sort((a, b) => b.value - a.value);
}
