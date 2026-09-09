import { config, localDate, localHour } from './config.js';
import { freshDaily } from './state.js';
import { formatDailySummary } from './format.js';

const MAX_TICK_MIN = 30; // ignore gaps bigger than this (downtime) when accumulating

/**
 * Fold the current reading into today's running stats. Rolls over at local midnight,
 * returning yesterday's summary message if it was never sent.
 */
export function accumulateDaily(state, s, now = new Date()) {
  const today = localDate(now);
  let rolledMessage = null;

  if (state.daily.date !== today) {
    if (state.daily.date && !state.daily.summarySent && hasData(state.daily)) {
      rolledMessage = formatDailySummary(state.daily);
    }
    state.daily = freshDaily(today);
  }

  const d = state.daily;
  const last = d.lastTickAt ? new Date(d.lastTickAt).getTime() : null;
  const deltaMin = last ? Math.min(MAX_TICK_MIN, Math.max(0, (now.getTime() - last) / 60000)) : 0;
  d.lastTickAt = now.toISOString();

  if (!s.online) return rolledMessage;

  if (s.gridConnected === false) {
    d.minutesGridOff += deltaMin;
    d.outageMinutes += deltaMin;
    if (!d.gridWasOff) {
      d.outageCount += 1;
      d.gridWasOff = true;
    }
  } else if (s.gridConnected === true) {
    d.gridWasOff = false;
  }

  if (s.batteryDischarging) d.minutesOnBattery += deltaMin;

  if (s.batteryVoltage != null && (d.minBatteryV == null || s.batteryVoltage < d.minBatteryV)) {
    d.minBatteryV = s.batteryVoltage;
    d.minBatteryAt = now.toISOString();
  }
  if (s.pvPower != null && s.pvPower > d.peakSolarW) {
    d.peakSolarW = s.pvPower;
    d.peakSolarAt = now.toISOString();
  }
  if (s.loadPower != null && s.loadPower > d.peakLoadW) {
    d.peakLoadW = s.loadPower;
    d.peakLoadAt = now.toISOString();
  }
  if (s.energyToday != null) d.solarKwh = s.energyToday;

  return rolledMessage;
}

/** The scheduled daily summary, if it's due and hasn't been sent today. */
export function maybeDailySummary(state, now = new Date()) {
  const hour = config.schedule.dailyReportHour;
  if (!hour) return null;
  const d = state.daily;
  if (d.summarySent || localHour(now) < hour || !hasData(d)) return null;
  d.summarySent = true;
  return formatDailySummary(d);
}

function hasData(d) {
  return d.lastTickAt != null && (d.solarKwh != null || d.minBatteryV != null || d.peakLoadW > 0);
}
