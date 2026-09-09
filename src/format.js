import { config } from './config.js';

const tz = () => config.schedule.tz;
const U = () => config.alerts.utilityName;

// ---- WhatsApp text formatting ----------------------------------------------
export const bold = (t) => `*${t}*`;
export const ital = (t) => `_${t}_`;
/** A monospace block — the only reliable way to align columns in WhatsApp. */
export const mono = (body) => '```\n' + body + '\n```';

export function fmt(value, unit, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const s = digits > 0 ? n.toFixed(digits) : Math.round(n).toString();
  return unit ? `${s} ${unit}` : s;
}

/** rows = [[label, value], …] → left-aligned "label      value" lines for a mono block */
function kv(rows) {
  const w = Math.max(...rows.map(([l]) => l.length)) + 3;
  return rows.map(([l, v]) => l.padEnd(w) + v).join('\n');
}

/** "1:04 PM" */
export function clock(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz(),
  }).format(date);
}

/** "Wed 9 Sep · 1:00 PM" */
export function stamp(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz(),
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} · ${clock(date)}`;
}

/** "9 Sep" */
export function shortDate(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz() })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day} ${p.month}`;
}

/** "1h 26m", "8m", "just now" */
export function humanDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const backupLabel = (min) => (min == null ? null : min >= 60 ? `≈${humanDuration(min * 60000)}` : `≈${min} min`);

// ---- shared bits ----------------------------------------------------------
function gridValue(s) {
  if (!s.gridConnected) return `${U()} off`;
  return s.gridVoltage != null ? `${U()} on   ${fmt(s.gridVoltage, 'V')}` : `${U()} on`;
}

function batteryValue(s) {
  const parts = [fmt(s.batteryVoltage, 'V', 1)];
  if (s.batterySoc != null) parts.push(`${Math.round(s.batterySoc)}%`);
  if (s.batteryChargeCurrent) parts.push(`+${fmt(s.batteryChargeCurrent, 'A')}`);
  else if (s.batteryDischargeCurrent) parts.push(`-${fmt(s.batteryDischargeCurrent, 'A')}`);
  return parts.join('   ');
}

/** the data table used in alerts and (as the body) the heartbeat */
function statBlock(s, { includeToday = false } = {}) {
  const rows = [
    ['Solar', fmt(s.pvPower, 'W')],
    ['Battery', batteryValue(s)],
    ['Load', `${fmt(s.loadPower, 'W')}${s.loadPercent != null ? `   ${Math.round(s.loadPercent)}%` : ''}`],
    ['Grid', gridValue(s)],
  ];
  if (includeToday && s.energyToday != null) rows.push(['Today', fmt(s.energyToday, 'kWh', 1)]);
  if (!s.gridConnected && s.backupRuntimeMin != null) rows.push(['Backup', backupLabel(s.backupRuntimeMin)]);
  return mono(kv(rows));
}

/** human summary of what the system is doing right now */
export function describeMode(s) {
  if (!s.online) return 'No data from the inverter';
  const heavySolar = s.solarProducing && (s.pvPower ?? 0) >= (s.loadPower ?? 0);

  if (!s.gridConnected) {
    if (s.solarDeficitW > 150) return `Battery covering a ${fmt(s.solarDeficitW, 'W')} shortfall — ${U()} off`;
    if (s.batteryDischarging) return `On battery${s.solarProducing ? ' + solar' : ''} — ${U()} is off`;
    if (heavySolar && s.batteryCharging) return `Solar running the house & charging the battery — ${U()} off`;
    return `${U()} is off — solar covering the load`;
  }
  if (s.batteryFull && s.solarSurplusW > 300) return `Battery full — ${fmt(s.solarSurplusW, 'W')} of spare solar`;
  if (s.batteryDischarging) {
    const lowish =
      s.utilityComebackV != null && s.batteryVoltage != null && s.batteryVoltage < s.utilityComebackV - 0.3;
    if (s.solarDeficitW > 150 || lowish) return `⚠️ Draining the battery while ${U()} is available`;
    return `Running on battery (SBU mode) — ${U()} on standby`;
  }
  if (s.batteryCharging && s.solarProducing) return `Solar charging the battery, ${U()} available`;
  if (s.solarProducing) return `Solar covering the load, ${U()} available`;
  if (s.batteryCharging) return `Charging the battery from ${U()}`;
  return `${U()} powering the house (no solar)`;
}

