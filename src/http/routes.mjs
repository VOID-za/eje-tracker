/**
 * Every route the tracker serves.
 *
 * Handlers read the ledger and render; the gate in server.mjs has already
 * established who is asking and that a mutating request carries a valid CSRF
 * token, so nothing below has to remember to check.
 */
import { db } from '../db/client.mjs';
import { layout, bareLayout } from '../views/layout.mjs';
import { dashboardPage } from '../views/dashboard.mjs';
import { itemsPage, itemPage } from '../views/items.mjs';
import { rulesPage } from '../views/rules.mjs';
import {
  decisionsPage, releasesPage, verificationPage, historyPage, loginPage, errorPage,
} from '../views/project.mjs';
import { summarise } from '../domain/progress.mjs';
import {
  countsByDelivery, countsByKind, countsByStatus, filesFor, getItem, historyFor,
  listItems, relationsFor, setStatus,
} from '../repo/items.mjs';
import {
  allRuleVariants, commitsFor, getDecision, latestDeployedRelease, listCommits,
  listDecisions, listReleases, listRules, listVerifications, verificationsFor,
} from '../repo/project.mjs';
import {
  authenticate, createSession, destroySession, sessionCookie, clearedCookie,
} from '../auth/sessions.mjs';
import { audit, json, page, redirect, text } from './server.mjs';

const shell = (user, path, csrf, title, body) => page(layout({ title, user, path, body, csrf }));

/* --------------------------------------------------------------- filters -- */

/** Whitelisted, so a query string cannot reach anything but these. */
const FILTER_KEYS = ['q', 'kind', 'status', 'delivery', 'priority', 'group', 'phase', 'sort', 'parent'];

const filterFrom = (query) => {
  const filter = {};
  for (const key of FILTER_KEYS) {
    const value = String(query[key] ?? '').trim();
    if (value.length > 0) filter[key] = value.slice(0, 120);
  }
  if (query.blocker === '1') filter.blocker = true;
  if (query.stuck === '1') filter.stuck = true;
  if (query.undeployed === '1') filter.undeployed = true;
  if (query.overdue === '1') filter.overdue = true;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) params.set(key, value === true ? '1' : value);
  filter.queryString = params.toString();
  return filter;
};

/* ------------------------------------------------------------- dashboard -- */

const dashboard = async ({ user, csrf }) => {
  const sql = db();
  const [statusCounts, deliveryCounts, byKind, byGroup, stuck, blockers, undeployed, recentHistory, ruleGaps, lastImport] =
    await Promise.all([
      countsByStatus(sql),
      countsByDelivery(sql),
      countsByKind(sql),
      sql`SELECT group_path,
                 count(*)::int AS n,
                 count(*) FILTER (WHERE status = 'DONE')::int AS done,
                 count(*) FILTER (WHERE status IN ('IMPLEMENTED','TESTING','APPROVED'))::int AS built,
                 count(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS working,
                 count(*) FILTER (WHERE status IN ('BLOCKED','DECISION_REQUIRED'))::int AS stuck
            FROM items GROUP BY group_path ORDER BY group_path`,
      listItems({ stuck: true, sort: 'updated' }, sql),
      listItems({ blocker: true }, sql).then((rows) =>
        rows.filter((row) => !['DONE', 'CANCELLED', 'SUPERSEDED'].includes(row.status))),
      sql`SELECT * FROM items
           WHERE status IN ('DONE','APPROVED','TESTING','IMPLEMENTED')
             AND delivery IN ('COMMITTED','PUSHED','LOCAL')
           ORDER BY id`,
      sql`SELECT * FROM history ORDER BY at DESC, id DESC LIMIT 25`,
      sql`SELECT count(*)::int AS n FROM rules WHERE status = 'SOURCE_MISSING'`,
      sql`SELECT * FROM history WHERE kind = 'import' ORDER BY at DESC, id DESC LIMIT 1`,
    ]);

  const [headCommit] = await sql`SELECT * FROM commits ORDER BY committed_at DESC NULLS LAST LIMIT 1`;

  return shell(user, '/', csrf, 'Dashboard', dashboardPage({
    summary: summarise(statusCounts, deliveryCounts),
    byKind,
    byGroup,
    stuck,
    blockers,
    undeployed,
    deployedRelease: await latestDeployedRelease(sql),
    headCommit: headCommit ?? null,
    recentHistory,
    missingRules: ruleGaps[0]?.n ?? 0,
    lastImport: lastImport[0] ?? null,
  }));
};

/* ----------------------------------------------------------------- items -- */

