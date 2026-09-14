import 'dotenv/config';
import { db, upsert } from './db.js';
import { getClan, getCurrentWar, getWarLog, getCapitalRaids, getCwlGroup, getCwlWar, getPlayer } from './cocApi.js';

const clanTag = process.env.COC_CLAN_TAG;
const now = () => new Date().toISOString();

const iso = s => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
};

const warKey = war => `${clanTag}:${war.startTime ?? war.createdDate ?? 'unknown'}:${war.endTime ?? 'unknown'}`;

export async function run(job, fn) {
  const started = now();
  try {
    const details = await fn();
    await db.from('sync_runs').insert({ job, status: 'ok', details, started_at: started, finished_at: now() });
    return details;
  } catch (error) {
    await db.from('sync_runs').insert({ job, status: 'error', details: { message: error.message }, started_at: started, finished_at: now() });
    console.error(`[${job}]`, error);
    return null;
  }
}

function attacksAvailableFor(state) {
  return state === 'preparation' ? 0 : 2;
}

async function saveWarAttackLog(war, tournamentType, tournamentId, tournamentName = null, seasonKey = null) {
  const own = war.clan?.tag === clanTag ? war.clan : null;
  const opponent = war.clan?.tag === clanTag ? war.opponent : war.clan;
  if (!own) return 0;
  const label = tournamentName ?? `${tournamentType === 'cwl' ? 'CWL War' : 'Clan War'}${opponent?.name ? ` vs ${opponent.name}` : ''}`;

  const rows = [];
  for (const m of own.members ?? []) {
    for (const a of m.attacks ?? []) {
      const orderNo = Number(a.order ?? 0) || null;
      const attackKey = `${tournamentType}:${tournamentId}:${m.tag}:${orderNo ?? `${a.defenderTag ?? 'unknown'}:${a.stars ?? 0}:${a.destructionPercentage ?? 0}`}`;
      rows.push({
        attack_key: attackKey,
        clan_tag: clanTag,
        tournament_type: tournamentType,
        tournament_id: String(tournamentId),
        tournament_name: label,
        season_key: seasonKey,
        war_key: tournamentType === 'war' ? String(tournamentId) : tournamentType === 'cwl' ? `cwl:${tournamentId}` : null,
        opponent_clan_tag: opponent?.tag ?? null,
        opponent_clan_name: opponent?.name ?? null,
        attacker_tag: m.tag,
        attacker_name: m.name,
        defender_tag: a.defenderTag ?? null,
        defender_name: a.defenderName ?? opponent?.members?.find(x => x.tag === a.defenderTag)?.name ?? null,
        district_id: null,
        district_name: null,
        attack_number: null,
        order_no: orderNo,
        stars: a.stars ?? null,
        destruction_percentage: a.destructionPercentage ?? null,
        duration_seconds: a.duration ?? null,
        attack_time: iso(a.attackTime),
        observed_at: now(),
        data: a
      });
    }
  }
  if (rows.length) await upsert('attack_log', rows);
  return rows.length;
}

async function normalizeWar(war, key, stateOverride = null, tournamentType = 'war', tournamentId = key, tournamentName = null, seasonKey = null) {
  const own = war.clan?.tag === clanTag ? war.clan : null;
  const opponent = war.clan?.tag === clanTag ? war.opponent : null;
  if (!own) return { members: 0, attacks: 0 };
  const state = stateOverride ?? war.state;
  const available = attacksAvailableFor(state);
  const ownMembers = own.members ?? [];
  const opponentByTag = new Map((opponent?.members ?? []).map(m => [m.tag, m]));
  const memberRows = ownMembers.map(m => ({
    war_key: key, clan_tag: clanTag, player_tag: m.tag, player_name: m.name,
    map_position: m.mapPosition ?? null, attacks_available: available,
    attacks_used: m.attacks?.length ?? 0,
    stars_earned: (m.attacks ?? []).reduce((sum, a) => sum + Number(a.stars ?? 0), 0),
    destruction_percentage: (m.attacks?.length ?? 0) ? m.attacks.reduce((sum, a) => sum + Number(a.destructionPercentage ?? 0), 0) / m.attacks.length : 0,
    data: m
  }));
  if (memberRows.length) await upsert('war_members', memberRows);
  const attackRows = [];
  for (const m of ownMembers) for (const a of m.attacks ?? []) {
    const defender = opponentByTag.get(a.defenderTag);
    attackRows.push({
      war_key: key, clan_tag: clanTag, attacker_tag: m.tag, attacker_name: m.name,
      defender_tag: a.defenderTag ?? null, defender_name: a.defenderName ?? defender?.name ?? null,
      stars: a.stars ?? null, destruction_percentage: a.destructionPercentage ?? null,
      order_no: a.order ?? attackRows.length + 1, attack_time: iso(a.attackTime), data: a
    });
  }
  if (attackRows.length) await upsert('war_attacks', attackRows);
  const logged = await saveWarAttackLog(war, tournamentType, tournamentId, tournamentName, seasonKey);
  return { members: memberRows.length, attacks: attackRows.length, attackLog: logged, state };
}

