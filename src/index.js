import 'dotenv/config';
import { syncOnce } from './sync.js';

const schedules = [
  ['clan', Number(process.env.CLAN_POLL_MS || 600000)],
  ['war', Number(process.env.WAR_POLL_MS || 120000)],
  ['player', Number(process.env.PLAYER_POLL_MS || 1800000)]
];

let syncRunning = false;

async function runSync(reason) {
  if (syncRunning) {
    console.log(`[sync] skipped ${reason}; another sync is still running`);
    return;
  }
  syncRunning = true;
  try {
    console.log(`[sync] starting (${reason})`);
    await syncOnce();
    console.log(`[sync] complete (${reason})`);
  } finally {
    syncRunning = false;
  }
}

await runSync('startup');

for (const [name, ms] of schedules) {
  if (!Number.isFinite(ms) || ms <= 0) continue;
  setInterval(() => runSync(name).catch((error) => console.error(`[sync:${name}]`, error)), ms);
}

console.log('[sync] scheduler started');
