// Logs in to DessMonitor and lists every device with the identifiers needed for
// .env. Also writes the raw latest-data / energy-flow payloads to a temp file so
// the field mapping in src/dess/data.js can be checked against a real response.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDevices, queryLastDataRaw, queryEnergyFlowRaw } from '../src/dess/data.js';

async function main() {
  const devices = await listDevices();
  if (!devices.length) {
    console.log('No devices found on this account.');
    return;
  }

  for (const d of devices) {
    console.log('─'.repeat(60));
    console.log(`  ${d.name}  (${d.devtype || 'device'}, ${d.statusLabel})`);
    console.log(`  energy today: ${d.energyToday} kWh   total: ${d.energyTotal} kWh`);
    console.log('');
    console.log(`  DESS_PN=${d.pn}`);
    console.log(`  DESS_SN=${d.sn}`);
    console.log(`  DESS_DEVCODE=${d.devcode}`);
    console.log(`  DESS_DEVADDR=${d.devaddr}`);
  }
  console.log('─'.repeat(60));
  console.log('\nPaste the block for your inverter into .env\n');

  const target = devices[0];
  const [last, flow] = await Promise.all([
    queryLastDataRaw(target).catch((e) => ({ error: e.message })),
    queryEnergyFlowRaw(target).catch((e) => ({ error: e.message })),
  ]);
  const outFile = path.join(os.tmpdir(), `solarwatch-${target.sn}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ lastData: last, energyFlow: flow }, null, 2));
  console.log(`Raw payload for "${target.name}" written to:\n  ${outFile}`);
  console.log('If a message field shows "—", check the parameter ids there.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
