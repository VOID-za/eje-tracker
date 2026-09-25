import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/passwords.mjs';
import { csrfTokenFor, csrfValid, readCookie, COOKIE } from '../src/auth/sessions.mjs';
import { esc, html, raw, toString } from '../src/http/html.mjs';

test('a password is stored as a salted scrypt hash and nothing else', async () => {
  const stored = await hashPassword('a-long-enough-password');
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[^$]+\$[^$]+$/);
  assert.equal(stored.includes('a-long-enough-password'), false, 'the password is not in the hash');
  assert.equal(await verifyPassword('a-long-enough-password', stored), true);
  assert.equal(await verifyPassword('a-long-enough-passwore', stored), false);
});

test('two identical passwords do not produce the same hash', async () => {
  const first = await hashPassword('the-same-password-twice');
  const second = await hashPassword('the-same-password-twice');
  assert.notEqual(first, second, 'each password gets its own salt');
});

test('a short password is refused rather than quietly accepted', async () => {
  await assert.rejects(() => hashPassword('short'), /at least 12 characters/);
});

test('a malformed hash fails the login instead of throwing', async () => {
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', null), false);
});

test('a CSRF token is bound to its session and to no other', () => {
  const mine = csrfTokenFor('session-token-one');
  const theirs = csrfTokenFor('session-token-two');
  assert.notEqual(mine, theirs);
  assert.equal(csrfValid('session-token-one', mine), true);
  assert.equal(csrfValid('session-token-one', theirs), false);
  assert.equal(csrfValid('session-token-one', ''), false);
  assert.equal(csrfValid('', ''), false, 'no session, no token, no pass');
});

test('cookies are read by name and not by position', () => {
  const header = `other=1; ${COOKIE}=the-token; another=2`;
  assert.equal(readCookie(header), 'the-token');
  assert.equal(readCookie('nothing=here'), null);
  assert.equal(readCookie(undefined), null);
});

test('everything interpolated into a page is escaped', () => {
  const nasty = '<script>alert("x")</script>';
  assert.equal(toString(html`<p>${nasty}</p>`), '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(esc("O'Brien & Sons"), 'O&#39;Brien &amp; Sons');
});

test('markup can only be injected deliberately', () => {
  assert.equal(toString(html`${raw('<b>bold</b>')}`), '<b>bold</b>');
  assert.equal(toString(html`${['a', '<b>']}`), 'a&lt;b&gt;');
  assert.equal(toString(html`${null}${undefined}${false}`), '');
});
