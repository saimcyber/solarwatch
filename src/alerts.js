import { config, alertsAllowedNow, isDaylight, inHourWindow, localDate, localHour } from './config.js';
import { fmt, formatAlert, humanDuration } from './format.js';
import { accumulateDaily, maybeDailySummary } from './daily.js';

const A = config.alerts;

const backupLeft = (s) =>
  s.backupRuntimeMin == null
    ? ''
    : ` Battery ${s.backupRuntimeMin >= 60 ? `≈${humanDuration(s.backupRuntimeMin * 60000)}` : `≈${s.backupRuntimeMin} min`} left.`;

/** escalating "reduce load" guidance, by battery voltage */
function reduceLoadAdvice(s) {
  const rt = backupLeft(s);
  if (s.batteryVoltage != null && s.batteryVoltage <= A.batteryCriticalV)
    return `⚠️ URGENT: cut load now (AC, iron, pump, motor) or the inverter will shut down.${rt}`;
  if (s.batteryVoltage != null && s.batteryVoltage <= A.batteryLowV)
    return `💡 Reduce load now — turn off the AC / iron / water pump.${rt}`;
  return `💡 Turn off heavy loads (AC, iron, pump) to slow the drain.${rt}`;
}

/**
 * Alert rules. Each:
 *   id, level ('critical'|'warning'), sustain, check(s, ctx), until?(s, ctx),
 *   title(s), advice?(s), clearedTitle, rearmHours?
 */
