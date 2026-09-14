import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const readKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_READONLY_KEY;

if (!url || !readKey) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_READONLY_KEY) are required for the AI/Discord runtime');
}

const db = createClient(url, readKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function query(table, columns, limit = 100) {
  const { data, error } = await db.from(table).select(columns).limit(limit);
  if (error) throw error;
  return data ?? [];
}

function needsMembers(q) {
  return /member|player|donat|troph|town hall|inactive|role|lowest|highest|who/.test(q);
}

function needsWars(q) {
  return /war|attack|defen|star|current|opponent/.test(q);
}

function needsCapital(q) {
  return /capital|raid/.test(q);
}

function needsHistory(q) {
  return /history|histor|trend|improv|month|march|april|may|june|july|august|september|october|november|december|snapshot|over time|last (week|month|season)/.test(q);
}

function needsCwl(q) {
  return /cwl|clan war league|league day/.test(q);
}

export async function buildContext(question) {
  const q = question.toLowerCase();
  const context = {};

  if (needsMembers(q)) {
    context.players = await query(
      'players',
      'tag,name,role,town_hall_level,trophies,donations,donations_received,attack_wins,defense_wins,data',
      100
    );
  }

  if (needsWars(q)) {
    context.wars = await query(
      'wars',
      'war_key,state,start_time,end_time,data',
      50
    );
  }

  if (needsCapital(q)) {
    context.capital_raids = await query('capital_raids', 'season_key,data', 20);
  }

  if (needsCwl(q)) {
    context.cwl_seasons = await query('cwl_seasons', 'season_key,data', 12);
  }

  if (needsHistory(q)) {
    context.player_snapshots = await query('player_snapshots', 'player_tag,clan_tag,captured_at,data', 1000);
  }

  if (Object.keys(context).length === 0) {
    context.clan = await query('clans', 'tag,data,synced_at', 1);
    context.players = await query(
      'players',
      'tag,name,role,town_hall_level,trophies,donations,donations_received,attack_wins,defense_wins',
      100
    );
  }

  return context;
}

async function askGemini(question, context) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!key) throw new Error('GEMINI_API_KEY is required');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const system = [
    'You are a Clash of Clans clan analyst.',
    'Answer only from the supplied database context.',
    'Never invent player stats, wars, dates, attacks, or outcomes.',
    'When the supplied context is insufficient, clearly say what is missing.',
    'Use the exact player and war names supported by the data.',
    'Prefer concise Discord-friendly answers with useful bullets or short sections.'
  ].join(' ');

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{
      role: 'user',
      parts: [{ text: `${question}\n\nDATABASE CONTEXT:\n${JSON.stringify(context)}` }]
    }],
    generationConfig: { temperature: 0.2 }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || 'No answer generated.';
}

export async function answer(question) {
  const context = await buildContext(question);
  return askGemini(question, context);
}
