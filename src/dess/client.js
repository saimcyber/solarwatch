import axios from 'axios';
import { config, requireDessAuth } from '../config.js';
import { buildAuthSign, buildSign, newSalt, sha1 } from './sign.js';

// The dessmonitor.com web app talks to this host with SHA1-signed requests.
const BASE_URL = 'https://web.dessmonitor.com';

const http = axios.create({ baseURL: BASE_URL, timeout: 20000 });

let auth = null; // { token, secret, expiresAt }

async function login() {
  requireDessAuth();
  const salt = newSalt();
  const params = {
    action: 'authSource',
    usr: config.dess.username,
    source: '1',
    'company-key': config.dess.companyKey,
  };
  const sign = buildAuthSign(salt, sha1(config.dess.password), params);

  const { data } = await http.get('/public/', { params: { sign, salt, ...params } });
  if (data.err !== 0 || !data.dat?.token) {
    throw new Error(`DessMonitor login failed: ${data.err} ${data.desc || ''}`.trim());
  }

  const { token, secret, expire } = data.dat;
  const lifetimeMs = Number(expire) * 1000 || 24 * 60 * 60 * 1000;
  // Renew an hour early, but never treat a short-lived token as already expired.
  const renewMs = Math.min(60 * 60 * 1000, lifetimeMs / 2);
  auth = { token, secret, expiresAt: Date.now() + lifetimeMs - renewMs };
  return auth;
}

async function ensureAuth() {
  if (!auth || Date.now() >= auth.expiresAt) await login();
  return auth;
}

/**
 * Perform a signed GET and return the `dat` payload.
 * `params` must start with `action` so the signature is stable.
 */
export async function request(params, path = '/public/') {
  const { token, secret } = await ensureAuth();
  const salt = newSalt();
  const sign = buildSign(salt, secret, token, params);

  const { data } = await http.get(path, { params: { sign, salt, token, ...params } });
  if (data.err !== 0) {
    throw new Error(`DessMonitor ${params.action} error: ${data.err} ${data.desc || ''}`.trim());
  }
  return data.dat;
}
