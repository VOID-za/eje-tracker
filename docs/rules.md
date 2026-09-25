# The project rules, and how the tracker holds them

Rules are **permanent constraints**, not tasks. They live in their own table,
they have no DONE state, and nothing in the tracker can close one. A rule
changes only when a documented decision supersedes it, and the wording it
replaced is kept — in its history and beside it on the page.

## How good is each wording?

Every rule carries `wording_authority`, because "this is the rule" and "this is
somebody's summary of the rule" are different claims:

| | Meaning | Count |
|---|---|---|
| `AUTHORITATIVE` | the project owner's own words, on record | rules 25–27, and the standing directives |
| `RENDERING` | in force, but the text on file is a restatement whose exact wording awaits confirmation | rules 1–10 |
| `MISSING` | no wording could be recovered from any source, and none was invented | rules 11–24 |

## Rules 25, 26 and 27

Supplied by the project owner at Phase 3A and stored character for character,
typing and emphasis included. They replaced a restatement the tracker had been
given at Phase 2, which is kept in each rule's history and shown beside it. The
difference between the two is what prompted everything else on this page:

> Phase 2 restatement: *"The complete system must ALWAYS remain tablet friendly."*
> Authoritative: *"The complete system should always but always stay Tablet friendly!!"*

Rule 27 carries the development-authentication instruction itself, so the
separate `RULE-DEV-AUTH` entry that used to hold it is now `SUPERSEDED` —
kept, not deleted, because it is how the project was bound before rule 27's own
wording was recovered.

## Rules 1 to 10

In force. Their recorded wording comes from the Phase 2 instruction, which
introduced them as *"The established rules include:"* — the same list whose
rules 25–27 turned out to be restatements. A second version of the same ten
rules exists in the BD-06 task preamble, with different wording and a
task-scoped rule 2. Neither is demonstrably the original, so the tracker records
the first, keeps the second beside it, and asks rather than chooses:
**TRK-BD-02**.

## Rules 11 to 24

Not recovered. Searched at Phase 3A:

- the eje-tracker repository and its complete history;
- the EJE repository working tree, every blob in all of its commits, and every
  commit message;
- `docs/SCOPE.md` and every other EJE document ever committed;
- the complete project conversation, including every pasted instruction and
  queued command.

No wording for any of these fourteen rules exists in any of them. They are
recorded with empty text, `SOURCE_MISSING`, `MISSING`, and a count on the
dashboard: **TRK-BD-01**. Nothing was invented to fill the gap, and nothing
should be — send the wording and `npm run import:scope` records it verbatim,
with the change kept in history.

## Standing directives

Mandatory sections of the owner's own instructions that are not part of the
numbered series — EJE protection, clean code, no regressions, database
consistency, testing, tablet-first, security, quality gate, cleanup, git, no
guessing, feature protection. They are verbatim, and they are recorded under
their own `DIR-` identifiers rather than being renumbered into the 11–24 gap,
because renumbering them would be an invention of exactly the kind the rules
forbid.
