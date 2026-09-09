// Prints every WhatsApp group the linked account is in, with its id.
// On first run you will be prompted to scan a QR code.
import { config } from '../src/config.js';
import { listGroups, stop } from '../src/notify/whatsapp.js';

async function main() {
  if (config.notify.driver !== 'whatsapp') {
    console.error(`NOTIFY_DRIVER is "${config.notify.driver}" — this command only applies to WhatsApp.`);
    process.exit(1);
  }
  const groups = await listGroups();
  if (!groups.length) {
    console.log('No group chats found.');
  } else {
    console.log('\nGroups:\n');
    for (const g of groups) {
      console.log(`  ${g.name}`);
      console.log(`  WHATSAPP_GROUP_ID=${g.id}\n`);
    }
    console.log('Paste the WHATSAPP_GROUP_ID line for your target group into .env');
  }
  await stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await stop().catch(() => {});
  process.exit(1);
});
