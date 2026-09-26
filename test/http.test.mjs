/**
 * The gate, end to end.
 *
 * These tests drive a real server on a real port against the TEST database, and
 * they assert the things that would be quietly catastrophic if they broke: a
 * page that answers without a session, an API that answers without one, a form
 * that is accepted without a CSRF token, a bearer token that can change
 * something, a missing security header.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDatabase, testUrl } from './helpers.mjs';

const options = describeDatabase === null ? {} : { skip: describeDatabase };

const PASSWORD = 'tracker-test-password';

/** Starts a tracker against a freshly migrated test database. */
const start = async () => {
  process.env.TRACKER_DATABASE_URL = testUrl;
  process.env.TRACKER_INSECURE_COOKIES = 'yes';
  const { freshDatabase } = await import('./helpers.mjs');
  const { close } = await freshDatabase();
  await close();

  const { db, closeDb } = await import('../src/db/client.mjs');
  const { createTracker } = await import('../src/http/server.mjs');
  const { routes, handlers } = await import('../src/http/routes.mjs');
  const { hashPassword } = await import('../src/auth/passwords.mjs');
  const { saveItem } = await import('../src/repo/items.mjs');

  const sql = db();
  await sql`INSERT INTO users (email, display_name, password_hash)
            VALUES ('tester@example.test', 'Tester', ${await hashPassword(PASSWORD)})`;
  await saveItem({ id: 'T-1', kind: 'Requirement', title: 'A tracked thing', status: 'OPEN' }, {}, sql);

  const server = createTracker({ routes, ...handlers });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
      await closeDb();
    },
  };
};

const cookieJar = () => {
  const jar = new Map();
  return {
    take: (response) => {
      for (const header of response.headers.getSetCookie()) {
        const [pair] = header.split(';');
        const index = pair.indexOf('=');
        jar.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header: () => [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
  };
};

const csrfFrom = (body) => /name="csrf" value="([a-f0-9]+)"/.exec(body)?.[1] ?? '';

test('the tracker answers nothing useful without a session', options, async () => {
  const { base, stop } = await start();
  try {
    const page = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get('location'), '/login');

    for (const path of ['/items', '/rules', '/decisions', '/releases', '/history']) {
      const response = await fetch(`${base}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 303, `${path} answered without a session`);
    }
    for (const path of ['/api/summary', '/api/items', '/api/rules']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 401, `${path} answered without a session`);
    }
  } finally {
    await stop();
  }
});

test('every response carries the security headers', options, async () => {
  const { base, stop } = await start();
  try {
    const response = await fetch(`${base}/login`);
    assert.match(response.headers.get('content-security-policy'), /script-src|default-src 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const cookie = response.headers.getSetCookie().join(' ');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  } finally {
    await stop();
  }
});

test('a login without a CSRF token is refused', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const response = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    });
    assert.equal(response.status, 403);
  } finally {
    await stop();
  }
});

test('a wrong password and a wrong email are the same answer', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());

    const post = (body) =>
      fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
        body: new URLSearchParams({ csrf, ...body }),
        redirect: 'manual',
      });

    const wrongPassword = await post({ email: 'tester@example.test', password: 'nope' });
    const wrongEmail = await post({ email: 'nobody@example.test', password: PASSWORD });
    assert.equal(wrongPassword.headers.get('location'), '/login?error=1');
    assert.equal(wrongEmail.headers.get('location'), '/login?error=1');
    assert.equal(wrongPassword.headers.getSetCookie().some((c) => c.startsWith('eje_tracker_session')), false);
  } finally {
    await stop();
  }
});

test('a signed-in browser can read every page and the API', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    });
    assert.equal(login.status, 303);
    assert.equal(login.headers.get('location'), '/');
    jar.take(login);

    for (const path of ['/', '/items', '/items/T-1', '/rules', '/decisions', '/releases', '/verification', '/history']) {
      const response = await fetch(`${base}${path}`, { headers: { cookie: jar.header() } });
      assert.equal(response.status, 200, `${path} was not readable`);
      const body = await response.text();
      assert.match(body, /<!doctype html>/i);
    }

    const summary = await fetch(`${base}/api/summary`, { headers: { cookie: jar.header() } });
    assert.equal(summary.status, 200);
    const payload = await summary.json();
    assert.equal(payload.summary.all, 1);
    assert.equal(payload.summary.done, 0);
  } finally {
    await stop();
  }
});

test('a bearer token reads but can never write', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    });
    const session = login.headers.getSetCookie()
      .map((header) => /eje_tracker_session=([^;]+)/.exec(header)?.[1])
      .find(Boolean);
    assert.ok(session, 'no session cookie was issued');

    const read = await fetch(`${base}/api/items`, { headers: { authorization: `Bearer ${session}` } });
    assert.equal(read.status, 200);

    const write = await fetch(`${base}/items/T-1/status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ status: 'DONE' }),
      redirect: 'manual',
    });
    assert.equal(write.status, 303, 'a bearer write must land on the sign-in page, not on a change');
    assert.equal(write.headers.get('location'), '/login');
  } finally {
    await stop();
  }
});

