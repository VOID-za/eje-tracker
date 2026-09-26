/**
 * Where the code actually is.
 *
 * READ-ONLY AGAINST THE EJE CHECKOUT — `git log`, `git rev-list`,
 * `git merge-base`. It never checks anything out, never fetches, never writes,
 * and never runs a command that could change a working tree it does not own.
 *
 * DEPLOYED IS EVIDENCE, NOT A CLAIM. The deployed commit comes from the live
 * application's own `/api/health` build stamp, or from an observation the
 * operator passes in explicitly and which is stored alongside the release so a
 * reader can see where the claim came from. There is no form anywhere in this
 * tracker that lets somebody type "deployed".
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.mjs';
import { db } from '../db/client.mjs';
import { recordFile, recordHistory } from '../repo/items.mjs';
import { saveCommit, saveRelease } from '../repo/project.mjs';

const run = promisify(execFile);

const git = async (repo, args) => {
  const { stdout } = await run('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

const SEPARATOR = '\u001e';

export const readCommits = async (repo, limit = 400) => {
  const format = ['%H', '%an', '%aI', '%s', '%b'].join(SEPARATOR);
  const stdout = await git(repo, ['log', `-${limit}`, `--pretty=format:${format}%x00`]);
  return stdout
    .split('\u0000')
    .map((entry) => entry.replace(/^\n/, ''))
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => {
      const [hash, author, date, subject, body = ''] = entry.split(SEPARATOR);
      return { hash, author, committed_at: new Date(date), subject, body: body.trim() };
    });
};

/** The live build stamp, if the application answers. Never invented. */
export const readHealth = async (url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) return { ok: false, reason: `${url} answered ${response.status}` };
    const payload = await response.json();
    const commit = payload?.build?.commit ?? payload?.commit ?? null;
    if (typeof commit !== 'string' || commit.length < 7) {
      return { ok: false, reason: `${url} carried no build commit` };
    }
    return { ok: true, commit, payload, observedAt: new Date(), evidence: `GET ${url} → build.commit=${commit}` };
  } catch (error) {
    return { ok: false, reason: `${url} could not be reached: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * What a commit added, changed and removed.
 *
 * This is what makes the clean-code rule checkable rather than aspirational: a
 * change that added an implementation and never removed the one it replaced is
 * visible on the item's own page, in the ADDED column with nothing beside it.
 */
export const readCommitFiles = async (repo, hash) => {
  const stdout = await git(repo, ['show', '--name-status', '--pretty=format:', '--no-renames', hash]);
  const actions = { A: 'ADDED', M: 'MODIFIED', D: 'REMOVED' };
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [code, path] = line.split('\t');
      return { action: actions[code?.[0]] ?? null, path };
    })
    .filter((entry) => entry.action !== null && typeof entry.path === 'string');
};

const isAncestor = async (repo, candidate, descendant) => {
  try {
    await git(repo, ['merge-base', '--is-ancestor', candidate, descendant]);
    return true;
  } catch {
    return false;
  }
};

/**
 * Brings the ledger up to date with the repository and the live build.
 *
 * `deployed` may be supplied by the caller — an observation recorded by a human
 * who read the health endpoint — in which case its evidence string says so.
 */
export const importGit = async ({
  repo = config.ejeRepoPath,
  healthUrl = config.ejeHealthUrl,
  deployedCommit = null,
  deployedEvidence = '',
  observedAt = null,
  limit = 400,
  actor = 'import:git',
  log = console.log,
  sql = db(),
  fetchImpl = fetch,
} = {}) => {
  const commits = await readCommits(repo, limit);
  for (const commit of commits) {
    await saveCommit({ ...commit, repo: 'VOID-za/EJE-Managment' }, sql);
  }

  // Which commits the remote already has. A commit only this container knows
  // about is COMMITTED, not PUSHED.
  let pushed = new Set();
  try {
    const stdout = await git(repo, ['rev-list', '--remotes', `-${limit * 4}`]);
    pushed = new Set(stdout.split('\n').filter((line) => line.length > 0));
  } catch (error) {
    log(`import   could not read remote refs (${error.message}); nothing will be recorded as PUSHED`);
  }

  // Deployment evidence.
  let deployed = null;
  const health = await readHealth(healthUrl, { fetchImpl });
  if (health.ok) {
    deployed = { commit: health.commit, evidence: health.evidence, observedAt: health.observedAt };
  } else if (deployedCommit !== null) {
    deployed = {
      commit: deployedCommit,
      evidence: deployedEvidence || 'Observation supplied to the importer by the operator.',
      observedAt: observedAt ?? new Date(),
    };
    log(`import   live health unavailable (${health.reason}); using the supplied observation`);
  } else {
    log(`import   live health unavailable (${health.reason}); no deployment state will be written`);
  }

  // Resolve the deployed commit to a full hash the repository knows.
  let deployedFull = null;
  if (deployed !== null) {
    try {
      deployedFull = (await git(repo, ['rev-parse', deployed.commit])).trim();
    } catch {
      log(`import   the repository does not contain ${deployed.commit}; no deployment state will be written`);
      deployed = null;
    }
  }

  const head = commits[0] ?? null;
  const releases = [];
  if (deployed !== null && deployedFull !== null) {
    const id = `live-${deployedFull.slice(0, 10)}`;
    await saveRelease({
      id,
      commit_hash: deployedFull,
      server: healthUrl,
      status: 'DEPLOYED',
      deployed_at: deployed.observedAt,
      health_result: 'reachable',
      evidence: deployed.evidence,
      observed_at: deployed.observedAt,
      notes: 'Recorded from the live build stamp, not from anybody\'s assertion.',
    }, sql);
    releases.push(id);
  }
  if (head !== null && head.hash !== deployedFull) {
    const id = `head-${head.hash.slice(0, 10)}`;
    await saveRelease({
      id,
      commit_hash: head.hash,
      server: '',
      status: pushed.has(head.hash) ? 'PUSHED' : 'COMMITTED',
      evidence: pushed.has(head.hash)
        ? 'Present on a remote ref in the EJE checkout.'
        : 'Present only in the local checkout.',
      observed_at: new Date(),
      notes: 'The repository head. Pushed is not deployed.',
    }, sql);
    releases.push(id);
  }

  /* Delivery state, per item, from the commits the scope names against it. */
  const links = await sql`SELECT from_id AS item_id, to_id AS hash FROM relations
                           WHERE from_type = 'item' AND to_type = 'commit'`;
  const known = new Map(commits.map((commit) => [commit.hash, commit]));
  const resolve = (hash) => {
    if (known.has(hash)) return hash;
    for (const full of known.keys()) if (full.startsWith(hash)) return full;
    return null;
  };

  // ITEMS THAT CARRY OTHER ITEMS ARE ROLLED UP, NOT COMPUTED TWICE.
  //
  // A change request usually names an implementing commit in its own dateline AND
  // has requirement rows filed under it. Letting both rules write its delivery
  // made the import fight itself — the commit pass said DEPLOYED, the roll-up
  // said NOT_STARTED, and every run rewrote all four of them and filed two more
  // history rows. The roll-up wins, because a batch is only as delivered as its
  // weakest part, so the commit pass leaves parents alone.
  const parents = new Set(
    (await sql`SELECT DISTINCT to_id FROM relations WHERE kind = 'implements'`).map((row) => row.to_id),
  );

  const byItem = new Map();
  for (const link of links) {
    if (parents.has(link.item_id)) continue;
    const full = resolve(link.hash);
    if (full === null) continue;
    if (!byItem.has(link.item_id)) byItem.set(link.item_id, []);
    byItem.get(link.item_id).push(full);
  }

  let changed = 0;
  let fileRows = 0;
  for (const [itemId, hashes] of byItem) {
    // The file record, so that "did this change clean up after itself?" is a
    // question the tracker can answer.
    for (const hash of hashes) {
      for (const file of await readCommitFiles(repo, hash)) {
        await recordFile(itemId, file.path, file.action, { note: hash.slice(0, 10) }, sql);
        fileRows += 1;
      }
    }

    let delivery = 'COMMITTED';
    if (hashes.some((hash) => pushed.has(hash))) delivery = 'PUSHED';
    if (deployedFull !== null) {
      const allDeployed = [];
      for (const hash of hashes) allDeployed.push(await isAncestor(repo, hash, deployedFull));
      if (allDeployed.length > 0 && allDeployed.every(Boolean)) delivery = 'DEPLOYED';
    }
    const [row] = await sql`SELECT delivery FROM items WHERE id = ${itemId}`;
    if (row === undefined || row.delivery === delivery) continue;
    await sql`UPDATE items SET delivery = ${delivery},
                deployed_at = ${delivery === 'DEPLOYED' ? (deployed?.observedAt ?? new Date()) : null},
                updated_at = now()
               WHERE id = ${itemId}`;
    await recordHistory(
      { entityType: 'item', entityId: itemId, actor, kind: 'delivery',
        summary: `delivery: ${row.delivery} → ${delivery}`,
        detail: hashes.map((hash) => hash.slice(0, 10)).join(', '),
        evidence: deployed?.evidence ?? 'git ancestry' },
      sql,
    );
    changed += 1;
  }

  /* A change request is only as delivered as the least-delivered thing it
     carries — INCLUDING the parts of it nobody has built yet. It has no commits
     of its own, so without this roll-up a finished batch would sit at
     NOT_STARTED while every requirement under it was live; and counting only
     the parts that exist would let a half-built batch read as deployed. */
  const ORDER = ['NOT_STARTED', 'LOCAL', 'COMMITTED', 'PUSHED', 'DEPLOYED'];
  const rolledUp = await sql`
    SELECT r.to_id AS parent, min(array_position(${ORDER}::text[], i.delivery)) AS weakest
      FROM relations r JOIN items i ON i.id = r.from_id
     -- A row the scope marks DONE against work that predates the change
     -- request carries no commit of its own, so it says nothing about delivery
     -- and is left out. A row that is NOT finished says a great deal: it is
     -- counted at NOT_STARTED, which is what stops a half-built batch reading
     -- as deployed.
     WHERE r.kind = 'implements'
       AND (i.delivery <> 'NOT_STARTED' OR i.status NOT IN ('DONE', 'SUPERSEDED'))
     GROUP BY r.to_id`;
  for (const row of rolledUp) {
    const delivery = ORDER[row.weakest - 1];
    const [item] = await sql`SELECT delivery FROM items WHERE id = ${row.parent}`;
    if (item === undefined || item.delivery === delivery) continue;
    await sql`UPDATE items SET delivery = ${delivery}, updated_at = now() WHERE id = ${row.parent}`;
    await recordHistory(
      { entityType: 'item', entityId: row.parent, actor, kind: 'delivery',
        summary: `delivery: ${item.delivery} → ${delivery}`,
        detail: 'Rolled up from the requirements this change request carries.',
        evidence: deployed?.evidence ?? 'git ancestry' },
      sql,
    );
    changed += 1;
  }

  const summary =
    `Imported ${commits.length} commits; ${releases.length} release records; ` +
    `${changed} items changed delivery state; ${fileRows} file records` +
    (deployedFull === null ? '; no deployment evidence available' : `; live build ${deployedFull.slice(0, 10)}`);
  await recordHistory(
    { entityType: 'import', entityId: 'git', actor, kind: 'import', summary,
      detail: repo, evidence: deployed?.evidence ?? '' },
    sql,
  );
  log(`import   ${summary}`);
  return { commits: commits.length, releases: releases.length, changed, deployed: deployedFull };
};