export const RULES = [
  {
    id: 'inverter_offline',
    level: 'critical',
    sustain: 2,
    check: (s) => !s.online,
    title: (s) =>
      `Inverter is OFFLINE${s.dataAgeMin != null ? ` — no data for ${humanDuration(s.dataAgeMin * 60000)}` : ''}`,
    advice: () => `Could be an internet or power outage at the site.`,
    clearedTitle: `Inverter is back ONLINE`,
  },
  {
    id: 'inverter_fault',
    level: 'critical',
    sustain: 1,
    check: (s) => s.online && s.faulted,
    title: (s) => `Inverter FAULT: ${s.faultText || 'unknown'}`,
    advice: () => `Check the inverter — it may have stopped supplying power.`,
    clearedTitle: `Inverter fault cleared`,
  },
  {
    id: 'battery_critical',
    level: 'critical',
    sustain: 1,
    check: (s) => s.online && s.batteryVoltage != null && s.batteryVoltage <= A.batteryCriticalV,
    until: (s) => s.batteryVoltage != null && s.batteryVoltage >= A.batteryCriticalClearV,
    title: (s) => `Battery CRITICAL: ${fmt(s.batteryVoltage, 'V', 1)}`,
    advice: (s) =>
      `⚠️ URGENT: cut load or start a generator — inverter cuts off near ${fmt(s.cutoffV ?? 20, 'V', 1)}.${backupLeft(s)}`,
    clearedTitle: `Battery recovered above critical`,
  },
  {
    id: 'battery_low',
    level: 'warning',
    sustain: 1,
    check: (s) => s.online && s.batteryVoltage != null && s.batteryVoltage <= A.batteryLowV,
    until: (s) => s.batteryVoltage != null && s.batteryVoltage >= A.batteryLowClearV,
    title: (s) => `Battery LOW: ${fmt(s.batteryVoltage, 'V', 1)}`,
    advice: (s) =>
      s.gridConnected
        ? `Inverter should switch to ${A.utilityName} shortly.`
        : `💡 ${A.utilityName} is off — reduce load to make the battery last.${backupLeft(s)}`,
    clearedTitle: `Battery back to a healthy level`,
  },
  {
    id: 'overload',
    level: 'critical',
    sustain: 2,
    check: (s) => s.online && s.loadPctRated != null && s.loadPctRated >= A.overloadPct,
    until: (s) => s.loadPctRated != null && s.loadPctRated < A.overloadPct - 10,
    title: (s) =>
      `Inverter OVERLOADED: ${fmt(s.loadPower, 'W')}${s.ratedPowerW ? ` of ${fmt(s.ratedPowerW, 'W')}` : ''} (${Math.round(s.loadPctRated)}%)`,
    advice: () => `💡 Turn something off now to avoid a shutdown.`,
    clearedTitle: `Load back to normal`,
  },
  {
    id: 'wapda_off',
    level: 'warning',
    sustain: 2, // ~20 min — filters brief flickers, still catches real outages
    check: (s) => s.online && s.gridConnected === false,
    until: (s) => s.gridVoltage != null && s.gridBackV != null && s.gridVoltage >= s.gridBackV,
    title: () => `${A.utilityName} power is OFF`,
    advice: (s) => `Running on solar + battery.${backupLeft(s)}`,
    clearedTitle: `${A.utilityName} power is BACK`,
  },
  {
    id: 'grid_voltage_abnormal',
    level: 'warning',
    sustain: 2,
    check: (s) => s.online && (s.gridVoltageHigh || s.gridVoltageLow),
    until: (s) =>
      s.gridVoltage != null &&
      s.gridLowV != null &&
      s.gridHighV != null &&
      s.gridVoltage >= s.gridLowV + 5 &&
      s.gridVoltage <= s.gridHighV - 5,
    title: (s) =>
      `${A.utilityName} voltage ${s.gridVoltageHigh ? 'HIGH' : 'LOW'}: ${fmt(s.gridVoltage, 'V')}`,
    advice: (s) =>
      s.gridVoltageHigh
        ? `💡 Unusually high — use a stabiliser / unplug sensitive electronics.`
        : `💡 Unusually low — motors & compressors can be damaged; consider running on battery.`,
    clearedTitle: `${A.utilityName} voltage back to normal`,
  },
  {
    // Battery is making up a solar shortfall — the "reduce load / clouds" alert.
    id: 'solar_deficit',
    level: 'warning',
    sustain: 2,
    check: (s) => s.online && s.batteryDischarging && s.solarDeficitW > 150,
    until: (s) => !s.batteryDischarging || s.solarDeficitW < 50,
    title: (s) => `Battery draining — covering a ${fmt(s.solarDeficitW, 'W')} shortfall`,
    advice: (s) => reduceLoadAdvice(s),
    clearedTitle: `Solar is covering the load again`,
  },
  {
    // WAPDA is available but the battery keeps draining below the switch-over point —
    // the inverter should have handed over to the grid.
    id: 'battery_not_switching',
    level: 'warning',
    sustain: 2,
    check: (s) =>
      s.online &&
      s.gridConnected &&
      s.batteryDischarging &&
      s.batteryVoltage != null &&
      s.utilityComebackV != null &&
      s.batteryVoltage < s.utilityComebackV - 0.3,
    until: (s) =>
      !s.batteryDischarging ||
      !s.gridConnected ||
      (s.utilityComebackV != null && s.batteryVoltage != null && s.batteryVoltage >= s.utilityComebackV + 0.5),
    title: (s) => `Draining battery (${fmt(s.batteryVoltage, 'V', 1)}) while ${A.utilityName} is available`,
    advice: () => `💡 The inverter isn't switching to ${A.utilityName}. Check the output-source-priority setting, or reduce load.`,
    clearedTitle: `Back on ${A.utilityName} / battery charging`,
  },
  {
    id: 'battery_not_charging',
    level: 'warning',
    sustain: 3,
    check: (s) =>
      s.online &&
      s.solarProducing &&
      s.pvPower != null &&
      s.loadPower != null &&
      s.pvPower > s.loadPower + 300 &&
      s.floatV != null &&
      s.batteryVoltage != null &&
      s.batteryVoltage < s.floatV - 1 &&
      !s.batteryCharging,
    until: (s) => s.batteryCharging || s.batteryFull,
    title: () => `Battery isn't charging despite spare solar`,
    advice: (s) =>
      `💡 ${fmt(s.pvPower, 'W')} solar with only ${fmt(s.loadPower, 'W')} load, but 0 A into the battery — check the battery connections / charge settings.`,
    clearedTitle: `Battery is charging again`,
  },
  {
    id: 'pv_underperforming',
    level: 'warning',
    sustain: 4, // ~40 min — ignore passing cloud
    check: (s, ctx) =>
      A.pvArrayW > 0 &&
      s.online &&
      inHourWindow(ctx.now, A.pvPeakStart, A.pvPeakEnd) &&
      (s.batteryCharging || (s.loadPctRated ?? 0) > 30) && // only when there's demand to absorb PV
      s.pvPower != null &&
      s.pvPower < (A.pvArrayW * A.pvUnderperformPct) / 100,
    until: (s, ctx) =>
      !inHourWindow(ctx.now, A.pvPeakStart, A.pvPeakEnd) ||
      (s.pvPower != null && s.pvPower >= (A.pvArrayW * (A.pvUnderperformPct + 10)) / 100),
    title: (s) =>
      `Solar underperforming: ${fmt(s.pvPower, 'W')} at peak sun (array is ${fmt(A.pvArrayW, 'W')})`,
    advice: () => `💡 Check for shading, dirty panels, or a tripped PV string breaker.`,
    clearedTitle: `Solar output recovered`,
  },
  {
    id: 'no_solar_daytime',
    level: 'warning',
    sustain: 3,
    check: (s, ctx) =>
      s.online &&
      inNoSolarWindow(ctx.now) &&
      s.pvPower != null &&
      s.pvPower < A.solarMinW &&
      ctx.state.solar.startedToday &&
      !ctx.state.solar.endedToday,
    until: (s, ctx) =>
      (s.pvPower != null && s.pvPower >= A.solarOnW) ||
      !inNoSolarWindow(ctx.now) ||
      ctx.state.solar.endedToday,
    title: () => `No solar input during daylight`,
    advice: () => `Heavy cloud, snow on the panels, or a tripped PV breaker.`,
    clearedTitle: `Solar input restored`,
  },
  {
    id: 'solar_surplus',
    level: 'info',
    sustain: 2,
    rearmHours: 3,
    check: (s, ctx) =>
      s.online &&
      s.batteryFull &&
      s.solarProducing &&
      (s.loadPctRated ?? 100) < 25 &&
      s.solarSurplusW > 300 &&
      inHourWindow(ctx.now, 9, 16),
    until: (s) => !s.batteryFull || !s.solarProducing || s.solarSurplusW < 150,
    title: (s) => `Spare solar right now (~${fmt(s.solarSurplusW, 'W')})`,
    advice: () => `☀️ Battery is full — good time to run the washing machine, iron, or water pump.`,
    clearedTitle: null, // info: no "resolved" message
  },
];

