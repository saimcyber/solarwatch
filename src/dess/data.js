import { config, resolveGridBand } from '../config.js';
import { request } from './client.js';
import { getPercentByVoltage } from './voltage.js';

const STATUS_LABEL = ['Online', 'Offline', 'Fault', 'Standby', 'Warning'];

/** List every device on the account with its identifiers and status. */
export async function listDevices() {
  const dat = await request({
    action: 'webQueryDeviceEs',
    i18n: 'en_US',
    source: '1',
    page: '0',
    pagesize: '50',
  });
  return (dat.device || []).map(mapDevice);
}

function mapDevice(d) {
  return {
    name: d.devalias || d.pn,
    pn: String(d.pn),
    sn: String(d.sn),
    devcode: String(d.devcode),
    devaddr: String(d.devaddr),
    devtype: d.devtype,
    status: Number(d.status),
    statusLabel: STATUS_LABEL[Number(d.status)] ?? `status ${d.status}`,
    energyToday: d.energyToday,
    energyTotal: d.energyTotal,
    outpower: d.outpower,
  };
}

/** Raw latest-data payload for a device (used by discovery scripts). */
export async function queryLastDataRaw(device) {
  return request({
    action: 'querySPDeviceLastData',
    i18n: 'en_US',
    pn: device.pn,
    devcode: device.devcode,
    devaddr: device.devaddr,
    sn: device.sn,
    source: '1',
  });
}

export async function queryEnergyFlowRaw(device) {
  return request({
    action: 'webQueryDeviceEnergyFlowEs',
    pn: device.pn,
    devcode: device.devcode,
    devaddr: device.devaddr,
    sn: device.sn,
    source: '1',
  });
}

async function queryDeviceRow(device) {
  const dat = await request({
    action: 'webQueryDeviceEs',
    i18n: 'en_US',
    source: '1',
    page: '0',
    pagesize: '15',
    pn: device.pn,
  });
  const row = (dat.device || []).find((d) => String(d.sn) === String(device.sn)) || dat.device?.[0];
  return row ? mapDevice(row) : null;
}

// Flatten `pars` ({ bt_: [{id,par,val,unit}], pv_: [...], ... }) into a lookup by id.
function flattenPars(pars = {}) {
  const map = new Map();
  for (const group of Object.values(pars)) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const key = item?.id ?? item?.par;
      if (key != null && !map.has(key)) map.set(key, item);
    }
  }
  return map;
}

function num(item) {
  if (!item) return null;
  const n = Number(item.val);
  return Number.isFinite(n) ? n : null;
}

// Read a value from the energy-flow payload, normalising kW payloads to W.
function flowVal(flow, key, par) {
  const hit = flow?.[key]?.find?.((i) => i.par === par);
  if (!hit) return null;
  const n = Number(hit.val);
  if (!Number.isFinite(n)) return null;
  return /kw/i.test(hit.unit || '') ? n * 1000 : n;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Rough backup-time estimate for a lead-acid bank at the current load.
 * Deliberately conservative — battery voltage sags under load, so the estimate
 * reads low, which is the safe direction for a "running out" warning.
 * Returns minutes, or null if BATTERY_CAPACITY_AH is not configured.
 */
export function estimateBackupMinutes(s, a = config.alerts) {
  if (!a.batteryCapacityAh || s.batteryVoltage == null) return null;
  const load = Math.max(s.loadPower ?? 0, 50);
  const frac = clamp01((s.batteryVoltage - a.batteryStopV) / (a.batteryFullRestV - a.batteryStopV));
  // 0.55 ≈ lead-acid usable fraction + Peukert losses at household loads
  const availableWh = a.batteryCapacityAh * 24 * a.batteryAgeFactor * 0.55 * frac;
  return Math.round((availableWh / load) * 60);
}

/** Minutes since a DESS timestamp (epoch ms number, or "YYYY-MM-DD HH:mm:ss" in UTC+8). */
function ageMinutes(updatedAt) {
  if (updatedAt == null) return null;
  let t;
  if (typeof updatedAt === 'number' || /^\d{10,}$/.test(String(updatedAt))) {
    t = Number(updatedAt);
  } else {
    t = Date.parse(`${String(updatedAt).replace(' ', 'T')}+08:00`); // DESS strings are Beijing time
  }
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 60000);
}

/**
 * Fetch and normalise the current status of a device.
 *
 * The parameter IDs below match a common DESS protocol (devcode 2341 — a 3 kW 24 V
 * hybrid) and each reading uses a `??` fallback chain that covers several inverters.
 * If a value reads `—` on your inverter, add its parameter id to the relevant chain —
 * `npm run list-devices` dumps every id your account exposes. See the README.
 *
 * Shapes:
 *  querySPDeviceLastData      → { dat: { gts, pars: { gd_/sy_/pv_/bt_/bc_: [{id,par,val,unit}] } } }
 *  webQueryDeviceEnergyFlowEs → { dat: { status, date, pv_status/bc_status/…: [{par,val,unit}] } }
 */
