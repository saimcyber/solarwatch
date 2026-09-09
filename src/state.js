import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const STATE_FILE = () => path.join(dataDir(), '.state.json');

function defaultState() {
  return {
    alerts: {}, // ruleId -> { active, since, hits, clearedAt }
    solar: { date: null, startedToday: false, endedToday: false, endHits: 0 },
    daily: freshDaily(null),
    startedAt: null,
  };
}

export function freshDaily(date) {
  return {
    date,
    lastTickAt: null,
    minutesGridOff: 0,
    minutesOnBattery: 0,
    outageCount: 0,
    outageMinutes: 0,
    gridWasOff: false,
    minBatteryV: null,
    minBatteryAt: null,
    peakSolarW: 0,
    peakSolarAt: null,
    peakLoadW: 0,
    peakLoadAt: null,
    solarKwh: null,
    summarySent: false,
  };
}

/** Load persisted state; returns a fresh default if the file is missing or corrupt. */
export function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    const d = defaultState();
    return {
      ...d,
      ...parsed,
      alerts: parsed.alerts || {},
      solar: { ...d.solar, ...parsed.solar },
      daily: { ...d.daily, ...parsed.daily },
    };
  } catch {
    return defaultState();
  }
}

/** Persist state atomically. */
export function saveState(state) {
  const file = STATE_FILE();
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Could not write .state.json:', err.message);
  }
}
