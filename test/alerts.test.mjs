// Alert-rule engine tests.  Run:  npm test
import './_setup.js';
import { evaluateAlerts, activeTitles } from '../src/alerts.js';
import { estimateBackupMinutes } from '../src/dess/data.js';
import { accumulateDaily, maybeDailySummary } from '../src/daily.js';
import { freshDaily } from '../src/state.js';

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
};
const has = (r, re) => r.messages.some((m) => re.test(m.text));

const base = () => ({
  online: true,
  stale: false,
  dataAgeMin: 1,
  faulted: false,
  faultText: null,
  pvPower: 1500,
  pvVoltage: 330,
  solarProducing: true,
  batteryVoltage: 27,
  batterySoc: 100,
  batteryChargeCurrent: 5,
  batteryDischargeCurrent: 0,
  batteryCharging: true,
  batteryDischarging: false,
  batteryIdle: false,
  batteryFull: true,
  floatV: 27,
  cutoffV: 20,
  utilityComebackV: 24.5,
  chargerSolarOnly: true,
  backupRuntimeMin: 120,
  loadPower: 1000,
  loadPercent: 30,
  loadPctRated: 28,
  ratedPowerW: 3600,
  solarDeficitW: 0,
  solarSurplusW: 500,
  gridVoltage: 240,
  gridStatus: 'Mains OK',
  gridConnected: true,
  gridVoltageHigh: false,
  gridVoltageLow: false,
  gridBackV: 207,
  gridLowV: 200,
  gridHighV: 253,
  nominalAcV: 230,
  energyToday: 6,
});
const freshState = () => ({
  alerts: {},
  solar: { date: '2026-09-09', startedToday: true, endedToday: false, endHits: 0 },
  daily: freshDaily('2026-09-09'),
  startedAt: null,
});
const noon = new Date('2026-09-09T07:00:00Z'); // 12:00 PKT
const dawn = new Date('2026-09-09T00:30:00Z'); // 05:30 PKT

// --- healthy ---
{
  const st = freshState();
  const r = evaluateAlerts({ ...base(), solarSurplusW: 0 }, st, noon);
  check('healthy: no messages', r.messages.length === 0);
  check('healthy: nothing active', activeTitles(st).length === 0);
}

// --- wapda_off (sustain 2) + hysteresis ---
{
  const st = freshState();
  const off = { ...base(), gridConnected: false, gridVoltage: 5 };
  let r = evaluateAlerts(off, st, noon);
  check('wapda_off silent 1st tick', r.messages.length === 0);
  r = evaluateAlerts(off, st, noon);
  check('wapda_off fires 2nd tick', has(r, /WAPDA power is OFF/));
  r = evaluateAlerts({ ...base(), gridConnected: false, gridVoltage: 170 }, st, noon);
  check('wapda_off hysteresis at 170 V', r.messages.length === 0 && st.alerts.wapda_off.active);
  r = evaluateAlerts(base(), st, noon);
  check('wapda_off clears (RESOLVED/BACK)', has(r, /RESOLVED/) && has(r, /BACK/));
}

// --- battery low / critical by voltage ---
{
  const st = freshState();
  let r = evaluateAlerts({ ...base(), batteryVoltage: 24.3 }, st, noon);
  check('battery_low at 24.3 V', has(r, /Battery LOW/));
  r = evaluateAlerts({ ...base(), batteryVoltage: 23.1 }, st, noon);
  check('battery_critical at 23.1 V', has(r, /Battery CRITICAL/));
  r = evaluateAlerts({ ...base(), batteryVoltage: 23.7 }, st, noon);
  check('battery_critical clears at 23.7 V', has(r, /RESOLVED/));
  check('battery_low still active at 23.7 V', st.alerts.battery_low.active === true);
  r = evaluateAlerts({ ...base(), batteryVoltage: 25 }, st, noon);
  check('battery_low clears at 25 V', has(r, /RESOLVED/));
}

// --- overload (sustain 2) ---
{
  const st = freshState();
  const over = { ...base(), loadPower: 3400, loadPctRated: 94 };
  let r = evaluateAlerts(over, st, noon);
  check('overload silent 1st hit', r.messages.length === 0);
  r = evaluateAlerts(over, st, noon);
  check('overload fires 2nd hit', has(r, /OVERLOADED/));
}

