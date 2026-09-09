import path from 'node:path';
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config, dataDir } from '../config.js';

const AUTH_DIR = path.join(dataDir(), '.baileys_auth');
const CONNECT_TIMEOUT_MS = 90000;
const logger = pino({ level: 'silent' });

let sock = null;
let openPromise = null;
let stopped = false;

async function connect(onOpen, onFatal) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['SolarWatch', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR with WhatsApp (Settings → Linked devices → Link a device):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('WhatsApp: connected.');
      onOpen(sock);
    }

    if (connection === 'close') {
      if (stopped) return;
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        onFatal(new Error(`WhatsApp logged out. Delete "${AUTH_DIR}" and re-link with \`npm run list-groups\`.`));
        return;
      }
      // 515 restartRequired (normal right after pairing) or a dropped link — reconnect.
      console.warn(`WhatsApp: connection closed (code ${code ?? 'n/a'}), reconnecting...`);
      setTimeout(() => connect(onOpen, onFatal).catch(onFatal), 2000);
    }
  });
}

/** Connect (or reuse an open connection) and resolve with the socket once ready. */
export function start() {
  if (openPromise) return openPromise;
  stopped = false;
  openPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => (arg) => {
      if (settled) {
        if (arg instanceof Error) console.error('WhatsApp:', arg.message);
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (fn === reject) openPromise = null;
      fn(arg);
    };
    const timer = setTimeout(
      () => finish(reject)(new Error(`WhatsApp did not connect within ${CONNECT_TIMEOUT_MS / 1000}s.`)),
      CONNECT_TIMEOUT_MS,
    );
    connect(finish(resolve), finish(reject)).catch(finish(reject));
  });
  return openPromise;
}

export async function stop() {
  stopped = true;
  openPromise = null;
  try {
    sock?.end?.(undefined);
  } catch {
    /* ignore */
  }
  sock = null;
}

/** All groups the linked account is in, as { name, id }. */
export async function listGroups() {
  const s = await start();
  const groups = await s.groupFetchAllParticipating();
  return Object.values(groups).map((g) => ({ name: g.subject, id: g.id }));
}

/** Join a group from an invite code; returns the group jid. */
export async function joinGroupByInvite(code) {
  const s = await start();
  return s.groupAcceptInvite(code);
}

async function resolveGroupId(s) {
  if (config.whatsapp.groupId) return config.whatsapp.groupId;
  if (!config.whatsapp.groupName) {
    throw new Error('Set WHATSAPP_GROUP_ID (preferred) or WHATSAPP_GROUP_NAME in .env. Run `npm run list-groups`.');
  }
  const groups = await s.groupFetchAllParticipating();
  const match = Object.values(groups).find((g) => g.subject === config.whatsapp.groupName);
  if (!match) throw new Error(`No group named "${config.whatsapp.groupName}". Run \`npm run list-groups\`.`);
  return match.id;
}

/** Send a message to the configured WhatsApp group. */
export async function send(text) {
  const s = await start();
  const groupId = await resolveGroupId(s);
  await s.sendMessage(groupId, { text });
}
