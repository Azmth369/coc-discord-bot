import 'dotenv/config';
import { db, upsert } from './db.js';
import { getClan, getCurrentWar, getWarLog, getCapitalRaids, getPlayer } from './cocApi.js';

const clanTag = process.env.COC_CLAN_TAG;
if (!clanTag) throw new Error('COC_CLAN_TAG is required');

const now = () => new Date().toISOString();

function iso(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})\.?(\d{3})?Z?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function run(job, fn) {
  const started = now();
  try {
    const details = await fn();
    await db.from('sync_runs').insert({
      job,
      status: 'ok',
      details,
      started_at: started,
      finished_at: now()
    });
    return details;
  } catch (error) {
    await db.from('sync_runs').insert({
      job,
      status: 'error',
      details: { message: error instanceof Error ? error.message : String(error) },
      started_at: started,
      finished_at: now()
    });
    console.error(`[${job}]`, error);
    return null;
  }
}

async function syncClan({ snapshots = false } = {}) {
  const clan = await getClan();
  const syncedAt = now();

  await upsert('clans', [{
    tag: clan.tag,
    data: clan,
    synced_at: syncedAt
  }]);

  const rows = (clan.memberList ?? []).map((member) => ({
    tag: member.tag,
    clan_tag: clan.tag,
    name: member.name,
    role: member.role ?? null,
    town_hall_level: member.townHallLevel ?? null,
    trophies: member.trophies ?? null,
    donations: member.donations ?? null,
    donations_received: member.donationsReceived ?? null,
    attack_wins: member.attackWins ?? null,
    defense_wins: member.defenseWins ?? null,
    data: member,
    updated_at: syncedAt
  }));

  if (rows.length) await upsert('players', rows);

  if (snapshots) {
    for (const member of clan.memberList ?? []) {
      try {
        const player = await getPlayer(member.tag);
        await db.from('player_snapshots').insert({
          player_tag: member.tag,
          clan_tag: clan.tag,
          captured_at: syncedAt,
          data: player
        });
      } catch (error) {
        console.error(`[player-snapshot:${member.tag}]`, error);
      }
    }
  }

  return { members: rows.length, snapshots };
}

async function syncWar() {
  const war = await getCurrentWar();
  if (!war || war.state === 'notInWar') return { state: 'notInWar' };

  const key = `${clanTag}:${war.startTime ?? 'unknown'}:${war.endTime ?? 'unknown'}`;
  await upsert('wars', [{
    clan_tag: clanTag,
    war_key: key,
    state: war.state ?? null,
    start_time: iso(war.startTime),
    end_time: iso(war.endTime),
    data: war,
    synced_at: now()
  }]);

  return { state: war.state, warKey: key };
}

async function syncHistory() {
  const warlog = await getWarLog();
  const items = warlog.items ?? [];

  for (const war of items) {
    const key = `${clanTag}:${war.endTime ?? war.createdDate ?? JSON.stringify(war)}`;
    await upsert('wars', [{
      clan_tag: clanTag,
      war_key: key,
      state: 'warlog',
      end_time: iso(war.endTime),
      data: war,
      synced_at: now()
    }]);
  }

  return { wars: items.length };
}

async function syncCapital() {
  const result = await getCapitalRaids();
  const items = result.items ?? [];

  for (const season of items) {
    const key = `${clanTag}:${season.startTime ?? season.endTime ?? JSON.stringify(season)}`;
    await upsert('capital_raids', [{
      clan_tag: clanTag,
      season_key: key,
      data: season,
      synced_at: now()
    }]);
  }

  return { seasons: items.length };
}

export async function syncOnce(options = {}) {
  const snapshotRequested = Boolean(options.snapshots);
  const results = {};

  results.clan = await run('clan', () => syncClan({ snapshots: snapshotRequested }));
  results.currentWar = await run('current-war', syncWar);
  results.warHistory = await run('war-history', syncHistory);
  results.capitalRaids = await run('capital-raids', syncCapital);

  return results;
}

if (process.argv[1]?.endsWith('/sync.js')) {
  await syncOnce({ snapshots: process.env.SNAPSHOT_ON_SYNC === 'true' });
  console.log('Sync complete');
}
