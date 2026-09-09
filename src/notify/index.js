import { config } from '../config.js';
import * as whatsapp from './whatsapp.js';
import * as webhook from './webhook.js';

const drivers = { whatsapp, webhook };

/** The active notifier driver, chosen by NOTIFY_DRIVER (default: whatsapp). */
export function notifier() {
  const d = drivers[config.notify.driver];
  if (!d) {
    throw new Error(`Unknown NOTIFY_DRIVER "${config.notify.driver}" (expected: ${Object.keys(drivers).join(', ')}).`);
  }
  return d;
}

export const start = (...a) => notifier().start(...a);
export const stop = (...a) => notifier().stop(...a);
export const send = (...a) => notifier().send(...a);
