// override:true so values in .env win over any variables the host container injects
// (e.g. a forced TZ=Etc/UTC on Pterodactyl-style hosts).
import { config as loadEnv } from 'dotenv';
loadEnv({ override: true });
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const raw = (name) => {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : '';
};
const str = (name, fallback = '') => raw(name) || fallback;
const num = (name, fallback) => {
  const s = raw(name);
  if (!s) return fallback; // unset — Number('') is 0, so guard first
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (name, fallback = false) => {
  const v = raw(name).toLowerCase();
  if (!v) return fallback;
  return v === 'true' || v === '1' || v === 'yes';
};

function parseQuietHours(text) {
  const m = text.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return null;
  return { start: Number(m[1]) % 24, end: Number(m[2]) % 24 };
}

// Nominal DC bank voltage — the inverter usually reports it, this is the fallback.
const nominalBatteryV = num('DESS_BATTERY_VOLTAGE', 48) || 48;
// Lead-acid reference points per 12 V block, scaled to the bank voltage. Explicit
// BATTERY_* vars override. LiFePO4 users: set the explicit vars (flatter curve).
const perBlock = nominalBatteryV / 12;
const round1 = (x) => Math.round(x * 10) / 10;
const batteryLowV = num('BATTERY_LOW_V', round1(12.2 * perBlock));
const batteryCriticalV = num('BATTERY_CRITICAL_V', round1(11.6 * perBlock));

export const config = {
  notify: {
    driver: str('NOTIFY_DRIVER', 'whatsapp').toLowerCase(),
  },

  webhook: {
    url: str('WEBHOOK_URL'),
    format: str('WEBHOOK_FORMAT', 'json').toLowerCase(), // json | slack | discord | ntfy
  },

  dess: {
    username: str('DESS_USERNAME'),
    password: str('DESS_PASSWORD'),
    companyKey: str('DESS_COMPANY_KEY', 'bnrl_frRFjEz8Mkn'),
    device: {
      pn: str('DESS_PN'),
      sn: str('DESS_SN'),
      devcode: str('DESS_DEVCODE'),
      devaddr: str('DESS_DEVADDR'),
    },
    batteryVoltage: nominalBatteryV,
  },

  whatsapp: {
    groupId: str('WHATSAPP_GROUP_ID'),
    groupName: str('WHATSAPP_GROUP_NAME'),
  },

  schedule: {
    // legacy CRON_SCHEDULE still works as the status-heartbeat schedule
    statusCron: str('STATUS_CRON') || str('CRON_SCHEDULE', '0 * * * *'),
    alertCron: str('ALERT_CRON', '*/10 * * * *'),
    tz: str('TZ', 'UTC'),
    quietHours: parseQuietHours(raw('QUIET_HOURS')),
    // what still gets through during quiet hours: critical | all | none
    alertsInQuietHours: str('ALERTS_IN_QUIET_HOURS', 'critical').toLowerCase(),
    notifyOnError: bool('NOTIFY_ON_ERROR', false),
    dailyReportHour: num('DAILY_REPORT_HOUR', 21), // 0 disables
  },

  alerts: {
    utilityName: str('UTILITY_NAME', 'Grid'),
    daylightStart: num('DAYLIGHT_START', 7),
    daylightEnd: num('DAYLIGHT_END', 20),
    solarEndAfterHour: num('SOLAR_END_AFTER_HOUR', 16),
    batteryLowV,
    batteryCriticalV,
    batteryLowClearV: batteryLowV + round1(0.25 * perBlock),
    batteryCriticalClearV: batteryCriticalV + round1(0.2 * perBlock),
    heavyLoadW: num('HEAVY_LOAD_W', 1000),
    solarMinW: num('SOLAR_MIN_W', 40),
    solarOnW: num('SOLAR_ON_W', 100),
    overloadPct: num('OVERLOAD_PCT', 90),
    // Grid-voltage bands: null ⇒ derived at runtime from the inverter's nominal AC voltage.
    gridMinV: num('GRID_MIN_V', null),
    gridBackV: num('GRID_BACK_V', null),
    gridVLow: num('GRID_V_LOW', null),
    gridVHigh: num('GRID_V_HIGH', null),
    staleDataMin: num('STALE_DATA_MIN', 20),
    dailySolarSummary: bool('SOLAR_DAILY_SUMMARY', true),

    // battery runtime estimate (0 / unset ⇒ no estimate shown)
    batteryCapacityAh: num('BATTERY_CAPACITY_AH', 0),
    batteryAgeFactor: num('BATTERY_AGE_FACTOR', 0.8),
    batteryStopV: num('BATTERY_STOP_V', round1(11.5 * perBlock)),
    batteryFullRestV: num('BATTERY_FULL_REST_V', round1(12.7 * perBlock)),

    // solar array underperformance (0 / unset ⇒ rule disabled)
    pvArrayW: num('PV_ARRAY_W', 0),
    pvUnderperformPct: num('PV_UNDERPERFORM_PCT', 35),
    pvPeakStart: num('PV_PEAK_START', 11),
    pvPeakEnd: num('PV_PEAK_END', 15),
  },
};

/** Directory for runtime state (.baileys_auth/, .state.json). Override with SOLARWATCH_DATA_DIR. */
export function dataDir() {
  const dir = raw('SOLARWATCH_DATA_DIR') || repoRoot;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort */
  }
  return dir;
}