test('a status change from the UI obeys the lifecycle and is audited', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    jar.take(await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    }));

    const page = await fetch(`${base}/items/T-1`, { headers: { cookie: jar.header() } });
    const pageCsrf = csrfFrom(await page.text());

    const refused = await fetch(`${base}/items/T-1/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf: pageCsrf, status: 'DONE' }),
      redirect: 'manual',
    });
    assert.equal(refused.status, 409);

    const accepted = await fetch(`${base}/items/T-1/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf: pageCsrf, status: 'IN_PROGRESS', note: 'started' }),
      redirect: 'manual',
    });
    assert.equal(accepted.status, 303);

    const { db } = await import('../src/db/client.mjs');
    const audit = await db()`SELECT action, actor FROM audit_log ORDER BY id`;
    assert.ok(audit.some((row) => row.action === 'login'));
    assert.ok(audit.some((row) => row.action === 'item.status' && row.actor === 'tester@example.test'));
    assert.ok(audit.some((row) => row.action === 'item.status.refused'));
  } finally {
    await stop();
  }
});

test('signing out ends the session at the server, not only in the browser', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    });
    jar.take(login);
    const stolen = jar.header();

    const page = await fetch(`${base}/`, { headers: { cookie: stolen } });
    const pageCsrf = csrfFrom(await page.text());
    const out = await fetch(`${base}/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: stolen },
      body: new URLSearchParams({ csrf: pageCsrf }),
      redirect: 'manual',
    });
    assert.equal(out.status, 303);

    const after = await fetch(`${base}/`, { headers: { cookie: stolen }, redirect: 'manual' });
    assert.equal(after.status, 303, 'the old cookie still worked after signing out');
  } finally {
    await stop();
  }
});

test('no page links to an address that does not exist', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    jar.take(await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    }));

    // Give the ledger a history entry of every entity type, because the dead
    // links this test exists for were import and rule entries linked as items.
    const { db } = await import('../src/db/client.mjs');
    const sql = db();
    await sql`INSERT INTO history (entity_type, entity_id, kind, summary)
              VALUES ('import', 'docs/SCOPE.md', 'import', 'Imported'),
                     ('rule', 'RULE-01', 'created', 'Recorded'),
                     ('item', 'T-1', 'field', 'Changed')`;

    const links = new Set();
    for (const page of ['/', '/items', '/rules', '/decisions', '/releases', '/verification', '/history', '/items/T-1']) {
      const response = await fetch(`${base}${page}`, { headers: { cookie: jar.header() } });
      assert.equal(response.status, 200, `${page} did not render`);
      const body = await response.text();
      for (const match of body.matchAll(/href="([^"]+)"/g)) {
        const [target] = match[1].split('#');
        if (target.startsWith('/')) links.add(target || '/');
      }
    }
    assert.ok(links.size > 5, 'the pages should link somewhere');

    for (const link of links) {
      const response = await fetch(`${base}${link}`, { headers: { cookie: jar.header() }, redirect: 'manual' });
      assert.ok([200, 303].includes(response.status), `${link} answered ${response.status}`);
    }
  } finally {
    await stop();
  }
});

test('/commits goes to the page that shows them, rather than showing them twice', options, async () => {
  const { base, stop } = await start();
  const jar = cookieJar();
  try {
    const form = await fetch(`${base}/login`);
    jar.take(form);
    const csrf = csrfFrom(await form.text());
    jar.take(await fetch(`${base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
      body: new URLSearchParams({ csrf, email: 'tester@example.test', password: PASSWORD }),
      redirect: 'manual',
    }));
    const response = await fetch(`${base}/commits`, { headers: { cookie: jar.header() }, redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/releases');

    // And it is still behind the gate.
    const unauth = await fetch(`${base}/commits`, { redirect: 'manual' });
    assert.equal(unauth.status, 303);
    assert.equal(unauth.headers.get('location'), '/login');
  } finally {
    await stop();
  }
});
