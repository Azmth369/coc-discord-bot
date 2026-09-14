import 'dotenv/config';
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

export async function startSyncScheduler() {
  if (syncRunning) return;
  syncRunning = true;
  try {
    await run('startup', async () => {
      await syncClan(false);
      await syncWar();
      await syncHistory();
      await syncCapital();
      await syncCwl();
    });
  } finally {
    syncRunning = false;
  }

  for (const [name, ms, fn] of schedules) {
    if (!Number.isFinite(ms) || ms <= 0) continue;
    setInterval(async () => {
      if (syncRunning) return console.log(`[sync] skipped ${name}; another sync is running`);
      syncRunning = true;
      try { await run(name, fn); }
      finally { syncRunning = false; }
    }, ms);
  }
  console.log('[sync] scheduler started');
}

if (process.argv[1]?.endsWith('/index.js')) await startSyncScheduler();
