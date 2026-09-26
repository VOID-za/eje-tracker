# How the tracker is built, and why

## What it is for

The EJE project has a requirements document (`docs/SCOPE.md`, in the EJE
repository) that says what the system must do. What it did not have is a record
of **what is actually true right now**: what is finished as opposed to written,
what is running on the server as opposed to pushed to GitHub, what nobody has
decided yet, and which rules a piece of work was supposed to obey.

That is this. It is a project-control layer, not a second requirements
document. `docs/SCOPE.md` stays authoritative and the tracker never writes to it.

## The two axes

The single most important design decision in here is that **status and delivery
are separate columns**.

- `status` — how far the *work* has got: OPEN, PLANNED, IN_PROGRESS, BLOCKED,
  DECISION_REQUIRED, IMPLEMENTED, TESTING, APPROVED, DONE, DEFERRED, CANCELLED,
  SUPERSEDED.
- `delivery` — how far the *code* has got: NOT_STARTED, LOCAL, COMMITTED,
  PUSHED, DEPLOYED.

IMPLEMENTED is not DONE — DONE means finished, tested and accepted. The one
exception is an item of kind **Decision**, where the recorded answer IS the
deliverable: such an item may close straight from DECISION_REQUIRED, and for
every other kind that move is refused with a refusal that says why. PUSHED is
not DEPLOYED — the dashboard's headline percentage counts DONE only, and the
"not deployed" card counts work that is finished in the ledger but is not on the
server. Collapsing either pair would make the tracker agree with everybody and
be useful to nobody.

## Evidence, not assertions

- **Deployment** is only ever written by the importer, from the live
  application's own `/api/health` build stamp plus `git merge-base
  --is-ancestor`. The evidence string is stored on the release. There is no
  form in the tracker that lets anybody type "deployed".
- **Verification** rows carry the command that was run, what it reported, and
  the commit it ran at.
- **History** is append-only. Every field change writes a row; nothing updates
  or deletes one. A rule's every recorded wording is kept the same way, in
  `rule_variants`.
- **Missing wording is missing, and a summary is not a rule.** Rules 11–24 are
  recorded with empty text and `SOURCE_MISSING` because their wording could not
  be recovered and inventing it would be worse than the gap. Rules whose text is
  a restatement rather than the owner's own words carry `wording_authority =
  RENDERING`, so nobody mistakes a tidy summary for the constraint itself. See
  [`rules.md`](rules.md).

## The stack, and why it is this small

Node 22, `node:http`, server-rendered HTML, plain SQL migrations, `node:test`,
and exactly one runtime dependency (`postgres`). No framework, no bundler, no
client-side JavaScript at all.

A control system that is hard to build, hard to start or hard to read is a
control system nobody keeps up to date. This one starts with `node
bin/tracker.mjs`, and every page it serves is a file you can read top to bottom.
It also means the tracker's own dependency surface — the thing it would be
embarrassing to have a vulnerability in — is one library.

```
bin/            entry points: tracker, migrate, import:scope, import:git, user:add
data/rules.json the project's rules, verbatim
src/config.mjs  every environment variable, in one place, with no production default
src/db/         connection, migration runner, migrations/*.sql
src/domain/     the vocabulary: kinds, statuses, transitions, progress arithmetic
src/repo/       reading and writing the ledger (every write records history)
src/auth/       scrypt passwords, sessions, CSRF
src/http/       the server, the gate, the route table, HTML escaping
src/views/      the pages
src/import/     docs/SCOPE.md, the rules file, git and the live build stamp
test/           node:test — domain, security, import, database, HTTP
```

## Security

- Every route requires a session except `/login` and `/healthz`; the gate is in
  `src/http/server.mjs`, so a handler cannot forget it.
- Passwords: scrypt (N=32768), per-password salt, no plaintext anywhere. The
  first account is created by `npm run user:add`, which reads the password from
  the terminal with the echo off.
- Sessions: 32 random bytes; the database stores only the SHA-256, so a stolen
  database is not a set of usable logins. Cookies are HttpOnly, SameSite=Lax and
  Secure unless the operator has explicitly said the tracker is behind a
  plain-HTTP SSH tunnel.
- CSRF: every POST carries a token derived from the session (or, before sign-in,
  from a random per-visitor seed cookie). A bearer token is accepted for **GET
  only**, so the JSON API can be read from `curl` over the tunnel and can never
  be used to change anything.
- Headers: a content-security policy that forbids scripts entirely, plus
  `nosniff`, `DENY`, `no-referrer` and HSTS when not on plain HTTP.
- SQL is parameterised throughout; the one place a query string could reach an
  ORDER BY is a whitelist.
- `audit_log` records sign-ins, failed sign-ins, rejected CSRF, and every status
  change with who made it.

## The tracker and EJE

The tracker reads two things from the EJE checkout: `docs/SCOPE.md`, and `git
log` / `git merge-base`. It writes nothing there, connects to no EJE database,
and imports no EJE code. EJE does not know it exists.
