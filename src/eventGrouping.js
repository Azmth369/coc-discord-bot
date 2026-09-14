function parseCoCTimestamp(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?/);
  if (!match) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]));
}

function getStart(row) {
  return parseCoCTimestamp(row?.data?.startTime) || parseCoCTimestamp(row?.season_key);
}

function getEnd(row) {
  return parseCoCTimestamp(row?.data?.endTime);
}

function periodKey(date) {
  return date ? date.toISOString() : null;
}

function formatDate(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatRange(start, end) {
  const a = formatDate(start);
  const b = formatDate(end);
  if (!a) return 'Unknown raid period';
  return b ? `${a} – ${b}` : a;
}

export function groupCapitalAttacksByRaidPeriod(seasons = [], attacks = []) {
  const periods = new Map();

  for (const season of seasons) {
    const start = getStart(season);
    const key = periodKey(start) || `season:${season.season_key}`;
    const existing = periods.get(key);
    const data = season.data ?? {};
    const candidate = {
      period_key: key,
      start_time: start?.toISOString() ?? null,
      end_time: getEnd(season)?.toISOString() ?? null,
      label: formatRange(start, getEnd(season)),
      season_keys: [season.season_key],
      attack_count: 0,
      attack_data_available: false,
      capital_total_loot: Number(data.capitalTotalLoot ?? 0),
      raids_completed: Number(data.raidsCompleted ?? 0),
      total_attacks_reported_by_api: Number(data.totalAttacks ?? 0),
      source_seasons: [data.source ?? 'api']
    };
    if (!existing) periods.set(key, candidate);
    else {
      existing.season_keys.push(season.season_key);
      if (!existing.end_time && candidate.end_time) existing.end_time = candidate.end_time;
      if (!existing.capital_total_loot && candidate.capital_total_loot) existing.capital_total_loot = candidate.capital_total_loot;
      if (!existing.raids_completed && candidate.raids_completed) existing.raids_completed = candidate.raids_completed;
      if (!existing.total_attacks_reported_by_api && candidate.total_attacks_reported_by_api) existing.total_attacks_reported_by_api = candidate.total_attacks_reported_by_api;
      existing.source_seasons.push(...candidate.source_seasons);
    }
  }

  const attackCounts = new Map();
  for (const attack of attacks) {
    const key = String(attack.season_key || '');
    let matched = null;
    const timestampMatch = key.match(/(\d{8}T\d{6}(?:\.\d+)?Z?)/);
    if (timestampMatch) matched = periodKey(parseCoCTimestamp(timestampMatch[1]));
    if (!matched && periods.has(key)) matched = key;
    if (!matched) {
      const observed = parseCoCTimestamp(attack.observed_at);
      if (observed) {
        for (const [candidateKey, period] of periods) {
          const start = parseCoCTimestamp(period.start_time);
          const end = parseCoCTimestamp(period.end_time);
          if (start && end && observed >= start && observed <= end) {
            matched = candidateKey;
            break;
          }
        }
      }
    }
    if (matched) attackCounts.set(matched, (attackCounts.get(matched) || 0) + 1);
  }

  for (const period of periods.values()) {
    period.attack_count = attackCounts.get(period.period_key) || 0;
    period.attack_data_available = period.attack_count > 0;
    period.end_time = period.end_time || null;
    period.label = formatRange(parseCoCTimestamp(period.start_time), parseCoCTimestamp(period.end_time));
    period.source_seasons = [...new Set(period.source_seasons)];
    period.season_keys = [...new Set(period.season_keys)];
  }

  return [...periods.values()].sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
}

export function compactCapitalRaidContext(seasons = [], attacks = []) {
  const periods = groupCapitalAttacksByRaidPeriod(seasons, attacks);
  return {
    periods,
    totals: {
      raid_periods: periods.length,
      periods_with_attack_data: periods.filter(p => p.attack_data_available).length,
      attack_rows_available: periods.reduce((sum, p) => sum + p.attack_count, 0)
    },
    note: 'A raid period can exist in capital_raids without individual attack rows. Only periods with attack_data_available=true contain captured individual attacks. Legacy imports sharing the same real-world start time are merged into that raid period.'
  };
}
