import { Cron } from 'croner';
import { config, requireDevice, alertsAllowedNow } from './config.js';
import { getStatus } from './dess/data.js';
import { formatHeartbeat } from './format.js';
import { evaluateAlerts, activeTitles } from './alerts.js';
import { loadState, saveState } from './state.js';
import { start, send, stop } from './notify/index.js';

const ts = () => new Date().toISOString();

let state = null;
let busy = false;

async function fetchStatus() {
  return getStatus(requireDevice());
}

async function runAlerts() {
  const status = await fetchStatus();
  const { messages, suppressed } = evaluateAlerts(status, state, new Date());
  saveState(state);
  for (const m of messages) {
    await send(m.text);
    console.log(`[${ts()}] alert sent (${m.level})`);
  }
  if (suppressed) console.log(`[${ts()}] ${suppressed} alert(s) suppressed by quiet hours`);
  if (!messages.length && !suppressed) console.log(`[${ts()}] alert check — nothing new`);
}

async function runStatus() {
  const status = await fetchStatus();
  if (!alertsAllowedNow('warning')) {
    console.log(`[${ts()}] quiet hours — heartbeat skipped`);
    return;
  }
  const text = formatHeartbeat(status, { activeTitles: activeTitles(state) });
  await send(text);
  console.log(`[${ts()}] heartbeat sent`);
}

async function tick(kind) {
  if (busy) {
    console.warn(`[${ts()}] ${kind} tick skipped — previous run still in progress`);
    return;
  }
  busy = true;
  try {
    if (kind === 'alert') await runAlerts();
    else await runStatus();
  } catch (err) {
    console.error(`[${ts()}] ${kind} tick failed:`, err.message);
  } finally {
    busy = false;
  }
}

async function shutdown(reason, code = 0) {
  console.log(`[${ts()}] shutting down (${reason})`);
  if (state) saveState(state);
  await stop();
  process.exit(code);
}

async function main() {
  requireDevice(); // fail fast

  let statusJob;
  let alertJob;
  try {
    statusJob = new Cron(config.schedule.statusCron, { timezone: config.schedule.tz, paused: true }, () =>
      tick('status'),
    );
    alertJob = new Cron(config.schedule.alertCron, { timezone: config.schedule.tz, paused: true }, () =>
      tick('alert'),
    );
  } catch (err) {
    throw new Error(`Invalid cron expression: ${err.message}`);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  state = loadState();

  console.log(`[${ts()}] connecting to the notifier...`);
  await start(); // reconnects itself if the link drops

  // Announce startup only if it's been a while — a host that restarts the process
  // often shouldn't spam the group.
  const lastStart = state.startedAt ? Date.now() - new Date(state.startedAt).getTime() : Infinity;
  if (lastStart > 30 * 60 * 1000 && alertsAllowedNow('warning')) {
    await send('🟢 SolarWatch started — monitoring is active.').catch(() => {});
  } else {
    console.log(`[${ts()}] restart within 30 min — startup message skipped`);
  }
  state.startedAt = new Date().toISOString();

  statusJob.resume();
  alertJob.resume();
  console.log(
    `[${ts()}] status "${config.schedule.statusCron}" · alerts "${config.schedule.alertCron}" (${config.schedule.tz})`,
  );

  await tick('alert'); // catch anything wrong now (no re-fire of already-active issues)
  await tick('status'); // first heartbeat immediately
  saveState(state);
  console.log(`[${ts()}] SolarWatch is running. Ctrl+C to stop.`);
}

main().catch((err) => {
  console.error(`[${ts()}] fatal:`, err.message);
  process.exit(1);
});
