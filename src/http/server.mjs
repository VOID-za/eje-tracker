/**
 * The HTTP layer: node:http, a small route table, and no framework.
 *
 * SECURE BY DEFAULT IN BOTH DIRECTIONS. Every route requires a session unless
 * it appears in PUBLIC; every mutating request requires a CSRF token bound to
 * that session; every response carries the security headers. A route that
 * forgets to ask for any of this still gets all of it, because the gate is
 * here and not in the handlers.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { config } from '../config.mjs';
import { db } from '../db/client.mjs';
import { toString } from './html.mjs';
import {
  COOKIE, clearedCookie, csrfTokenFor, csrfValid, readCookie, userForToken,
} from '../auth/sessions.mjs';

/**
 * The pre-session CSRF seed.
 *
 * A browser that has not signed in yet still has to post the login form, and a
 * token derived from "no session" would be the same for everybody. So every
 * visitor gets a random seed cookie, and the login form's token is derived from
 * theirs. After sign-in the token is derived from the session itself.
 */
const CSRF_COOKIE = 'eje_tracker_csrf';

const seedCookie = (value) => {
  const parts = [`${CSRF_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=86400'];
  if (!config.insecureCookies) parts.push('Secure');
  return parts.join('; ');
};

/** Routes that may be reached without a session. */
const PUBLIC = new Set(['GET /login', 'POST /login', 'GET /healthz']);

/** 64 KB is far more than any form here sends; beyond it the request is refused. */
const MAX_BODY = 64 * 1024;

const SECURITY_HEADERS = {
  // The tracker serves no JavaScript at all, so script-src can be closed entirely.
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
    "form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

const readBody = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      throw Object.assign(new Error('Request body too large.'), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const parseForm = (body) => {
  const fields = {};
  for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
  return fields;
};

export const audit = async (entry, sql = db()) => {
  await sql`INSERT INTO audit_log ${sql({
    actor: entry.actor ?? 'anonymous',
    action: entry.action,
    target: entry.target ?? '',
    detail: entry.detail ?? '',
    ip: entry.ip ?? '',
  })}`;
};

/** Response helpers handlers return. Nothing writes to `res` directly. */
export const page = (node, { status = 200, headers = {} } = {}) => ({
  status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: toString(node),
});

export const json = (data, { status = 200, headers = {} } = {}) => ({
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  body: JSON.stringify(data, null, 2),
});

export const redirect = (location, { headers = {} } = {}) => ({
  status: 303, headers: { location, ...headers }, body: '',
});

export const text = (body, { status = 200, headers = {} } = {}) => ({
  status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers }, body,
});

/**
 * Matches `/items/:id` style patterns. Deliberately tiny: the tracker has a
 * dozen routes, and a router nobody can read is a router nobody can audit.
 */
const matchRoute = (routes, method, pathname) => {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.path === pathname) return { route, params: {} };
    if (!route.path.includes(':')) continue;
    const wanted = route.path.split('/');
    const actual = pathname.split('/');
    if (wanted.length !== actual.length) continue;
    const params = {};
    let ok = true;
    for (let index = 0; index < wanted.length; index += 1) {
      const part = wanted[index];
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(actual[index]);
      else if (part !== actual[index]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
};

export const createTracker = ({ routes, onNotFound, onError, onUnauthenticated, onForbidden }) => {
  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const key = `${method} ${pathname}`;
    const ip = String(req.socket.remoteAddress ?? '');

    // A session token may also be presented as a bearer header, which is what
    // makes the JSON API usable from curl over the SSH tunnel. It is accepted
    // for READS ONLY: a bearer request cannot carry a CSRF token bound to a
    // browser session, so it must never be able to change anything.
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? null;
    const token = readCookie(req.headers.cookie, COOKIE) ?? (method === 'GET' ? bearer : null);
    const user = PUBLIC.has(key) && method === 'GET' ? null : await userForToken(token);

    // CSRF is bound to the session where there is one, and to a random seed
    // cookie where there is not — so the login form has a token of its own and
    // it is never the same value for two visitors.
    let seed = readCookie(req.headers.cookie, CSRF_COOKIE);
    let issuedSeed = null;
    if (seed === null || seed.length < 20) {
      seed = randomBytes(24).toString('base64url');
      issuedSeed = seedCookie(seed);
    }
    const csrf = csrfTokenFor(token ?? seed);

    const found = matchRoute(routes, method, pathname);
    if (found === null) return onNotFound({ url, user, csrf, pathname });

    if (!PUBLIC.has(key) && user === null) {
      return onUnauthenticated({ url, pathname });
    }

    let form = {};
    if (method === 'POST') {
      const body = await readBody(req);
      form = parseForm(body);
      // CSRF: the token is derived from the session cookie, so a form posted
      // from anywhere else cannot carry a valid one.
      if (!csrfValid(token ?? seed, form.csrf)) {
        await audit({ actor: user?.email ?? 'anonymous', action: 'csrf.rejected', target: key, ip });
        return onForbidden({ reason: 'This form has expired. Reload the page and try again.' });
      }
    }

    const result = await found.route.handler({
      req, url, params: found.params, query: Object.fromEntries(url.searchParams),
      form, user, csrf, token, ip, pathname,
    });
    return issuedSeed === null ? result : withCookie(result, issuedSeed);
  };

  return createServer((req, res) => {
    handle(req, res)
      .catch((error) => {
        const status = error?.status ?? 500;
        if (status >= 500) console.error('tracker  request failed:', error);
        return onError({ error, status });
      })
      .then((result) => {
        const headers = { ...SECURITY_HEADERS, ...result.headers };
        if (!config.insecureCookies) {
          headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
        }
        res.writeHead(result.status, headers);
        res.end(req.method === 'HEAD' ? undefined : result.body);
      })
      .catch((error) => {
        console.error('tracker  failed to respond:', error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal error');
      });
  });
};

/** Adds a Set-Cookie without discarding one a handler already set. */
const withCookie = (result, cookie) => {
  const existing = result.headers?.['set-cookie'];
  const combined = existing === undefined
    ? cookie
    : [...(Array.isArray(existing) ? existing : [existing]), cookie];
  return { ...result, headers: { ...result.headers, 'set-cookie': combined } };
};
