import crypto from 'node:crypto';
import querystring from 'node:querystring';

/** SHA1 hex digest. */
export function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

/**
 * Turn a params object into the query string the DessMonitor backend signs.
 * Matches the encoding used by the dessmonitor.com web app: a handful of
 * percent-escapes are turned back into their literal characters.
 * (Ported from github.com/Antoxa1081/smart-ess-api-gateway src/lib/utils.ts)
 */
export function transferUriStr(obj) {
  return querystring
    .stringify(obj)
    .replace(/%20/g, '+')
    .replace(/%2B/g, '+')
    .replace(/%3A/g, ':')
    .replace(/%2C/g, ',')
    .replace(/%40/g, '@')
    .replace(/%24/g, '$')
    .replace(/%26/g, '&')
    .replace(/%3D/g, '=')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

/** Signature for the login (`authSource`) request. */
export function buildAuthSign(salt, passwordSha1, params) {
  const uriStr = transferUriStr(cleanParams(params));
  return sha1(`${salt}${passwordSha1}&${uriStr}`);
}

/** Signature for an authenticated data request. */
export function buildSign(salt, secret, token, params) {
  const uriStr = transferUriStr(cleanParams(params));
  return sha1(`${salt}${secret}${token}&${uriStr}`);
}

export function newSalt() {
  return Date.now().toString();
}
