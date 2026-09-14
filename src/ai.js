import 'dotenv/config';
import { getPlayers, getCurrentWar, searchWars, getSnapshots, getCapitalSeasons, getCwlSeasons, getCwlWars, getWarAttacks, getWarMembers, getCwlAttacks, getCapitalAttacks } from './retrieval.js';
import { capitalPlayerLeaderboard } from './analytics.js';

const MONTHS = /january|february|march|april|may|june|july|august|september|october|november|december|month|year|trend|history|improv|declin/i;
const WAR = /war|attack|defen|star|opponent|miss|hit|battle/i;
const CAPITAL = /capital|raid/i;
const CWL = /cwl|clan war league|league day/i;
const MEMBER = /member|player|donat|troph|town hall|inactive|role|elder|co-?leader|leader|lowest|highest|who/i;
const ROLE_NAMES = { leader: 'Leader', coLeader: 'Co-Leader', admin: 'Elder', member: 'Member' };

function classify(question) {
  const q = question.toLowerCase();
  return { member: MEMBER.test(q), war: WAR.test(q), capital: CAPITAL.test(q), cwl: CWL.test(q), history: MONTHS.test(q) };
}

function extractOpponent(question) { const m = question.match(/(?:against|vs\.?|versus)\s+["']?([^"'?.!,]+)["']?/i); return m?.[1]?.trim() || null; }
function extractPlayerName(question, players) { const normalized = question.toLowerCase(); return [...players].sort((a,b)=>b.name.length-a.name.length).find(p=>normalized.includes(p.name.toLowerCase())) ?? null; }
function roleLabel(role) { return ROLE_NAMES[role] || role || 'Unknown'; }
function normalizePlayers(players) { return players.map(p => ({ ...p, role_label: roleLabel(p.role) })); }
function enrichWarMembers(members) { return members.map(m => ({...m, role_label: roleLabel(m.role), missed_attacks:Math.max(Number(m.attacks_available ?? 0)-Number(m.attacks_used ?? 0),0)})); }

async function buildContext(question) {
  const kind=classify(question), context={retrieval:kind};
  const players=kind.member||kind.history?normalizePlayers(await getPlayers({limit:100})):[]; if(players.length) context.players=players;
  const opponent=extractOpponent(question);

  if(kind.war){
    const current=await getCurrentWar();
    context.current_war=current;
    if(current?.war_key){
      context.current_war_members=enrichWarMembers(await getWarMembers(current.war_key));
      context.current_war_attacks=await getWarAttacks(current.war_key);
    }
    let wars=opponent?await searchWars(opponent,25):await searchWars('',25);
    if(opponent&&wars.length===0) wars=await searchWars('',25);
    context.wars=wars;
    if(opponent&&wars.length){
      context.war_details=[];
      for(const war of wars.slice(0,5)) context.war_details.push({war,members:enrichWarMembers(await getWarMembers(war.war_key)),attacks:await getWarAttacks(war.war_key)});
    }
  }

  if(kind.capital){
    const seasons=await getCapitalSeasons(12);
    context.capital_raids=seasons.map(row=>{const d=row.data??{}; return {season_key:row.season_key,start_time:d.startTime??null,end_time:d.endTime??null,state:d.state??null,capital_total_loot:d.capitalTotalLoot??0,raids_completed:d.raidsCompleted??0,total_attacks:d.totalAttacks??0,enemy_districts_destroyed:d.enemyDistrictsDestroyed??0,offensive_reward:d.offensiveReward??0,defensive_reward:d.defensiveReward??0};});
    context.capital_attacks=await getCapitalAttacks({limit:500});
    const leaderboard=await capitalPlayerLeaderboard(12);
    context.capital_player_rankings={by_capital_gold:[...leaderboard].sort((a,b)=>b.capital_gold-a.capital_gold).slice(0,20),by_stars:[...leaderboard].sort((a,b)=>b.stars-a.stars||b.capital_gold-a.capital_gold).slice(0,20),note:'capital_gold is capital resources looted by the member across synced raid seasons; stars is the sum of individual attack stars when attack details are available.'};
  }

  if(kind.cwl){
    context.cwl=await getCwlSeasons(12);
    context.cwl_wars=await getCwlWars(null,50);
    context.cwl_attacks=await getCwlAttacks({limit:500});
  }

  if(kind.history){
    const player=extractPlayerName(question,players);
    if(player) context.player_snapshots=await getSnapshots(player.tag,null,500);
    context.historical_war_attacks=await getWarAttacksForHistory(player?.tag);
    context.historical_cwl_attacks=await getCwlAttacks({attackerTag:player?.tag,limit:300});
    context.historical_capital_attacks=await getCapitalAttacks({attackerTag:player?.tag,limit:300});
  }
  if(Object.keys(context).length===1){context.players=players.length?players:normalizePlayers(await getPlayers({limit:100})); context.current_war=await getCurrentWar();}
  return context;
}

async function getWarAttacksForHistory(playerTag) {
  if (!playerTag) return [];
  const wars = await searchWars('', 100);
  const rows = [];
  for (const war of wars) {
    const attacks = await getWarAttacks(war.war_key, 500);
    rows.push(...attacks.filter(a => a.attacker_tag === playerTag));
  }
  return rows;
}