// --- solar_deficit (reduce load): fires only with a real deficit; advice escalates ---
{
  const st = freshState();
  const normalEvening = {
    ...base(),
    solarProducing: false,
    pvPower: 2,
    batteryCharging: false,
    batteryDischarging: true,
    batteryChargeCurrent: 0,
    batteryDischargeCurrent: 4,
    batteryVoltage: 25.5,
    batteryFull: false,
    loadPower: 80,
    solarDeficitW: 78,
  };
  evaluateAlerts(normalEvening, st, noon);
  let r = evaluateAlerts(normalEvening, st, noon);
  check('no alert for small evening discharge', r.messages.length === 0);

  const st2 = freshState();
  const clouds = {
    ...base(),
    pvPower: 300,
    batteryCharging: false,
    batteryDischarging: true,
    batteryDischargeCurrent: 25,
    loadPower: 1800,
    solarDeficitW: 1500,
    batteryVoltage: 25.0,
  };
  evaluateAlerts(clouds, st2, noon);
  r = evaluateAlerts(clouds, st2, noon);
  check('solar_deficit fires (clouds + heavy load)', has(r, /shortfall/));
  check('solar_deficit advice = reduce load', has(r, /Reduce load|Turn off heavy loads|URGENT/));
  // drop to low battery -> URGENT wording
  const st3 = freshState();
  const urgent = { ...clouds, batteryVoltage: 23.0 };
  evaluateAlerts(urgent, st3, noon);
  r = evaluateAlerts(urgent, st3, noon);
  check('solar_deficit escalates to URGENT at critical voltage', has(r, /URGENT/));
}

// --- battery_not_switching ---
{
  const st = freshState();
  const s = {
    ...base(),
    gridConnected: true,
    gridVoltage: 235,
    batteryCharging: false,
    batteryDischarging: true,
    batteryDischargeCurrent: 15,
    batteryVoltage: 24.0, // below utilityComebackV(24.5) - 0.3
    batteryFull: false,
  };
  evaluateAlerts(s, st, noon);
  const r = evaluateAlerts(s, st, noon);
  check('battery_not_switching fires', has(r, /while WAPDA is available/i));
}

// --- grid_voltage_abnormal ---
{
  const st = freshState();
  const hi = { ...base(), gridVoltage: 275, gridVoltageHigh: true };
  evaluateAlerts(hi, st, noon);
  let r = evaluateAlerts(hi, st, noon);
  check('grid_voltage_abnormal fires (high)', has(r, /voltage HIGH/));
  r = evaluateAlerts({ ...base(), gridVoltage: 235 }, st, noon);
  check('grid_voltage_abnormal clears', has(r, /RESOLVED/));
}

