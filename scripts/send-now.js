// One-off: fetch current status and send the heartbeat via the configured notifier.
import { requireDevice } from '../src/config.js';
import { getStatus } from '../src/dess/data.js';
import { formatHeartbeat } from '../src/format.js';
import { activeTitles } from '../src/alerts.js';
import { loadState } from '../src/state.js';
import { start, send, stop } from '../src/notify/index.js';

async function main() {
  const status = await getStatus(requireDevice());
  const message = formatHeartbeat(status, { activeTitles: activeTitles(loadState()) });
  console.log('\n' + message + '\n');

  await start();
  await send(message);
  console.log('Sent.');
  await stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await stop().catch(() => {});
  process.exit(1);
});