async function generateGemini(model,key,body){
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!res.ok){const message=await res.text();const error=new Error(`Gemini ${res.status}: ${message}`);error.status=res.status;throw error;}
  const json=await res.json();
  return json.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'No answer generated.';
}

async function askGemini(question,context){
  const key=process.env.GEMINI_API_KEY;
  if(!key) throw new Error('GEMINI_API_KEY is required');
  const configured=process.env.GEMINI_MODEL||'gemini-3.8-flash';
  const supported=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.5-flash-lite','gemini-3.5-flash'];
  const models=[supported.includes(configured)?configured:'gemini-3.8-flash',...supported].filter((m,i,a)=>a.indexOf(m)===i);
  if(configured!==models[0]) console.warn(`[ai] ignoring unsupported/slow Gemini model ${configured}; using ${models[0]}`);
  const system=`You are a Clash of Clans clan assistant and analyst. You have TWO knowledge sources: (1) supplied database context for clan-specific facts and (2) your own general knowledge for general questions. Use database context whenever the user asks about this clan's members, roles, stats, wars, attacks, history, or other stored clan data. For general questions about Clash of Clans, Discord, chat rules, tagging limits, game mechanics, terminology, or unrelated topics not contained in the database, answer from your own knowledge instead of refusing because the database does not contain the answer. Never invent clan-specific facts. CoC role mapping: leader = Leader, coLeader = Co-Leader, admin = Elder, member = Member. When the user says Elder(s), count/filter role_label='Elder' (equivalently raw role='admin'). Do not call an 'admin' a server/database administrator in this clan context. Clan War attacks, CWL attacks, and Clan Capital attacks are stored in separate tables and must never be mixed. For Clan Capital, capital_gold means member capital resources looted and stars means attack stars. For missed attacks, use missed_attacks only when attacks_available is known. For CWL, do not confuse league wars with ordinary wars. attack_time is the actual source timestamp only when the API provides one; observed_at is when our sync first saw the attack. If a general rule or limit may have changed recently and you are not certain, state that it may need verification against current official rules rather than inventing a number. Answer the actual question directly and use your reasoning/calculation ability when appropriate.`;
  const body={system_instruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:`${question}\n\nDATABASE CONTEXT (use when relevant; it is not the only knowledge source):\n${JSON.stringify(context)}`}]}],generationConfig:{thinkingConfig:{thinkingLevel:'low'},maxOutputTokens:1200}};
  let last;
  for(const model of models){try{console.log(`[ai] trying Gemini model ${model} (low thinking)`);return await generateGemini(model,key,body);}catch(error){last=error;if([404,408,429,500,502,503,504].includes(error.status)){console.warn(`[ai] ${model} unavailable (${error.status}); immediately trying next Gemini model`);continue;}throw error;}}
  throw last||new Error('No Gemini model was available');
}

async function askSarvam(question,context){
  const key=process.env.SARVAM_API_KEY;
  if(!key) throw new Error('SARVAM_API_KEY is required for /ask');
  const configured=process.env.SARVAM_MODEL||'sarvam-105b';
  const model=configured==='sarvam-105b-conversations'?'sarvam-105b':configured;
  const system=`You are a fast Clash of Clans clan assistant and analyst. You have TWO knowledge sources: (1) supplied database context for clan-specific facts and (2) your own general knowledge for general questions. Use database context whenever the user asks about this clan's members, roles, stats, wars, attacks, history, or other stored clan data. For general questions about Clash of Clans, Discord, chat rules, tagging limits, game mechanics, terminology, or unrelated topics not contained in the database, answer from your own knowledge instead of refusing because the database does not contain the answer. Never invent clan-specific facts. CoC role mapping: leader = Leader, coLeader = Co-Leader, admin = Elder, member = Member. When the user says Elder(s), count/filter role_label='Elder' (equivalently raw role='admin'). Do not call an 'admin' a server/database administrator in this clan context. Clan War attacks, CWL attacks, and Clan Capital attacks are stored in separate tables and must never be mixed. For Clan Capital, capital_gold means member capital resources looted and stars means attack stars. For missed attacks, use missed_attacks only when attacks_available is known. For CWL, do not confuse league wars with ordinary wars. attack_time is the actual source timestamp only when the API provides one; observed_at is when our sync first saw the attack. If a general rule or limit may have changed recently and you are not certain, state that it may need verification against current official rules rather than inventing a number. Answer the actual question directly and use your reasoning/calculation ability when appropriate.`;
  const body={model,messages:[{role:'system',content:system},{role:'user',content:`${question}\n\nDATABASE CONTEXT (use when relevant; it is not the only knowledge source):\n${JSON.stringify(context)}`}],temperature:0.15,reasoning_effort:null,max_tokens:800};
  const res=await fetch('https://api.sarvam.ai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','api-subscription-key':key},body:JSON.stringify(body)});
  if(!res.ok){const message=await res.text();const error=new Error(`Sarvam ${res.status}: ${message}`);error.status=res.status;throw error;}
  const json=await res.json();
  return json.choices?.[0]?.message?.content||'No answer generated.';
}

export async function answer(question){if(!question?.trim()) throw new Error('Question cannot be empty'); const clean=question.trim(); return askSarvam(clean,await buildContext(clean));}
export async function tell(question){if(!question?.trim()) throw new Error('Question cannot be empty'); const clean=question.trim(); return askGemini(clean,await buildContext(clean));}
