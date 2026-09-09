// Evaluate the alert rules against the current live data and the real saved state.
//   node scripts/check-alerts.js            dry run — print what would be sent
//   node scripts/check-alerts.js --send     actually send + persist state
//   node scripts/check-alerts.js --summary  also print today's daily summary
import { requireDevice } from '../src/config.js';
import { getStatus } from '../src/dess/data.js';
import { formatHeartbeat, formatDailySummary } from '../src/format.js';
import { evaluateAlerts, activeTitles, RULES } from '../src/alerts.js';
import { loadState, saveState } from '../src/state.js';

const send = process.argv.includes('--send');
const showSummary = process.argv.includes('--summary');

async function main() {
  const status = await getStatus(requireDevice());
  const state = loadState();

  console.log(formatHeartbeat(status, { activeTitles: activeTitles(state) }));
  console.log('\n' + '─'.repeat(50));

  const { messages, suppressed } = evaluateAlerts(status, state, new Date());

  console.log('Rule state:');
  for (const r of RULES) {
    const a = state.alerts[r.id] || {};
    console.log(`  ${a.active ? '🔴' : '  '} ${r.id.padEnd(22)} hits ${a.hits || 0}/${r.sustain}`);
  }
  console.log(`\nActive: ${activeTitles(state).join(', ') || 'none'}`);
  if (status.backupRuntimeMin != null) console.log(`Backup estimate: ~${status.backupRuntimeMin} min at ${status.loadPower} W`);

  if (showSummary) {
    console.log('\n' + '─'.repeat(50) + '\n' + formatDailySummary(state.daily));
  }

  if (!messages.length) {
    console.log(`\nNo messages${suppressed ? ` (${suppressed} suppressed by quiet hours)` : ''}.`);
  } else {
    console.log(`\n${messages.length} message(s)${send ? ' — SENDING' : ' (dry run)'}:\n`);
    for (const m of messages) console.log(`── ${m.level} ──\n${m.text}\n`);
  }

  if (send && (messages.length || suppressed)) {
    const { start, send, stop } = await import('../src/notify/index.js');
    await start();
    for (const m of messages) await send(m.text);
    saveState(state);
    await stop();
    console.log('Sent + state saved.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