/** Throw unless the DessMonitor account credentials are configured. */
export function requireDessAuth() {
  const missing = ['DESS_USERNAME', 'DESS_PASSWORD'].filter((k) => !raw(k));
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')} (set in .env or the host's env vars).`);
  }
}

/** Throw unless the target device identifiers are configured; returns the device. */
export function requireDevice() {
  requireDessAuth();
  const { device } = config.dess;
  const missing = Object.entries({
    DESS_PN: device.pn,
    DESS_SN: device.sn,
    DESS_DEVCODE: device.devcode,
    DESS_DEVADDR: device.devaddr,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(', ')}. Run \`npm run list-devices\` and set them in .env.`,
    );
  }
  return device;
}

/** Current hour (0-23) in the configured timezone. */
export function localHour(date = new Date()) {
  return (
    Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: config.schedule.tz,
      }).format(date),
    ) % 24
  );
}

/** Current calendar date (YYYY-MM-DD) in the configured timezone. */
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: config.schedule.tz,
  }).format(date);
}

/** True if the local hour is within [a, b) (handles windows that wrap past midnight). */
export function inHourWindow(date, a, b) {
  const h = localHour(date);
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

/** True if `date`, in the configured timezone, falls inside the quiet-hours window. */
export function isQuietHour(date = new Date()) {
  const qh = config.schedule.quietHours;
  if (!qh) return false;
  return inHourWindow(date, qh.start, qh.end);
}

/**
 * Whether a message of the given level (`critical` | `warning` | `info`) may be sent
 * right now. Outside quiet hours: always. Inside quiet hours: per ALERTS_IN_QUIET_HOURS.
 */
export function alertsAllowedNow(level, date = new Date()) {
  if (!isQuietHour(date)) return true;
  switch (config.schedule.alertsInQuietHours) {
    case 'all':
      return true;
    case 'none':
      return false;
    default: // 'critical'
      return level === 'critical';
  }
}

/** True if the given time is within the daylight window solar is expected. */
export function isDaylight(date = new Date()) {
  return inHourWindow(date, config.alerts.daylightStart, config.alerts.daylightEnd);
}

/**
 * Resolve the grid-voltage thresholds. Explicit GRID_* env vars win; otherwise they're
 * derived from the inverter's nominal AC voltage (so it works for 120 V and 230 V mains).
 */
export function resolveGridBand(nominalAcV = 230) {
  const a = config.alerts;
  return {
    minV: a.gridMinV ?? nominalAcV * 0.6, // below this ⇒ grid is effectively gone
    backV: a.gridBackV ?? nominalAcV * 0.9, // hysteresis for "grid is back"
    lowV: a.gridVLow ?? nominalAcV * 0.87, // below this (while present) ⇒ abnormal-low alert
    highV: a.gridVHigh ?? nominalAcV * 1.1, // above this ⇒ abnormal-high alert
  };
}