const items = async ({ user, csrf, query }) => {
  const sql = db();
  const filter = filterFrom(query);
  const [rows, groups] = await Promise.all([
    listItems(filter, sql),
    sql`SELECT DISTINCT group_path FROM items WHERE group_path <> '' ORDER BY group_path`,
  ]);
  return shell(user, '/items', csrf, 'Items', itemsPage({
    items: rows, filter, groups: groups.map((row) => row.group_path),
  }));
};

const itemDetail = async ({ user, csrf, params }) => {
  const sql = db();
  const item = await getItem(params.id, sql);
  if (item === null) {
    return page(layout({ title: 'Not found', user, path: '/items', csrf,
      body: errorPage({ code: 404, message: `There is no item called ${params.id}.` }) }), { status: 404 });
  }
  const [relations, commits, files, verifications, history, decision, children] = await Promise.all([
    relationsFor(item.id, sql),
    commitsFor(item.id, sql),
    filesFor(item.id, sql),
    verificationsFor(item.id, sql),
    historyFor('item', item.id, sql),
    getDecision(item.id, sql),
    listItems({ parent: item.id }, sql),
  ]);
  return shell(user, '/items', csrf, item.id, itemPage({
    item, relations, commits, files, verifications, history, decision, children, csrf,
    canEdit: user.role === 'admin',
  }));
};

const itemStatus = async ({ user, params, form, ip }) => {
  try {
    await setStatus(params.id, String(form.status ?? ''), {
      actor: user.email, note: String(form.note ?? '').slice(0, 500),
      evidence: 'Recorded in the tracker UI',
    });
    await audit({ actor: user.email, action: 'item.status', target: params.id, detail: String(form.status), ip });
  } catch (error) {
    await audit({ actor: user.email, action: 'item.status.refused', target: params.id, detail: error.message, ip });
    return page(layout({ title: 'Refused', user, path: '/items', csrf: '',
      body: errorPage({ code: 409, message: error.message }) }), { status: 409 });
  }
  return redirect(`/items/${encodeURIComponent(params.id)}`);
};

/* --------------------------------------------------- rules and decisions -- */

const rules = async ({ user, csrf }) => {
  const sql = db();
  const all = await listRules(sql);
  const variants = await allRuleVariants(sql);
  const history = await sql`SELECT * FROM history WHERE entity_type = 'rule' ORDER BY at`;
  const links = await sql`SELECT from_id, to_id FROM relations
                           WHERE from_type = 'rule' OR to_type = 'rule'`;
  const historyByRule = {};
  for (const entry of history) (historyByRule[entry.entity_id] ??= []).push(entry);
  const variantsByRule = {};
  for (const variant of variants) (variantsByRule[variant.rule_id] ??= []).push(variant);
  const related = {};
  for (const link of links) {
    const ruleId = String(link.from_id).startsWith('RULE') || String(link.from_id).startsWith('DIR')
      ? link.from_id : link.to_id;
    const other = ruleId === link.from_id ? link.to_id : link.from_id;
    (related[ruleId] ??= []).push(other);
  }
  return shell(user, '/rules', csrf, 'Rules', rulesPage({ rules: all, historyByRule, variantsByRule, related }));
};

const decisions = async ({ user, csrf }) =>
  shell(user, '/decisions', csrf, 'Decisions', decisionsPage({ decisions: await listDecisions() }));

const releases = async ({ user, csrf }) => {
  const sql = db();
  const [all, commits, deployed] = await Promise.all([
    listReleases(sql), listCommits(50, sql), latestDeployedRelease(sql),
  ]);
  return shell(user, '/releases', csrf, 'Releases', releasesPage({ releases: all, commits, deployed }));
};

const verification = async ({ user, csrf }) =>
  shell(user, '/verification', csrf, 'Verification', verificationPage({ runs: await listVerifications(200) }));

const activity = async ({ user, csrf }) => {
  const entries = await db()`SELECT * FROM history ORDER BY at DESC, id DESC LIMIT 400`;
  return shell(user, '/history', csrf, 'Activity', historyPage({ entries }));
};

/* ------------------------------------------------------------------- API -- */

const apiSummary = async () => {
  const sql = db();
  const [statusCounts, deliveryCounts, deployed, ruleGaps] = await Promise.all([
    countsByStatus(sql), countsByDelivery(sql), latestDeployedRelease(sql),
    sql`SELECT count(*)::int AS n FROM rules WHERE status = 'SOURCE_MISSING'`,
  ]);
  return json({
    summary: summarise(statusCounts, deliveryCounts),
    byStatus: Object.fromEntries(statusCounts.map((row) => [row.status, row.n])),
    byDelivery: Object.fromEntries(deliveryCounts.map((row) => [row.delivery, row.n])),
    deployed: deployed === null ? null : {
      commit: deployed.commit_hash, subject: deployed.subject,
      observedAt: deployed.observed_at, evidence: deployed.evidence,
    },
    rulesAwaitingSource: ruleGaps[0]?.n ?? 0,
    generatedAt: new Date().toISOString(),
  });
};

