# The project rules, and how the tracker holds them

Rules are **permanent constraints**, not tasks. They live in their own table,
they have no DONE state, and nothing in the tracker can close one. A rule
changes only when a documented decision supersedes it, and every wording it has
ever been given is kept.

## How good is each wording?

Every rule carries `wording_authority`, because "this is the rule" and "this is
somebody's summary of the rule" are different claims:

| | Meaning |
|---|---|
| `AUTHORITATIVE` | the project owner's own words, on record |
| `RENDERING` | in force, but the text on file is a restatement whose exact wording awaits confirmation |
| `MISSING` | no wording could be recovered from any source, and none was invented |

Every other wording ever recorded for a rule is kept in `rule_variants`, which
is append-only. A `HISTORICAL` variant is a wording the current one replaced; an
`ALTERNATE` is another version recorded at the same time that nobody has
resolved. Replacing a rule's text files the old text as a variant
automatically, so an import cannot lose one.

## Rules 25, 26 and 27 — authoritative

Stored character for character, typing and emphasis included.

Rule 27 was supplied twice: at Phase 3A and again at Phase 3B, and the two
differ by one word — *"accommodate"* against *"accomidate"*. Phase 3B states it
twice, consistently, so that is the recorded wording; Phase 3A's is kept as a
variant. **The spelling has not been corrected.** The tracker records what the
owner wrote. Rules 25 and 26 were re-stated at Phase 3B character for character
unchanged.

Rule 27 carries the development-authentication instruction itself, so the
separate `RULE-DEV-AUTH` entry is `SUPERSEDED` — kept, not deleted.

## Rules 1 to 10 — in force, wording unsettled

**Three** versions are on record, all written by the project owner, none
demonstrably the original:

- **A** — Phase 2 §7, *"The established rules include:"*. This is the recorded text.
- **B** — the BD-06 task preamble, *"IMPORTANT PROJECT RULES"*, whose rule 2 says *"in this task"*.
- **C** — Phase 3B §4, *"The known wording currently recorded includes the following principles"*, which differs from what is in fact recorded.

Phase 3B instructed that the recorded wording be preserved rather than replaced,
so A stays and B and C are kept as variants against each rule. The evidence that
A is itself a restatement: A also carried rules 25–27, and the owner's
authoritative wording for those three differs from A's version of them.
**TRK-BD-02** asks which is authoritative.

## Rules 11 to 24 — still missing, with candidates recorded

Searched twice. At Phase 3B the search additionally separated the owner's own
messages from machine-written conversation summaries, so that no summary could
be mistaken for the owner's words:

- this repository and its complete history;
- the EJE working tree, every blob in all 91 of its commits, every commit message;
- `docs/SCOPE.md` and every other EJE document ever committed;
- all 124 owner-written messages, including every pasted instruction and queued command.

**No wording numbered 11–24 exists in any of them.**

What the second search did recover, verbatim, is fifteen standing rules in the
owner's own words that carry no number:

- `PRIN-01` … `PRIN-14` — the fourteen **ARCHITECTURAL PRINCIPLES** of the
  project's founding instruction (*"Reliability over shortcuts."* … *"Do not
  build fake functionality that looks functional but is structurally impossible
  to replace later."*);
- `STAND-01` — the **MOST IMPORTANT RULE** of the CR-12 instruction (*"DO NOT
  BREAK ANYTHING THAT ALREADY WORKS."*).

All fifteen are recorded as first-class rules and are in force.

**There are exactly fourteen missing numbers and exactly fourteen architectural
principles.** That is an observation, not a proof: the principles are numbered
1–14 in their own source and nothing links them to the 11–24 range. Nothing has
been renumbered on the strength of it. **TRK-BD-01** puts the question to the
owner; one word settles it, and the mapping would then be applied with every
existing record kept and the change written into each rule's history.

## Standing directives

Mandatory sections of the owner's own instructions, verbatim, that are not part
of the numbered series — EJE protection, clean code, no regressions, database
consistency, testing, tablet-first, security, demo users, tracker isolation,
deployment evidence, quality gate, cleanup, git, no guessing, no fake certainty.
They are recorded under their own `DIR-` identifiers rather than being
renumbered into the 11–24 gap, because renumbering them would be an invention of
exactly the kind the rules forbid.
