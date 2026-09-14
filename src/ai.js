import 'dotenv/config';
import { getPlayers, getCurrentWar, searchWars, getSnapshots, getCapitalSeasons, getCwlSeasons, getCwlWars, getWarAttacks, getWarMembers } from './retrieval.js';

const MONTHS = /january|february|march|april|may|june|july|august|september|october|november|december|month|year|trend|history|improv|declin/i;
const WAR = /war|attack|defen|star|opponent|miss|hit|battle/i;
const CAPITAL = /capital|raid/i;
const CWL = /cwl|clan war league|league day/i;
const MEMBER = /member|player|donat|troph|town hall|inactive|role|lowest|highest|who/i;

function classify(question) {
  const q = question.toLowerCase();
  return { member: MEMBER.test(q), war: WAR.test(q), capital: CAPITAL.test(q), cwl: CWL.test(q), history: MONTHS.test(q) };
}

function extractOpponent(question) {
  const m = question.match(/(?:against|vs\.?|versus)\s+["']?([^"'?.!,]+)["']?/i);
  return m?.[1]?.trim() || null;
}

function enrichWarMembers(members) {
  return members.map(m => ({
    ...m,
    missed_attacks: Math.max(Number(m.attacks_available ?? 0) - Number(m.attacks_used ?? 0), 0)
  }));
}

async function buildContext(question) {
  const kind = classify(question);
  const context = { retrieval: kind };

  if (kind.member) context.players = await getPlayers({ limit: 100 });

  if (kind.war) {
    const current = await getCurrentWar();
    context.current_war = current;
    if (current?.war_key) {
      context.current_war_members = enrichWarMembers(await getWarMembers(current.war_key));
      context.current_war_attacks = await getWarAttacks(current.war_key);
    }
    const opponent = extractOpponent(question);
    context.wars = await searchWars(opponent, 25);
    if (opponent && context.wars.length) {
      context.war_details = [];
      for (const war of context.wars.slice(0, 5)) {
        context.war_details.push({ war, members: enrichWarMembers(await getWarMembers(war.war_key)), attacks: await getWarAttacks(war.war_key) });
      }
    }
  }

  if (kind.capital) context.capital_raids = await getCapitalSeasons(12);

  if (kind.cwl) {
    context.cwl = await getCwlSeasons(12);
    context.cwl_wars = await getCwlWars(null, 50);
  }

  if (kind.history) {
    const playerName = question.match(/(?:player|member)\s+([A-Za-z0-9_.@-]+)/i)?.[1];
    if (playerName) {
      const players = context.players ?? await getPlayers({ limit: 100 });
      const p = players.find(x => x.name.toLowerCase() === playerName.toLowerCase());
      if (p) context.player_snapshots = await getSnapshots(p.tag, null, 500);
    }
  }

  if (Object.keys(context).length === 1) {
    context.players = await getPlayers({ limit: 100 });
    context.current_war = await getCurrentWar();
  }
  return context;
}

async function askGemini(question, context) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!key) throw new Error('GEMINI_API_KEY is required');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const system = `You are a Clash of Clans clan analyst. Answer ONLY from the supplied database context. Never invent player stats, attacks, wars, dates, or outcomes. Distinguish current data from historical data. If the context is insufficient, say what is missing. For rankings, calculate from supplied values and show key numbers. For missed attacks, use missed_attacks and do not infer a miss when attacks_available is unknown or zero. For war comparisons, identify the opponent and date when supplied. For CWL, treat cwl_wars as individual league wars and do not confuse them with ordinary clan wars. Keep answers concise, useful, and data-backed.`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `${question}\n\nDATABASE CONTEXT:\n${JSON.stringify(context)}` }] }],
    generationConfig: { temperature: 0.15 }
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'No answer generated.';
}

export async function answer(question) {
  if (!question?.trim()) throw new Error('Question cannot be empty');
  const clean = question.trim();
  return askGemini(clean, await buildContext(clean));
}