const apiItems = async ({ query }) => json({ items: await listItems(filterFrom(query)) });

const apiItem = async ({ params }) => {
  const sql = db();
  const item = await getItem(params.id, sql);
  if (item === null) return json({ error: `There is no item called ${params.id}.` }, { status: 404 });
  const [relations, commits, files, verifications, history, decision] = await Promise.all([
    relationsFor(item.id, sql), commitsFor(item.id, sql), filesFor(item.id, sql),
    verificationsFor(item.id, sql), historyFor('item', item.id, sql), getDecision(item.id, sql),
  ]);
  return json({ item, relations, commits, files, verifications, history, decision });
};

const apiRules = async () => {
  const sql = db();
  const [rules, variants] = await Promise.all([listRules(sql), allRuleVariants(sql)]);
  const byRule = {};
  for (const variant of variants) (byRule[variant.rule_id] ??= []).push(variant);
  return json({ rules: rules.map((rule) => ({ ...rule, variants: byRule[rule.id] ?? [] })) });
};
const apiDecisions = async () => json({ decisions: await listDecisions() });
const apiReleases = async () => json({ releases: await listReleases(), commits: await listCommits(100) });
const apiVerification = async () => json({ runs: await listVerifications(200) });

/* ---------------------------------------------------------------- access -- */

const loginForm = ({ query, csrf }) =>
  page(bareLayout({ title: 'Sign in', body: loginPage({
    error: query.error === '1' ? 'That email and password combination was not accepted.' : '',
    csrf,
  }) }));

const login = async ({ form, req, ip }) => {
  const user = await authenticate(form.email, form.password);
  if (user === null) {
    await audit({ actor: String(form.email ?? '').slice(0, 120), action: 'login.failed', ip });
    return redirect('/login?error=1');
  }
  const { token, expires } = await createSession(user.id, { userAgent: String(req.headers['user-agent'] ?? '') });
  await audit({ actor: user.email, action: 'login', ip });
  return redirect('/', { headers: { 'set-cookie': sessionCookie(token, expires) } });
};

const logout = async ({ token, user, ip }) => {
  await destroySession(token);
  await audit({ actor: user?.email ?? 'anonymous', action: 'logout', ip });
  return redirect('/login', { headers: { 'set-cookie': clearedCookie() } });
};

const healthz = async () => {
  try {
    const [row] = await db()`SELECT count(*)::int AS n FROM items`;
    return json({ status: 'ok', items: row.n });
  } catch (error) {
    return json({ status: 'degraded', detail: error.message }, { status: 503 });
  }
};

/* ---------------------------------------------------------------- routes -- */

export const routes = [
  { method: 'GET', path: '/', handler: dashboard },
  { method: 'GET', path: '/items', handler: items },
  { method: 'GET', path: '/items/:id', handler: itemDetail },
  { method: 'POST', path: '/items/:id/status', handler: itemStatus },
  { method: 'GET', path: '/rules', handler: rules },
  { method: 'GET', path: '/decisions', handler: decisions },
  { method: 'GET', path: '/releases', handler: releases },
  { method: 'GET', path: '/verification', handler: verification },
  { method: 'GET', path: '/history', handler: activity },

  { method: 'GET', path: '/api/summary', handler: apiSummary },
  { method: 'GET', path: '/api/items', handler: apiItems },
  { method: 'GET', path: '/api/items/:id', handler: apiItem },
  { method: 'GET', path: '/api/rules', handler: apiRules },
  { method: 'GET', path: '/api/decisions', handler: apiDecisions },
  { method: 'GET', path: '/api/releases', handler: apiReleases },
  { method: 'GET', path: '/api/verification', handler: apiVerification },

  { method: 'GET', path: '/login', handler: loginForm },
  { method: 'POST', path: '/login', handler: login },
  { method: 'POST', path: '/logout', handler: logout },
  { method: 'GET', path: '/healthz', handler: healthz },
];

export const handlers = {
  onNotFound: ({ pathname, user }) =>
    pathname.startsWith('/api/')
      ? json({ error: 'No such endpoint.' }, { status: 404 })
      : page(layout({ title: 'Not found', user, path: pathname, body:
          errorPage({ code: 404, message: 'There is nothing at that address.' }) }), { status: 404 }),
  onUnauthenticated: ({ pathname }) =>
    pathname.startsWith('/api/')
      ? json({ error: 'Authentication required.' }, { status: 401 })
      : redirect('/login'),
  onForbidden: ({ reason }) => text(reason, { status: 403 }),
  onError: ({ error, status }) =>
    status === 413
      ? text('That request was too large.', { status })
      : text('The tracker could not complete that request. The failure has been logged.', { status }),
};
