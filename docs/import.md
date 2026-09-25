# What the importers do, exactly

Both importers are **read-only against the EJE repository**, repeatable and
idempotent. Running them twice imports the same document twice and changes
nothing the second time — `saveItem` compares field by field and writes history
only for what actually changed.

```bash
npm run import:scope    # docs/SCOPE.md + data/rules.json + data/tracker-items.json
npm run import:git      # commits, releases, deployment evidence, delivery state
```

Three sources, each with its own file:

| Source | What it carries |
|---|---|
| `EJE_REPO_PATH/docs/SCOPE.md` | the product's requirements, decisions, findings, criteria and verification record |
| `data/rules.json` | the project's development rules, verbatim, including the fourteen whose wording is missing |
| `data/tracker-items.json` | the tracker's own work — rule 26 applies to the tracker too |

## Identity

An item's ID **is the scope's own ID** — `CR-12`, `BD-06`, `PARTS-17`,
`MANDATE-1`. That is what makes a repeat import update the same row instead of
creating a second one, and it means a requirement is called the same thing in
the tracker, in the document and in the commit messages.

## How a row becomes an item

| In `docs/SCOPE.md` | In the tracker |
|---|---|
| The `ID` column | `items.id` |
| The `Requirement` / `Rule` / `Mandate` / `Finding` / `Question` column | `title` (first sentence) and `description` (the whole cell) |
| The `Status` column, verbatim | `source_status` — always kept, so you can see what the document said |
| The `Status` column, mapped | `status` (see below) |
| The `Commit` column | a relation to that commit; delivery then comes from git |
| `Evidence` / `Where` / `Detail` / `Satisfies` / `Blocks` | `evidence` |
| `Severity`, or ACCEPTANCE BLOCKER anywhere in the row | `severity`, `acceptance_blocker`, `priority` |
| The `##` / `###` headings above the row | `group_path` |
| The line number | `source_line` |

Status mapping: `DONE`→DONE, `SUPERSEDED`→SUPERSEDED, `DEFINED`→PLANNED,
`NOT IMPLEMENTED`→OPEN, `PARTIAL`/`UNVERIFIED`/`FAIL`→IN_PROGRESS,
`BLOCKED`→BLOCKED. A question in *Open business decisions* becomes
DECISION_REQUIRED unless the document shows it answered (struck through, or
marked ANSWERED/RESOLVED), in which case DONE with the answer recorded.

### The three derivations, named

Everything above is a transcription. Three things are *derived*, and each one
writes down that it was:

1. **A table with no `Status` column.** The verification record and the
   maintenance rules have none. Those two are records of something already
   carried out, so their rows are recorded DONE; anything else without a status
   stays OPEN. The item's `notes` says which rule was applied.
2. **A change request's status** is rolled up from the requirement rows filed
   under it — DONE when every one of them is DONE or SUPERSEDED, PLANNED when
   none is, IN_PROGRESS in between — and `notes` names the rows that are not
   finished. Where nothing at all is filed under a change request, the
   requirements its own prose names are used instead (CR-13 is written up under
   a heading belonging to CR-12).
3. **A change request's delivery** is the weakest delivery among those same
   rows, counting a row that is not finished as NOT_STARTED. A batch is only as
   deployed as its least-delivered part.

Nothing else is inferred. In particular no status, severity or decision is ever
invented where the document is silent.

## Nothing is deleted

If an item disappears from `docs/SCOPE.md`, its row stays and is marked
`source_missing`, with a history entry saying so. The project's record of what
it once required is part of the record.

## Where delivery comes from

`npm run import:git` reads `git log` and `git rev-list --remotes` from the EJE
checkout, then asks the live application what it is running:

```
GET https://eje.syncza.co.za/api/health → build.commit
```

An item's delivery is then: DEPLOYED if every commit the scope names against it
is an ancestor of the live build; PUSHED if any is on a remote ref; COMMITTED if
it is only in the local checkout; NOT_STARTED if the scope names no commit.

If the health endpoint cannot be reached, **no deployment state is written at
all** — the tracker does not guess. Where a person has read the build stamp
themselves, they can pass what they read, and it is stored as the evidence:

```bash
node bin/import-git.mjs --deployed 2166ac6 --evidence "live /api/health, 25 Sep 2026"
```

## Recorded gates

Where the scope states a result — ``npm test`` **1566 passed** — that becomes a
verification run attached to the row that states it, with the commit it was run
at. A gate the document mentions without a result is not given one.
