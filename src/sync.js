import 'dotenv/config';
import { db, upsert } from './db.js';
import { getClan, getCurrentWar, getWarLog, getCapitalRaids, getPlayer } from './cocApi.js';

const clanTag = process.env.COC_CLAN_TAG;

const iso = (s) => {
  if (!s) return null;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)) - 1, d = Number(s.slice(6, 8));
  const h = Number(s.slice(9, 11)), min = Number(s.slice(11, 13)), sec = Number(s.slice(13, 15));
  return new Date(Date.UTC(y, m, d, h, min, sec)).toISOString();
};

async function run(job, fn) {
  const started = new Date().toISOString();
  try {
    const details = await fn();
    await db.from('sync_runs').insert({ job, status: 'ok', details, started_at: started, finished_at: new Date().toISOString() });
  } catch (error) {
    await db.from('sync_runs').insert({ job, status: 'error', details: { message: error.message }, started_at: started, finished_at: new Date().toISOString() });
    console.error(`[${job}]`, error);
  }
}

async function syncClan() {
  const clan = await getClan();
  await upsert('clans', [{ tag: clan.tag, data: clan, synced_at: new Date().toISOString() }]);

  const rows = (clan.memberList ?? []).map((m) => ({
    tag: m.tag, clan_tag: clan.tag, name: m.name, role: m.role ?? null,
    town_hall_level: m.townHallLevel ?? null, trophies: m.trophies ?? null,
    donations: m.donations ?? null, donations_received: m.donationsReceived ?? null,
    attack_wins: m.attackWins ?? null, defense_wins: m.defenseWins ?? null,
    data: m, updated_at: new Date().toISOString()
  }));
  if (rows.length) await upsert('players', rows);

  for (const m of clan.memberList ?? []) {
    const player = await getPlayer(m.tag);
    await db.from('player_snapshots').insert({ player_tag: m.tag, clan_tag: clan.tag, data: player });
  }
  return { members: rows.length };
}

async function syncWar() {
  const war = await getCurrentWar();
  if (!war || war.state === 'notInWar') return { state: 'notInWar' };
  const key = `${clanTag}:${war.startTime ?? 'unknown'}:${war.endTime ?? 'unknown'}`;
  await upsert('wars', [{
    clan_tag: clanTag, war_key: key, state: war.state ?? null,
    start_time: iso(war.startTime), end_time: iso(war.endTime), data: war, synced_at: new Date().toISOString()
  }]);
  return { state: war.state, warKey: key };
}

async function syncHistory() {
  const warlog = await getWarLog();
  for (const war of warlog.items ?? []) {
    const key = `${clanTag}:${war.endTime ?? war.createdDate ?? JSON.stringify(war)}`;
    await upsert('wars', [{ clan_tag: clanTag, war_key: key, state: 'warlog', end_time: iso(war.endTime), data: war, synced_at: new Date().toISOString() }]);
  }
  return { wars: (warlog.items ?? []).length };
}

async function syncCapital() {
  const data = await getCapitalRaids();
  for (const season of data.items ?? []) {
    const key = `${clanTag}:${season.startTime ?? season.endTime ?? JSON.stringify(season)}`;
    await upsert('capital_raids', [{ clan_tag: clanTag, season_key: key, data: season, synced_at: new Date().toISOString() }]);
  }
  return { seasons: (data.items ?? []).length };
}

export async function syncOnce() {
  await run('clan', syncClan);
  await run('current-war', syncWar);
  await run('war-history', syncHistory);
  await run('capital-raids', syncCapital);
}

if (process.argv[1]?.endsWith('/sync.js')) {
  await syncOnce();
  console.log('Sync complete');
}