export async function getStatus(device = config.dess.device) {
  const [last, flow, row] = await Promise.all([
    queryLastDataRaw(device).catch((e) => ({ _error: e.message, pars: {} })),
    queryEnergyFlowRaw(device).catch(() => null),
    queryDeviceRow(device).catch(() => null),
  ]);

  const p = flattenPars(last.pars);
  const g = (id) => p.get(id);

  const ratedBattery = num(g('sy_rated_battery_voltage')) || config.dess.batteryVoltage;
  const batteryVoltage = num(g('bt_battery_voltage'));

  // Prefer a device-reported SOC (bt_battery_capacity), else estimate from voltage.
  const reportedSoc =
    num(g('bt_battery_capacity')) ?? num(g('bt_battery_soc')) ?? num(g('bt_state_of_charge'));
  const batterySoc =
    reportedSoc != null ? reportedSoc : round(getPercentByVoltage(batteryVoltage, ratedBattery), 0);

  const updatedAt = flow?.date || last.gts || null;
  const dataAgeMin = ageMinutes(updatedAt);
  const stale = dataAgeMin != null && dataAgeMin > config.alerts.staleDataMin;

  const flowStatus = Number(flow?.status);
  const reachable = Number.isFinite(flowStatus)
    ? flowStatus === 0
    : row
      ? row.status === 0
      : !last._error;
  const online = reachable && !stale;

  const pvPower =
    num(g('pv_output_power')) ?? flowVal(flow, 'pv_status', 'pv_output_power');
  const pvVoltage = num(g('pv_input_voltage')) ?? num(g('pv_output_voltage'));

  const chargeA = num(g('bt_battery_charging_current'));
  const dischargeA = num(g('bt_battery_discharge_current'));
  const batteryStatus = g('bt_battery_status')?.val ?? null;
  const batteryCharging = (chargeA ?? 0) > 0 || /charg(e|ing)/i.test(batteryStatus || '');
  const batteryDischarging =
    (dischargeA ?? 0) > 0 || /dischar/i.test(batteryStatus || '');
  const batteryIdle = !batteryCharging && !batteryDischarging;
  const batteryPowerW =
    batteryVoltage != null
      ? Math.round((chargeA ? chargeA : dischargeA ? -dischargeA : 0) * batteryVoltage)
      : null;

  const floatV = num(g('bt_floating_charging_voltage'));
  const cutoffV = num(g('bt_battery_cut_off_voltage'));
  const utilityComebackV = num(g('bt_comeback_utility_iode'));
  const chargerSolarOnly = /solar only/i.test(g('bt_charger_source_priority')?.val || '');
  const batteryFull =
    (reportedSoc != null && reportedSoc >= 98) ||
    (floatV != null && batteryVoltage != null && batteryVoltage >= floatV - 0.3);

  const loadPower =
    flowVal(flow, 'bc_status', 'load_active_power') ??
    num(g('bc_output_active_power')) ??
    num(g('bc_output_apparent_power'));
  const ratedPowerW = num(g('sy_nonimal_output_active_power')) ?? num(g('sy_nonimal_output_apparent_power'));
  const loadPercent = num(g('bc_battery_capacity')); // labelled "AC Output Load"
  const loadPctRated =
    loadPower != null && ratedPowerW ? (loadPower / ratedPowerW) * 100 : loadPercent;

  const nominalAcV = num(g('sy_nominal_ac_voltage')) || num(g('sy_nominal_output_voltage')) || 230;
  const gridBand = resolveGridBand(nominalAcV);
  const gridVoltage = num(g('gd_ac_input_voltage'));
  const gridStatus = g('gd_mains_status')?.val ?? null;
  const gridConnected =
    (gridVoltage != null && gridVoltage >= gridBand.minV) || /ok|normal/i.test(gridStatus || '');
  const gridVoltageHigh = gridConnected && gridVoltage != null && gridVoltage > gridBand.highV;
  const gridVoltageLow = gridConnected && gridVoltage != null && gridVoltage < gridBand.lowV;

  const solarDeficitW =
    batteryDischarging && pvPower != null && loadPower != null && loadPower > pvPower
      ? Math.round(loadPower - pvPower)
      : 0;
  const solarSurplusW =
    pvPower != null && loadPower != null && pvPower > loadPower ? Math.round(pvPower - loadPower) : 0;

  const workingState = g('sy_status')?.val ?? null;
  const loadStatus = g('bc_load_status')?.val ?? null;
  const statusLabel = row?.statusLabel ?? (reachable ? 'Online' : last._error ? 'Unreachable' : 'Offline');
  const faultText = [workingState, loadStatus, statusLabel].find((t) => /fault|error|abnormal/i.test(t || ''));
  const faulted = !!faultText;

  const result = {
    deviceName: device.name || row?.name || device.pn,
    online,
    reachable,
    stale,
    statusLabel,
    workingState,
    loadStatus,
    faulted,
    faultText: faultText || null,
    updatedAt,
    dataAgeMin,
    error: last._error || null,

    pvPower,
    pvVoltage,
    solarProducing: pvPower != null && pvPower >= config.alerts.solarMinW,

    batteryVoltage,
    batterySoc,
    batteryChargeCurrent: chargeA,
    batteryDischargeCurrent: dischargeA,
    batteryStatus,
    batteryCharging,
    batteryDischarging,
    batteryIdle,
    batteryPowerW,
    batteryFull,
    floatV,
    cutoffV,
    utilityComebackV,
    chargerSolarOnly,

    loadPower,
    loadPercent,
    loadPctRated,
    ratedPowerW,
    solarDeficitW,
    solarSurplusW,

    gridVoltage,
    gridStatus,
    gridConnected,
    gridVoltageHigh,
    gridVoltageLow,
    gridBackV: gridBand.backV,
    gridLowV: gridBand.lowV,
    gridHighV: gridBand.highV,
    nominalAcV,
    outputPriority: g('bc_output_source_priority')?.val ?? null,

    energyToday: row?.energyToday != null ? Number(row.energyToday) : null,
  };

  result.backupRuntimeMin = estimateBackupMinutes(result);
  return result;
}

function round(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