// "No solar" only counts as a fault during the productive part of the day; after
// SOLAR_END_AFTER_HOUR a drop to zero is the normal end of the day.
function inNoSolarWindow(now) {
  return isDaylight(now) && localHour(now) < (A.solarEndAfterHour ?? 16);
}

function slot(state, id) {
  if (!state.alerts[id]) state.alerts[id] = { active: false, since: null, hits: 0, clearedAt: null };
  return state.alerts[id];
}

/** Short label for a rule (used in the heartbeat "Active:" line). */
export function activeTitles(state) {
  return RULES.filter((r) => state.alerts[r.id]?.active).map((r) => shortLabel(r.id));
}

function shortLabel(id) {
  return (
    {
      inverter_offline: 'Inverter offline',
      inverter_fault: 'Inverter fault',
      battery_critical: 'Battery critical',
      battery_low: 'Battery low',
      overload: 'Overloaded',
      wapda_off: `${A.utilityName} off`,
      grid_voltage_abnormal: `${A.utilityName} voltage`,
      solar_deficit: 'Reduce load',
      battery_not_switching: 'Not switching',
      battery_not_charging: 'Not charging',
      pv_underperforming: 'Solar low',
      no_solar_daytime: 'No solar',
    }[id] || id
  );
}

function rollSolarDay(state, s, now) {
  const today = localDate(now);
  if (state.solar.date === today) return;
  state.solar = { date: today, startedToday: false, endedToday: false, endHits: 0 };
  if (s.pvPower != null && s.pvPower >= A.solarOnW) state.solar.startedToday = true;
}

