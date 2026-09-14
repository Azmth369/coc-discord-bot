import 'dotenv/config';
import './discord.js';
import { syncClan, syncWar, syncHistory, syncCapital, syncCwl, run } from './sync.js';

const schedules = [
  ['clan', Number(process.env.CLAN_POLL_MS || 600000), () => syncClan(false)],
  ['war', Number(process.env.WAR_POLL_MS || 120000), syncWar],
  ['history', Number(process.env.HISTORY_POLL_MS || 1800000), syncHistory],
  ['capital', Number(process.env.CAPITAL_POLL_MS || 1800000), syncCapital],
  ['cwl', Number(process.env.CWL_POLL_MS || 300000), syncCwl],
  ['player-snapshot', Number(process.env.PLAYER_POLL_MS || 1800000), () => syncClan(true)]
];

let syncRunning = false;

async function runSync(name, fn) {
  if (syncRunning) {
    console.log(`[sync] skipped ${name}; another sync is still running`);
    return;
  }
  syncRunning = true;
  try {
    console.log(`[sync] starting (${name})`);
    await run(name, fn);
    console.log(`[sync] complete (${name})`);
  } finally {
    syncRunning = false;
  }
}

await runSync('startup', async () => {
  await syncClan(false);
  await syncWar();
  await syncHistory();
  await syncCapital();
  await syncCwl();
});

for (const [name, ms, fn] of schedules) {
  if (!Number.isFinite(ms) || ms <= 0) continue;
  setInterval(() => runSync(name, fn).catch(error => console.error(`[sync:${name}]`, error)), ms);
}

console.log('[sync] scheduler started; Discord bot is running in the same process');