/** advice line for the heartbeat when the situation calls for it */
function heartbeatAdvice(s) {
  if (s.solarDeficitW > 150) {
    const rt = s.backupRuntimeMin != null ? ` — battery ${backupLabel(s.backupRuntimeMin)} left` : '';
    return `💡 ${bold('Reduce load')} — solar is ${fmt(s.solarDeficitW, 'W')} short of the load${rt}.`;
  }
  if (s.batteryFull && s.solarSurplusW > 300 && (s.loadPctRated ?? 100) < 25) {
    return `💡 Spare solar (${fmt(s.solarSurplusW, 'W')}) — good time to run heavy appliances.`;
  }
  return null;
}

// ---- messages -----------------------------------------------------------
export function formatHeartbeat(s, { activeTitles = [] } = {}) {
  const lines = [`🔆 ${bold('SOLAR UPDATE')}`, ital(stamp()), ''];

  if (!s.online) {
    lines.push(
      `📡 ${bold('INVERTER OFFLINE')}`,
      s.dataAgeMin != null ? `No data for ${humanDuration(s.dataAgeMin * 60000)}.` : `No data from DessMonitor.`,
    );
    return lines.join('\n');
  }

  lines.push(statBlock(s, { includeToday: true }), `▸ ${ital(describeMode(s))}`);

  const advice = heartbeatAdvice(s);
  if (activeTitles.length || advice) lines.push('');
  if (activeTitles.length) lines.push(`⚠️ ${bold('Active:')} ${activeTitles.join(' · ')}`);
  if (advice) lines.push(advice);

  return lines.join('\n');
}

/**
 * An alert / recovery / info message.
 * `entry` = { level, kind: 'fired'|'cleared'|'info', title, advice }
 */
export function formatAlert(entry, s, { durationText } = {}) {
  const { level, kind, title, advice } = entry;
  let header;
  if (kind === 'cleared') header = `✅ ${bold('RESOLVED')} · ${ital(clock())}`;
  else if (kind === 'info') header = `ℹ️ ${ital(clock())}`;
  else if (level === 'critical') header = `🚨 ${bold('CRITICAL ALERT')} · ${ital(clock())}`;
  else header = `⚠️ ${bold('ALERT')} · ${ital(clock())}`;

  const lines = [header, '', bold(title)];
  if (kind === 'cleared' && durationText && durationText !== 'just now') {
    lines.push(ital(`Was active for ${durationText}.`));
  }
  if (advice) lines.push(advice.startsWith('💡') || advice.startsWith('⚠️') ? advice : `💡 ${advice}`);
  if (s) lines.push('', statBlock(s));
  return lines.join('\n');
}

export function formatDailySummary(d) {
  const at = (iso) => (iso ? `   ${clock(new Date(iso))}` : '');
  const rows = [];
  if (d.solarKwh != null) rows.push(['Solar today', fmt(d.solarKwh, 'kWh', 1)]);
  if (d.peakSolarW) rows.push(['Peak solar', fmt(d.peakSolarW, 'W') + at(d.peakSolarAt)]);
  if (d.peakLoadW) rows.push(['Peak load', fmt(d.peakLoadW, 'W') + at(d.peakLoadAt)]);
  if (d.minBatteryV != null) rows.push(['Lowest battery', fmt(d.minBatteryV, 'V', 1) + at(d.minBatteryAt)]);
  rows.push([
    `${U()} outages`,
    d.outageCount
      ? `${d.outageCount}   (${humanDuration(d.outageMinutes * 60000)} total)`
      : 'none 🎉',
  ]);
  if (d.minutesOnBattery >= 1) rows.push(['Time on battery', humanDuration(d.minutesOnBattery * 60000)]);

  return [`📊 ${bold('DAILY SUMMARY')} · ${ital(shortDate(d.date ? new Date(d.date) : new Date()))}`, '', mono(kv(rows))].join(
    '\n',
  );
}
