import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_READONLY_KEY;
if (!process.env.SUPABASE_URL || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_READONLY_KEY) are required');
const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false } });
const bounded = (value, fallback, max) => Math.min(Math.max(Number(value || fallback), 1), max);

export async function getPlayers(filters = {}) {
  let q = db.from('players').select('tag,name,role,town_hall_level,trophies,donations,donations_received,attack_wins,defense_wins,data');
  if (filters.role) q = q.eq('role', filters.role);
  if (filters.tag) q = q.eq('tag', filters.tag);
  const { data, error } = await q.order('name').limit(bounded(filters.limit, 100, 100));
  if (error) throw error;
  return data ?? [];
}

export async function getCurrentWar() {
  const { data, error } = await db.from('wars').select('war_key,state,start_time,end_time,data').in('state', ['preparation', 'inWar']).order('start_time', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function searchWars(term = '', maxRows = 25) {
  const { data, error } = await db.from('wars').select('war_key,state,start_time,end_time,data').order('end_time', { ascending: false }).limit(200);
  if (error) throw error;
  const needle = String(term).trim().toLowerCase();
  return (data ?? []).filter(w => !needle || JSON.stringify(w.data ?? {}).toLowerCase().includes(needle) || String(w.war_key).toLowerCase().includes(needle)).slice(0, bounded(maxRows, 25, 100));
}

export async function getSnapshots(playerTag, since = null, maxRows = 200) {
  let q = db.from('player_snapshots').select('player_tag,captured_at,data').eq('player_tag', playerTag).order('captured_at', { ascending: false });
  if (since) q = q.gte('captured_at', since);
  const { data, error } = await q.limit(bounded(maxRows, 200, 1000));
  if (error) throw error;
  return data ?? [];
}

export async function getWarMembers(warKeyValue, maxRows = 100) {
  const { data, error } = await db.from('war_members').select('player_tag,player_name,map_position,attacks_available,attacks_used,stars_earned,destruction_percentage,data').eq('war_key', warKeyValue).order('map_position').limit(bounded(maxRows, 100, 100));
  if (error) throw error;
  return data ?? [];
}

export async function getWarAttacks(warKeyValue, maxRows = 100) {
  const { data, error } = await db.from('war_attacks').select('attacker_tag,attacker_name,defender_tag,defender_name,stars,destruction_percentage,order_no,attack_time,data').eq('war_key', warKeyValue).order('order_no').limit(bounded(maxRows, 100, 500));
  if (error) throw error;
  return data ?? [];
}

export async function getAttackLog(filters = {}) {
  let q = db.from('attack_log').select('attack_key,tournament_type,tournament_id,tournament_name,season_key,war_key,opponent_clan_tag,opponent_clan_name,attacker_tag,attacker_name,defender_tag,defender_name,district_id,district_name,attack_number,order_no,stars,destruction_percentage,duration_seconds,attack_time,observed_at,data').order('observed_at', { ascending: false });
  if (filters.tournamentType) q = q.eq('tournament_type', filters.tournamentType);
  if (filters.tournamentId) q = q.eq('tournament_id', filters.tournamentId);
  if (filters.attackerTag) q = q.eq('attacker_tag', filters.attackerTag);
  if (filters.opponentTag) q = q.eq('opponent_clan_tag', filters.opponentTag);
  if (filters.since) q = q.gte('observed_at', filters.since);
  const { data, error } = await q.limit(bounded(filters.limit, 200, 1000));
  if (error) throw error;
  return data ?? [];
}

export async function getCapitalSeasons(maxRows = 12) {
  const { data, error } = await db.from('capital_raids').select('season_key,data').order('season_key', { ascending: false }).limit(bounded(maxRows, 12, 50));
  if (error) throw error;
  return data ?? [];
}

export async function getCwlSeasons(maxRows = 12) {
  const { data, error } = await db.from('cwl_seasons').select('season_key,data').order('season_key', { ascending: false }).limit(bounded(maxRows, 12, 50));
  if (error) throw error;
  return data ?? [];
}

export async function getCwlWars(seasonKey = null, maxRows = 20) {
  let q = db.from('cwl_wars').select('season_key,war_tag,opponent_clan_tag,opponent_name,state,data').order('war_tag');
  if (seasonKey) q = q.eq('season_key', seasonKey);
  const { data, error } = await q.limit(bounded(maxRows, 20, 100));
  if (error) throw error;
  return data ?? [];
}
