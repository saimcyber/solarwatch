// Pretty-print the alert audit log (src/alertLog.js) for tuning the rules in alerts.js:
// which message fired, when, and the exact metrics behind it.
//
//   node scripts/show-alert-log.js                last 20 events, any rule
//   node scripts/show-alert-log.js battery_low     last 20 events for one rule
//   node scripts/show-alert-log.js battery_low 100 last 100 events for one rule
//   node scripts/show-alert-log.js --json          raw JSON lines (for piping to jq etc.)
import { readAlertLog } from '../src/alertLog.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const rest = args.filter((a) => a !== '--json');
const ruleFilter = rest.find((a) => Number.isNaN(Number(a)));
const limit = Number(rest.find((a) => !Number.isNaN(Number(a)))) || 20;

const all = readAlertLog().filter((r) => !ruleFilter || r.ruleId === ruleFilter);
const rows = all.slice(-limit);

if (asJson) {
  for (const r of rows) console.log(JSON.stringify(r));
  process.exit(0);
}

if (!rows.length) {
  console.log(ruleFilter ? `No log entries for rule "${ruleFilter}".` : 'No alert log entries yet.');
  process.exit(0);
}

const KIND_ICON = { fired: '🔴', cleared: '🟢', info: 'ℹ️ ' };

for (const r of rows) {
  const s = r.status || {};
  const metrics = [
    s.batteryVoltage != null && `batV=${s.batteryVoltage}`,
    s.batterySoc != null && `soc=${s.batterySoc}%`,
    s.pvPower != null && `pv=${s.pvPower}W`,
    s.loadPower != null && `load=${s.loadPower}W`,
    s.gridVoltage != null && `grid=${s.gridConnected ? s.gridVoltage + 'V' : 'OFF'}`,
    s.solarDeficitW > 0 && `deficit=${s.solarDeficitW}W`,
  ]
    .filter(Boolean)
    .join(' ');

  console.log(
    `${r.ts}  ${(KIND_ICON[r.kind] || '  ').trim().padEnd(2)} ${(r.ruleId || '-').padEnd(20)} ${r.level.padEnd(8)} ${metrics}`,
  );
  console.log(`  ${r.text.split('\n')[0]}`);
}

console.log(`\n${rows.length} of ${all.length}${ruleFilter ? ` matching "${ruleFilter}"` : ''} event(s) shown.`);
