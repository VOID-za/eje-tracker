/**
 * The deployment-evidence seam.
 *
 * These tests exist because of the one rule this importer must never break:
 * when the live application cannot be reached, the tracker records NOTHING
 * about deployment rather than something plausible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCommitFiles, readCommits, readHealth } from '../src/import/git.mjs';

const repo = () => {
  const path = mkdtempSync(join(tmpdir(), 'tracker-git-'));
  const git = (...args) => execFileSync('git', ['-C', path, ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.test');
  git('config', 'user.name', 'Test');
  writeFileSync(join(path, 'keep.txt'), 'one\n');
  writeFileSync(join(path, 'goes.txt'), 'two\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first commit');
  writeFileSync(join(path, 'keep.txt'), 'one, changed\n');
  writeFileSync(join(path, 'new.txt'), 'three\n');
  execFileSync('git', ['-C', path, 'rm', '-q', 'goes.txt']);
  git('add', '.');
  git('commit', '-q', '-m', 'second commit', '-m', 'with a body');
  return path;
};

test('commits are read with their subject, body and author', async () => {
  const commits = await readCommits(repo());
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, 'second commit');
  assert.equal(commits[0].body, 'with a body');
  assert.equal(commits[0].author, 'Test');
  assert.ok(commits[0].committed_at instanceof Date);
});

test('a commit says what it added, changed and removed', async () => {
  const path = repo();
  const [head] = await readCommits(path);
  const files = await readCommitFiles(path, head.hash);
  assert.deepEqual(
    files.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { action: 'REMOVED', path: 'goes.txt' },
      { action: 'MODIFIED', path: 'keep.txt' },
      { action: 'ADDED', path: 'new.txt' },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
});

test('a live build stamp is evidence, and carries where it came from', async () => {
  const health = await readHealth('https://example.invalid/api/health', {
    fetchImpl: async () => new Response(JSON.stringify({ build: { commit: '2166ac6' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(health.ok, true);
  assert.equal(health.commit, '2166ac6');
  assert.match(health.evidence, /build\.commit=2166ac6/);
});

test('an unreachable application produces no deployment claim at all', async () => {
  const unreachable = await readHealth('https://example.invalid/api/health', {
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.commit, undefined);
  assert.match(unreachable.reason, /could not be reached/);
});

test('an answer without a build stamp is not treated as one', async () => {
  const empty = await readHealth('https://example.invalid/api/health', {
    fetchImpl: async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /carried no build commit/);

  const failed = await readHealth('https://example.invalid/api/health', {
    fetchImpl: async () => new Response('nope', { status: 502 }),
  });
  assert.equal(failed.ok, false);
  assert.match(failed.reason, /answered 502/);
});
