# EJE Project Tracker

The project-control system for the **EJE Job Card Management** project
(`VOID-za/EJE-Managment`). It is a shared source of truth for every requirement,
rule, decision, task, implementation, verification and outstanding item — so
that a person or a model picking the project up can see what is actually true
rather than what was last claimed.

It is a **completely separate application**. Separate repository, directory,
database, database user, environment file, service, port, logs and
authentication. It reads `docs/SCOPE.md` and `git log` from the EJE checkout and
writes nothing there. **The EJE application has no runtime dependency on this
and is unaffected if it is stopped, upgraded or removed entirely.**

## What it insists on

- **IMPLEMENTED is not DONE.** Done means finished, tested and accepted. The
  dashboard's headline percentage counts DONE only.
- **PUSHED is not DEPLOYED.** Deployment is read from the live application's own
  `/api/health` build stamp and git ancestry, and the evidence is stored with
  it. Nobody can type "deployed" into this system.
- **Nothing is invented, and nothing is renumbered on a hunch.** Rules 11–24
  could not be recovered from any source — and the fourteen searches that
  establish that are themselves recorded, so the gap is an auditable finding
  rather than an absence. Thirty-two standing rules *were* recovered verbatim,
  from the owner's instructions and from the authoritative scope document, and
  are in force — but they carry no number anyone can prove, so they are recorded
  as what they are rather than dropped into the gap. Rules whose text is a restatement say so instead of passing as
  authoritative, and every wording a rule has ever been given is kept.
- **Nothing is deleted.** History is append-only; an item that leaves
  `docs/SCOPE.md` is kept and marked, not removed.

## Running it

```bash
npm ci
export TRACKER_DATABASE_URL=postgres://eje_tracker_app:…@127.0.0.1:5432/eje_tracker
npm run migrate
node bin/user-add.mjs you@example.com "Your name"   # asks for a password, echo off
npm run import:scope                                 # reads EJE_REPO_PATH/docs/SCOPE.md
npm run import:git                                   # commits + deployment evidence
npm start                                            # http://127.0.0.1:3100
```

Requires Node 22 and PostgreSQL. One runtime dependency: `postgres`.

## Tests

```bash
TRACKER_TEST_DATABASE_URL=postgres://…/eje_tracker_test npm test
```

The database and HTTP tests skip themselves if that variable is unset, so the
pure tests run anywhere. They share one database, so the suite runs serially.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how it is built and why.
- [`docs/rules.md`](docs/rules.md) — how the rules are held, what is
  authoritative, and what is missing.
- [`docs/import.md`](docs/import.md) — exactly what the importers do, including
  the three things they derive rather than transcribe.
- [`docs/deployment.md`](docs/deployment.md) — the VPS runbook. Nothing in it
  has been run.

## Pages

| Page | What it answers |
|---|---|
| `/` | What is actually true: done, built-but-not-accepted, blocked, not deployed, what is running in production |
| `/items` | Everything, filterable and searchable |
| `/items/:id` | One item: where it came from, what it relates to, its commits, its files, its verification, its whole history |
| `/rules` | Every project rule, verbatim, with how authoritative its wording is, when it was last verified, and the ones whose wording is missing |
| `/decisions` | What nobody has decided yet, with the question and the options kept |
| `/releases` | Commits, releases, and where the code actually is |
| `/verification` | What was run and what it said |
| `/history` | Every change the tracker has recorded |

A JSON API mirrors all of it under `/api/…` for ChatGPT, Claude or any other
tool: `/api/summary`, `/api/items`, `/api/items/:id`, `/api/rules`,
`/api/decisions`, `/api/releases`, `/api/verification`. It is read-only and
requires the same session, or a session token presented as a bearer header.