function solarDayEvents(state, s, now) {
  const msgs = [];
  if (!A.dailySolarSummary || !s.online) return msgs;

  if (!state.solar.startedToday && s.pvPower != null && s.pvPower >= A.solarOnW) {
    state.solar.startedToday = true;
    state.solar.endHits = 0;
    msgs.push({
      level: 'info',
      text: formatAlert({ level: 'info', kind: 'info', title: 'Solar production started for today ☀️' }, s),
    });
  }

  if (state.solar.startedToday && !state.solar.endedToday) {
    const lowNow = s.pvPower != null && s.pvPower < A.solarMinW;
    const lateEnough = localHour(now) >= (A.solarEndAfterHour ?? 16);
    if (lowNow && lateEnough) {
      state.solar.endHits = (state.solar.endHits || 0) + 1;
      if (state.solar.endHits >= 3) {
        state.solar.endedToday = true;
        const kwh = s.energyToday != null ? ` — ${fmt(s.energyToday, 'kWh', 1)} generated` : '';
        msgs.push({
          level: 'info',
          text: formatAlert(
            { level: 'info', kind: 'info', title: `Solar production has stopped for today 🌙${kwh}` },
            null,
          ),
        });
      }
    } else if (!lowNow) {
      state.solar.endHits = 0;
    }
  }
  return msgs;
}

/**
 * Evaluate everything against `status`, mutating `state` and returning the messages to
 * send. The caller persists `state` and sends `messages`.
 */
export function evaluateAlerts(status, state, now = new Date()) {
  const ctx = { now, state };
  const messages = [];

  const rolled = accumulateDaily(state, status, now);
  if (rolled) messages.push({ level: 'info', text: rolled });

  rollSolarDay(state, status, now);

  for (const rule of RULES) {
    const a = slot(state, rule.id);
    let cond;
    try {
      cond = !!rule.check(status, ctx);
    } catch {
      cond = false;
    }

    if (!a.active) {
      const rearmed =
        !rule.rearmHours ||
        !a.clearedAt ||
        now - new Date(a.clearedAt) >= rule.rearmHours * 3600e3;
      if (cond && rearmed) {
        a.hits = Math.min(a.hits + 1, rule.sustain);
        if (a.hits >= rule.sustain) {
          a.active = true;
          a.since = now.toISOString();
          messages.push({
            level: rule.level,
            text: formatAlert(
              {
                level: rule.level,
                kind: rule.level === 'info' ? 'info' : 'fired',
                title: rule.title(status, ctx),
                advice: rule.advice ? rule.advice(status, ctx) : null,
              },
              status,
            ),
          });
        }
      } else {
        a.hits = 0;
      }
    } else {
      let clear;
      try {
        clear = rule.until ? !!rule.until(status, ctx) : !cond;
      } catch {
        clear = false;
      }
      if (clear) {
        const durText = a.since ? humanDuration(now - new Date(a.since)) : null;
        a.active = false;
        a.hits = 0;
        a.since = null;
        a.clearedAt = now.toISOString();
        if (rule.clearedTitle) {
          messages.push({
            level: rule.level === 'info' ? 'info' : rule.level,
            text: formatAlert(
              { level: rule.level, kind: 'cleared', title: rule.clearedTitle },
              status,
              { durationText: durText },
            ),
          });
        }
      }
    }
  }

  messages.push(...solarDayEvents(state, status, now));

  const summary = maybeDailySummary(state, now);
  if (summary) messages.push({ level: 'info', text: summary });

  // Quiet-hours filter (state already reflects reality).
  const allowed = messages.filter((m) =>
    alertsAllowedNow(m.level === 'info' ? 'warning' : m.level, now),
  );
  return { messages: allowed, suppressed: messages.length - allowed.length };
}
