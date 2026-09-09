// Join a WhatsApp group from an invite link/code with the linked bot account,
// then print the group id for .env.
//
//   npm run join-group -- "https://chat.whatsapp.com/XXXXXXXXXXXX"
//   npm run join-group -- XXXXXXXXXXXX
//
// The WhatsApp session must already be linked (run `npm run list-groups` once and
// scan the QR).
import { config } from '../src/config.js';
import { joinGroupByInvite, stop } from '../src/notify/whatsapp.js';

function parseInviteCode(arg) {
  if (!arg) return null;
  const m = arg.match(/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]+)/);
  return m ? m[1] : arg.trim();
}

async function main() {
  if (config.notify.driver !== 'whatsapp') {
    console.error(`NOTIFY_DRIVER is "${config.notify.driver}" — this command only applies to WhatsApp.`);
    process.exit(1);
  }
  const code = parseInviteCode(process.argv[2]);
  if (!code) {
    console.error('Usage: npm run join-group -- "<invite link or code>"');
    process.exit(1);
  }

  const groupId = await joinGroupByInvite(code);
  console.log(`\nJoined. Paste into .env:\n\nWHATSAPP_GROUP_ID=${groupId}`);

  await stop();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Failed:', err.message);
  await stop().catch(() => {});
  process.exit(1);
});
