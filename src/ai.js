import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const readKey = process.env.SUPABASE_ANON_KEY;
if (!readKey) throw new Error('SUPABASE_ANON_KEY is required for the AI/Discord runtime');
const db = createClient(process.env.SUPABASE_URL, readKey, { auth: { persistSession: false } });

async function query(table, columns = '*', limit = 50) {
  const { data, error } = await db.from(table).select(columns).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function buildContext(question) {
  const q = question.toLowerCase();
  const context = {};

  // Start with compact, high-signal data. Pull broader history only when the question needs it.
  if (/member|player|donat|troph|town hall|inactive|role|lowest|highest|who/.test(q)) {
    context.players = await query('players', 'tag,name,role,town_hall_level,trophies,donations,donations_received,attack_wins,defense_wins,data', 100);
  }
  if (/war|attack|defen|star|current/.test(q)) {
    context.wars = await query('wars', 'war_key,state,start_time,end_time,data', 25);
  }
  if (/capital|raid/.test(q)) {
    context.capital_raids = await query('capital_raids', 'season_key,data', 12);
  }
  if (/trend|improv|month|march|april|may|june|july|august|september|snapshot|history/.test(q)) {
    context.player_snapshots = await query('player_snapshots', 'player_tag,captured_at,data', 500);
  }
  if (Object.keys(context).length === 0) {
    context.clan = await query('clans', 'tag,data,synced_at', 1);
    context.players = await query('players', 'tag,name,role,town_hall_level,trophies,donations,donations_received,data', 100);
  }
  return context;
}

async function askGemini(question, context) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!key) throw new Error('GEMINI_API_KEY is required');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const system = `You are a Clash of Clans clan analyst. Answer only from the supplied database context. Never invent player stats, wars, dates, or outcomes. If the context is insufficient, say exactly what is missing. Prefer concise, useful answers and name the relevant players/wars when supported.`;
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: `${question}\n\nDATABASE CONTEXT:\n${JSON.stringify(context)}` }] }],
    generationConfig: { temperature: 0.2 }
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || 'No answer generated.';
}

export async function answer(question) {
  const context = await buildContext(question);
  return askGemini(question, context);
}
