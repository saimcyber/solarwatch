import axios from 'axios';
import { config } from '../config.js';

// Generic webhook notifier. Works with Discord, Slack, ntfy, or any endpoint that
// accepts a POST. Format is chosen with WEBHOOK_FORMAT:
//   json   (default) -> body { "text": "<message>" }
//   slack            -> body { "text": "<message>" }
//   discord          -> body { "content": "<message>" }
//   ntfy             -> raw text body, Content-Type: text/plain

export async function start() {
  if (!config.webhook.url) throw new Error('NOTIFY_DRIVER=webhook but WEBHOOK_URL is not set.');
}

export async function stop() {}

export async function send(text) {
  const { url, format } = config.webhook;
  if (!url) throw new Error('WEBHOOK_URL is not set.');

  if (format === 'ntfy') {
    await axios.post(url, text, { headers: { 'Content-Type': 'text/plain' }, timeout: 15000 });
    return;
  }

  const key = format === 'discord' ? 'content' : 'text';
  await axios.post(url, { [key]: text }, { timeout: 15000 });
}

const NOT_WHATSAPP = () => {
  throw new Error('That command only works with NOTIFY_DRIVER=whatsapp.');
};
export const listGroups = NOT_WHATSAPP;
export const joinGroupByInvite = NOT_WHATSAPP;