// --- battery_not_charging ---
{
  const st = freshState();
  const s = {
    ...base(),
    pvPower: 2000,
    loadPower: 400, // surplus > 300
    batteryCharging: false,
    batteryChargeCurrent: 0,
    batteryDischarging: false,
    batteryIdle: true,
    batteryVoltage: 25.0, // < floatV(27) - 1
    batteryFull: false,
  };
  evaluateAlerts(s, st, noon);
  evaluateAlerts(s, st, noon);
  const r = evaluateAlerts(s, st, noon);
  check('battery_not_charging fires after 3 ticks', has(r, /isn't charging despite spare solar/i));
}

// --- pv_underperforming: silent when battery full + no demand, fires with demand ---
{
  const peak = new Date('2026-09-09T07:00:00Z'); // 12:00 PKT, inside 11-15
  const st = freshState();
  const throttled = { ...base(), pvPower: 200, batteryFull: true, batteryCharging: false, loadPctRated: 5 };
  for (let i = 0; i < 5; i++) evaluateAlerts(throttled, st, peak);
  check('pv_underperforming silent when battery full & no demand', !st.alerts.pv_underperforming?.active);

  const st2 = freshState();
  const bad = { ...base(), pvPower: 200, batteryCharging: true, loadPctRated: 50 };
  let r;
  for (let i = 0; i < 4; i++) r = evaluateAlerts(bad, st2, peak);
  check('pv_underperforming fires with demand present', has(r, /underperforming/i));
}

// --- solar_surplus: info, rearm ---
{
  const st = freshState();
  const midday = new Date('2026-09-09T06:00:00Z'); // 11:00 PKT
  const surplus = { ...base(), batteryFull: true, solarProducing: true, loadPctRated: 10, solarSurplusW: 1200 };
  evaluateAlerts(surplus, st, midday);
  let r = evaluateAlerts(surplus, st, midday);
  check('solar_surplus fires (info)', has(r, /Spare solar/i));
  // load rises -> clears (no RESOLVED because clearedTitle null)
  r = evaluateAlerts({ ...surplus, solarSurplusW: 50, loadPctRated: 60 }, st, midday);
  check('solar_surplus clears silently', r.messages.length === 0 && !st.alerts.solar_surplus.active);
  // within rearm window -> does not re-fire
  r = evaluateAlerts(surplus, st, new Date(midday.getTime() + 30 * 60000));
  r = evaluateAlerts(surplus, st, new Date(midday.getTime() + 40 * 60000));
  check('solar_surplus honours rearmHours', !st.alerts.solar_surplus.active);
}

// --- no_solar_daytime ---
{
  const st = freshState();
  const dark = { ...base(), pvPower: 5, solarProducing: false };
  let r = evaluateAlerts(dark, st, dawn);
  check('no_solar silent before daylight window', !has(r, /No solar/));
  evaluateAlerts(dark, st, noon);
  r = evaluateAlerts(dark, st, noon);
  check('no_solar silent before sustain 3', !has(r, /No solar/));
  r = evaluateAlerts(dark, st, noon);
  check('no_solar fires on 3rd daytime tick', has(r, /No solar input/));
}

// --- daily solar events + summary ---
{
  const st = freshState();
  st.solar.startedToday = false;
  const morning = new Date('2026-09-09T04:00:00Z'); // 09:00 PKT
  let r = evaluateAlerts({ ...base(), pvPower: 800 }, st, morning);
  check('daily: "solar started" fires once', has(r, /Solar production started/));
  const evening = new Date('2026-09-09T13:30:00Z'); // 18:30 PKT
  const noSun = { ...base(), pvPower: 10, solarProducing: false };
  evaluateAlerts(noSun, st, evening);
  evaluateAlerts(noSun, st, evening);
  r = evaluateAlerts(noSun, st, evening);
  check('daily: "solar stopped" fires after 3 evening ticks', has(r, /stopped for today/));
}

// --- daily summary emit-once + rollover ---
{
  const st = freshState();
  const t1 = new Date('2026-09-09T15:00:00Z'); // 20:00 PKT
  accumulateDaily(st, { ...base(), online: true, energyToday: 8.4, loadPower: 2000 }, t1);
  check('daily summary not due before hour', maybeDailySummary(st, t1) == null);
  const t2 = new Date('2026-09-09T16:10:00Z'); // 21:10 PKT
  accumulateDaily(st, { ...base(), online: true, energyToday: 8.5 }, t2);
  const sum = maybeDailySummary(st, t2);
  check('daily summary emits at DAILY_REPORT_HOUR', sum != null && /DAILY SUMMARY/.test(sum));
  check('daily summary emits only once', maybeDailySummary(st, t2) == null);
  const t3 = new Date('2026-09-10T05:00:00Z'); // next day 10:00 PKT
  const rolled = accumulateDaily(st, { ...base(), online: true }, t3);
  check('daily rolls over (fresh counters)', st.daily.date === '2026-09-10' && st.daily.summarySent === false);
  check('rollover does not re-emit (already sent)', rolled == null);
}

// --- backup estimate sanity ---
{
  const cfg = { batteryCapacityAh: 230, batteryAgeFactor: 0.8, batteryStopV: 23.0, batteryFullRestV: 25.2 };
  const full = estimateBackupMinutes({ batteryVoltage: 25.2, loadPower: 500 }, cfg);
  const low = estimateBackupMinutes({ batteryVoltage: 23.3, loadPower: 1500 }, cfg);
  check('backup estimate: full battery > low battery', full > low);
  check('backup estimate: low+heavy load is short (<40m)', low < 40 && low > 0);
  check('backup estimate: null without capacity', estimateBackupMinutes({ batteryVoltage: 24, loadPower: 500 }, { batteryCapacityAh: 0 }) == null);
}

// Quiet-hours filtering is verified separately:  QUIET_HOURS=0-23 npm run check-alerts

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
