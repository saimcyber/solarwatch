// Audit trail: every alert message actually sent, plus the exact metrics snapshot
// that triggered it. Purely for later analysis/tuning of the rules in alerts.js —
// nothing in the bot reads this file back at runtime.
//
//   node scripts/show-alert-log.js            last 20 events
//   node scripts/show-alert-log.js battery_low   only that rule
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const LOG_FILE = () => path.join(dataDir(), '.alerts.log');

/**
 * Append one sent-message event as a line of JSON: { ts, ruleId, level, kind, text, status }.
 * `status` is the full status snapshot from getStatus() at the moment the message fired —
 * battery voltage, PV/load power, grid state, etc. — so a message can always be traced back
 * to the numbers that caused it.
 */
export function logAlertEvent({ ruleId, level, kind, text, status }) {
  const record = {
    ts: new Date().toISOString(),
    ruleId: ruleId ?? null,
    level,
    kind: kind ?? null,
    text,
    status: status ?? null,
  };
  try {
    fs.appendFileSync(LOG_FILE(), JSON.stringify(record) + '\n');
  } catch (err) {
    console.error(`[alertLog] could not write ${LOG_FILE()}:`, err.message);
  }
}

/** Read back the log as an array of records, oldest first. Missing file ⇒ []. */
export function readAlertLog() {
  let text;
  try {
    text = fs.readFileSync(LOG_FILE(), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
