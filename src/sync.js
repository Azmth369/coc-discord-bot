import 'dotenv/config';
import { db, upsert } from './db.js';
import { getClan, getCurrentWar, getWarLog, getCapitalRaids, getCwlGroup, getCwlWar, getPlayer } from './cocApi.js';

const clanTag = process.env.COC_CLAN_TAG;

const iso = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))).toISOString();
};

const warKey = (war) => `${clanTag}:${war.startTime ?? war.createdDate ?? 'unknown'}:${war.endTime ?? 'unknown'}`;

export async function run(job, fn) {
  const started = new Date().toISOString();
  try {
    const details = await fn();
    await db.from('sync_runs').insert({ job, status: 'ok', details, started_at: started, finished_at: new Date().toISOString() });
    return details;
  } catch (error) {
    await db.from('sync_runs').insert({ job, status: 'error', details: { message: error.message }, started_at: started, finished_at: new Date().toISOString() });
    console.error(`[${job}]`, error);
    return null;
  }
}

function attacksAvailableFor(war) {
  if (war.state === 'preparation') return 0;
  return 2;
}

async function normalizeWar(war, key, stateOverride = null) {
  const own = war.clan?.tag === clanTag ? war.clan : null;
  if (!own) return { members: 0, attacks: 0, state: stateOverride ?? war.state };
  const available = attacksAvailableFor(war);
  const members = own.members ?? [];
  const memberRows = members.map(m => ({
    war_key: key, clan_tag: clanTag, player_tag: m.tag, player_name: m.name,
    map_position: m.mapPosition ?? null, attacks_available: available,
    attacks_used: m.attacks?.length ?? 0,
    stars_earned: (m.attacks ?? []).reduce((sum, a) => sum + Number(a.stars ?? 0), 0),
    destruction_percentage: (m.attacks?.length ?? 0)
      ? (m.attacks.reduce((sum, a) => sum + Number(a.destructionPercentage ?? 0), 0) / m.attacks.length) : 0,
    data: m
  }));
  if (memberRows.length) await upsert('war_members', memberRows);

  const attackRows = [];
  for (const m of members) for (const a of m.attacks ?? []) attackRows.push({
    war_key: key, clan_tag: clanTag, attacker_tag: m.tag, attacker_name: m.name,
    defender_tag: a.defenderTag ?? null, defender_name: a.defenderName ?? null,
    stars: a.stars ?? null, destruction_percentage: a.destructionPercentage ?? null,
    order_no: a.order ?? null, attack_time: iso(a.attackTime), data: a
  });
  if (attackRows.length) await upsert('war_attacks', attackRows);
  return { members: memberRows.length, attacks: attackRows.length, state: stateOverride ?? war.state };
}

export async function syncClan(captureSnapshots = false) {
  const clan = await getClan();
  await upsert('clans', [{ tag: clan.tag, data: clan, synced_at: new Date().toISOString() }]);
  const rows = (clan.memberList ?? []).map(m => ({
    tag: m.tag, clan_tag: clan.tag, name: m.name, role: m.role ?? null,
    town_hall_level: m.townHallLevel ?? null, trophies: m.trophies ?? null,
    donations: m.donations ?? null, donations_received: m.donationsReceived ?? null,
    attack_wins: m.attackWins ?? null, defense_wins: m.defenseWins ?? null,
    data: m, updated_at: new Date().toISOString()
  }));
  if (rows.length) await upsert('players', rows);
  if (captureSnapshots) for (const m of clan.memberList ?? []) {
    try { await db.from('player_snapshots').insert({ player_tag: m.tag, clan_tag: clan.tag, data: await getPlayer(m.tag) }); }
    catch (error) { console.error(`[player:${m.tag}]`, error.message); }
  }
  return { members: rows.length, snapshots: captureSnapshots };
}

export async function syncWar() {
  const war = await getCurrentWar();
  if (!war || war.state === 'notInWar') return { state: 'notInWar' };
  const key = warKey(war);
  await upsert('wars', [{ clan_tag: clanTag, war_key: key, state: war.state ?? null, start_time: iso(war.startTime), end_time: iso(war.endTime), data: war, synced_at: new Date().toISOString() }]);
  return { state: war.state, warKey: key, ...(await normalizeWar(war, key)) };
}

export async function syncHistory() {
  const warlog = await getWarLog();
  for (const war of warlog.items ?? []) {
    const key = warKey(war);
    await upsert('wars', [{ clan_tag: clanTag, war_key: key, state: 'warlog', start_time: iso(war.startTime), end_time: iso(war.endTime), data: war, synced_at: new Date().toISOString() }]);
    await normalizeWar({ ...war, state: 'warlog' }, key, 'warlog');
  }
  return { wars: (warlog.items ?? []).length };
}

export async function syncCwl() {
  const group = await getCwlGroup();
  if (!group || group.state === 'notInWar') return { state: group?.state ?? 'notInWar' };
  const seasonKey = `${clanTag}:${group.season ?? new Date().toISOString().slice(0, 7)}`;
  await upsert('cwl_seasons', [{ clan_tag: clanTag, season_key: seasonKey, data: group, synced_at: new Date().toISOString() }]);
  let synced = 0;
  for (const round of group.rounds ?? []) for (const warTag of round.warTags ?? []) {
    if (!warTag || warTag === '#0') continue;
    try {
      const war = await getCwlWar(warTag);
      const own = war.clan?.tag === clanTag ? war.clan : war.opponent;
      const opponent = war.clan?.tag === clanTag ? war.opponent : war.clan;
      await upsert('cwl_wars', [{ season_key: seasonKey, war_tag: warTag, clan_tag: clanTag, opponent_clan_tag: opponent?.tag ?? null, opponent_name: opponent?.name ?? null, state: war.state ?? null, data: war, synced_at: new Date().toISOString() }]);
      if (own) await normalizeWar({ ...war, clan: own, state: war.state ?? 'warlog' }, `cwl:${warTag}`, war.state ?? 'warlog');
      synced++;
    } catch (error) { console.error(`[cwl:${warTag}]`, error.message); }
  }
  return { state: group.state, seasonKey, wars: synced };
}

export async function syncCapital() {
  const data = await getCapitalRaids();
  for (const season of data.items ?? []) {
    const key = `${clanTag}:${season.startTime ?? season.endTime ?? JSON.stringify(season)}`;
    await upsert('capital_raids', [{ clan_tag: clanTag, season_key: key, data: season, synced_at: new Date().toISOString() }]);
  }
  return { seasons: (data.items ?? []).length };
}

export async function syncOnce({ captureSnapshots = false, includeCwl = true } = {}) {
  await run('clan', () => syncClan(captureSnapshots));
  await run('current-war', syncWar);
  await run('war-history', syncHistory);
  await run('capital-raids', syncCapital);
  if (includeCwl) await run('cwl', syncCwl);
}

if (process.argv[1]?.endsWith('/sync.js')) {
  await syncOnce({ captureSnapshots: true });
  console.log('Sync complete');
}
