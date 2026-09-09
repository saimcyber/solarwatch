// Fallback only: estimate battery state-of-charge from resting voltage when the
// inverter does not report a SOC percentage directly. Approximate LiFePO4 rest
// curve per 12 V nominal block, scaled to the configured bank voltage.
// Monotonic by construction, so linear interpolation between points is safe.
const NOMINAL = 12;
const CURVE = [
  [100, 13.4],
  [90, 13.2],
  [80, 13.15],
  [70, 13.1],
  [60, 13.05],
  [50, 13.0],
  [40, 12.9],
  [30, 12.8],
  [20, 12.5],
  [10, 12.0],
  [0, 10.0],
];

export function getPercentByVoltage(voltage, bankVoltage = 48) {
  if (!Number.isFinite(voltage) || voltage <= 0) return null;
  const per12 = (voltage * NOMINAL) / (bankVoltage || 48);

  if (per12 >= CURVE[0][1]) return 100;
  if (per12 <= CURVE[CURVE.length - 1][1]) return 0;

  for (let i = 0; i < CURVE.length - 1; i++) {
    const [hiPct, hiV] = CURVE[i];
    const [loPct, loV] = CURVE[i + 1];
    if (per12 <= hiV && per12 >= loV) {
      return loPct + ((per12 - loV) / (hiV - loV)) * (hiPct - loPct);
    }
  }
  return null;
}
