import { getCurrentWar, getWarMembers } from './retrieval.js';

const UNUSED_ATTACK_PATTERNS = [
  /\b(?:has|have|had)\s+(?:not|n't)\s+used\s+(?:any|an|their|the)?\s*attacks?\b/i,
  /\b(?:has|have|had)\s+(?:not|n't)\s+(?:made|done|used)\s+(?:any|an|their|the)?\s*(?:attack|attacks)\b/i,
  /\b(?:has|have|had)\s+(?:not|n't)\s+attacked\b/i,
  /\b(?:who|which|what)\b.*\b(?:has|have)\s+(?:not|n't)\s+(?:attack|attacked)\b/i,
  /\b(?:no|zero)\s+attacks?\b/i,
  /\b(?:unused|un-used)\s+attacks?\b/i,
  /\b(?:without|yet to)\s+(?:use|make|do)\s+(?:any\s+)?attacks?\b/i
];

export function isUnusedCurrentWarAttackQuestion(question = '') {
  const q = String(question).trim();
  if (!q) return false;
  const mentionsCurrentWar = /\b(?:current|ongoing|this)\s+war\b|\bcurrentwar\b/i.test(q) || /participants?\s+of\s+our\s+clan/i.test(q);
  const explicitlyHistorical = /\b(?:last|previous|past|historical|history)\s+(?:war|wars|attack|attacks)\b|\b(?:cwl|clan war league|capital raid)\b/i.test(q);
  return !explicitlyHistorical && (mentionsCurrentWar || /\bwho\b.*\b(?:attacked|attack|attacks)\b/i.test(q)) && UNUSED_ATTACK_PATTERNS.some(pattern => pattern.test(q));
}

export async function answerUnusedCurrentWarAttackQuestion(question = '') {
  if (!isUnusedCurrentWarAttackQuestion(question)) return null;

  const war = await getCurrentWar();
  if (!war?.war_key) return 'There is no current Clan War available in the synced data.';

  const members = await getWarMembers(war.war_key, 100);
  const unused = members
    .filter(member => Number(member.attacks_used ?? 0) === 0)
    .sort((a, b) => {
      const aPos = Number(a.map_position ?? Number.MAX_SAFE_INTEGER);
      const bPos = Number(b.map_position ?? Number.MAX_SAFE_INTEGER);
      return aPos - bPos || String(a.player_name ?? '').localeCompare(String(b.player_name ?? ''));
    });

  if (!unused.length) return 'All current-war participants have used at least one attack.';

  return [
    'Players who have not used any attack yet:',
    ...unused.map((member, index) => `${index + 1}. ${member.player_name}`)
  ].join('\n');
}