export async function syncClan(captureSnapshots = false) {
  const clan = await getClan();
  await upsert('clans', [{ tag: clan.tag, data: clan, synced_at: now() }]);
  const rows = (clan.memberList ?? []).map(m => ({
    tag: m.tag, clan_tag: clan.tag, name: m.name, role: m.role ?? null,
    town_hall_level: m.townHallLevel ?? null, trophies: m.trophies ?? null,
    donations: m.donations ?? null, donations_received: m.donationsReceived ?? null,
    attack_wins: m.attackWins ?? null, defense_wins: m.defenseWins ?? null,
    data: m, updated_at: now()
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
  await upsert('wars', [{ clan_tag: clanTag, war_key: key, state: war.state ?? null, start_time: iso(war.startTime), end_time: iso(war.endTime), data: war, synced_at: now() }]);
  return { state: war.state, warKey: key, ...(await normalizeWar(war, key, null, 'war', key)) };
}

export async function syncHistory() {
  const warlog = await getWarLog();
  for (const war of warlog.items ?? []) {
    const key = warKey(war);
    await upsert('wars', [{ clan_tag: clanTag, war_key: key, state: 'warlog', start_time: iso(war.startTime), end_time: iso(war.endTime), data: war, synced_at: now() }]);
    await normalizeWar({ ...war, state: 'warlog' }, key, 'warlog', 'war', key);
  }
  return { wars: (warlog.items ?? []).length };
}

export async function syncCwl() {
  let group;
  try { group = await getCwlGroup(); }
  catch (error) {
    if (error.status === 404 && /notFound/i.test(error.message)) return { state: 'notInCwl' };
    throw error;
  }
  if (!group || group.state === 'notInWar') return { state: group?.state ?? 'notInCwl' };
  const seasonKey = `${clanTag}:${group.season ?? new Date().toISOString().slice(0, 7)}`;
  await upsert('cwl_seasons', [{ clan_tag: clanTag, season_key: seasonKey, data: group, synced_at: now() }]);
  let synced = 0;
  let attackLog = 0;
  for (let roundNo = 0; roundNo < (group.rounds ?? []).length; roundNo++) {
    const round = group.rounds[roundNo];
    for (const warTag of round.warTags ?? []) {
      if (!warTag || warTag === '#0') continue;
      try {
        const war = await getCwlWar(warTag);
        const own = war.clan?.tag === clanTag ? war.clan : war.opponent;
        const opponent = war.clan?.tag === clanTag ? war.opponent : war.clan;
        await upsert('cwl_rounds', [{ clan_tag: clanTag, season_key: seasonKey, round_no: roundNo + 1, opponent_tag: opponent?.tag ?? null, opponent_name: opponent?.name ?? null, state: war.state ?? null, data: round }]);
        await upsert('cwl_wars', [{ season_key: seasonKey, war_tag: warTag, clan_tag: clanTag, opponent_clan_tag: opponent?.tag ?? null, opponent_name: opponent?.name ?? null, state: war.state ?? null, data: war, synced_at: now() }]);
        if (own) {
          const result = await normalizeWar({ ...war, clan: own, state: war.state ?? 'warlog' }, `cwl:${warTag}`, war.state ?? 'warlog', 'cwl', warTag, opponent?.name ?? null, seasonKey);
          attackLog += result.attackLog ?? 0;
        }
        synced++;
      } catch (error) { console.error(`[cwl:${warTag}]`, error.message); }
    }
  }
  return { state: group.state, seasonKey, wars: synced, attackLog };
}

function flattenCapitalAttacks(season, seasonKey) {
  const rows = [];
  for (const entry of season.attackLog ?? []) {
    const opponent = entry.defender ?? {};
    for (const district of entry.districts ?? []) {
      const districtId = district.id ?? district.districtId ?? null;
      const districtName = district.name ?? district.districtName ?? null;
      for (let index = 0; index < (district.attacks ?? []).length; index++) {
        const a = district.attacks[index];
        const attacker = a.attacker ?? {};
        const attackerTag = attacker.tag ?? a.attackerTag ?? null;
        if (!attackerTag) continue;
        const attackNumber = index + 1;
        rows.push({
          attack_key: `capital:${seasonKey}:${attackerTag}:${districtId ?? districtName ?? 'unknown'}:${attackNumber}`,
          clan_tag: clanTag,
          tournament_type: 'capital',
          tournament_id: seasonKey,
          tournament_name: 'Clan Capital Raid Weekend',
          season_key: seasonKey,
          war_key: null,
          opponent_clan_tag: opponent.tag ?? null,
          opponent_clan_name: opponent.name ?? null,
          attacker_tag: attackerTag,
          attacker_name: attacker.name ?? null,
          defender_tag: districtId != null ? String(districtId) : null,
          defender_name: districtName,
          district_id: districtId,
          district_name: districtName,
          attack_number: attackNumber,
          order_no: null,
          stars: a.stars ?? null,
          destruction_percentage: a.destructionPercent ?? a.destructionPercentage ?? null,
          duration_seconds: a.duration ?? null,
          attack_time: iso(a.attackTime),
          observed_at: now(),
          data: { ...a, district: district }
        });
      }
    }
  }
  return rows;
}

export async function syncCapital() {
  const data = await getCapitalRaids();
  let attackLog = 0;
  for (const season of data.items ?? []) {
    const key = `${clanTag}:${season.startTime ?? season.endTime ?? JSON.stringify(season)}`;
    await upsert('capital_raids', [{ clan_tag: clanTag, season_key: key, data: season, synced_at: now() }]);
    const rows = flattenCapitalAttacks(season, key);
    if (rows.length) { await upsert('attack_log', rows); attackLog += rows.length; }
  }
  return { seasons: (data.items ?? []).length, attackLog };
}

export async function syncOnce({ captureSnapshots = false, includeCwl = true } = {}) {
  await run('clan', () => syncClan(captureSnapshots));
  await run('current-war', syncWar);
  await run('war-history', syncHistory);
  await run('capital-raids', syncCapital);
  if (includeCwl) await run('cwl', syncCwl);
}

if (process.argv[1]?.endsWith('/sync.js')) { await syncOnce({ captureSnapshots: true }); console.log('Sync complete'); }
