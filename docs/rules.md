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

Each rule also records **what kind of source** it came from — `OWNER_MESSAGE`,
`SCOPE_DOCUMENT`, `OWNER_RESTATEMENT`, `NONE` — and its date where one is known.
The distinction matters: the owner writing a rule, the authoritative scope
document stating it, and the owner restating rules that already existed are three
different claims.

Every other wording ever recorded for a rule is kept in `rule_variants`, which
is append-only. A variant carries what kind of wording it is: `HISTORICAL` (one the current
wording replaced), `ALTERNATE` (another version recorded at the same time,
unresolved), `TASK_SCOPED` (written for one task rather than as a standing rule)
or `DESCRIPTION` (somebody's account of what they believed was already
recorded). Replacing a rule's text files the old text as a variant
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

**Three** versions are on record, all written by the project owner. Each is now
classified by how it introduces itself:

| | Source | Classified as |
|---|---|---|
| **A** | Phase 2 §7, *"The established rules include:"* | the recorded text — register-framed, `OWNER_RESTATEMENT` |
| **B** | the BD-06 task preamble, *"IMPORTANT PROJECT RULES"* | `TASK_SCOPED` — its own rule 2 says *"in this task"* |
| **C** | Phase 3B §4, *"The known wording currently recorded includes…"* | `DESCRIPTION` — an account of what was believed to be recorded |

That settles what each version *is*. It does not settle whether A is the owner's
original wording: A also carried rules 25–27, and the owner's authoritative
wording for those three differs from A's version of them. So the rules bind, the
wording stays `RENDERING`, and **TRK-BD-02** is the owner's to close.

(Rule 1 is the one case where C is character-identical to A, so nothing was
filed as a separate version — recording it twice would invent a disagreement
that does not exist.)

## Rules 11 to 24 — no wording exists, and the search is on the record

**Three searches, fourteen recorded attempts**, each with its source, its method
and its result. They are in the tracker, on the Rules page, so that a rule marked
`MISSING` is an auditable conclusion rather than an absence — and so nobody runs
the same search a fourth time. What was searched:

- this repository and its complete history;
- the EJE working tree, **every blob** in all 91 of its commits, every commit message;
- `docs/SCOPE.md` and every other EJE document ever committed;
- **every one of the 34 454 conversation records**, JSON-decoded, every string
  walked — owner messages, assistant messages, tool results, attachments and
  pasted instructions alike, with the owner's own messages separated from
  machine-written summaries;
- the environment outside both repositories;
- **`EJE_Master_Scope_and_Audit_Baseline_v2.docx`** — the authoritative business
  scope of record, which `docs/SCOPE.md` names as the authority and which had
  never been opened.

**No wording numbered 11–24 exists in any of them.** The scope document is
decisive on the point: its own items 11–24 are *topic headings* — Checklists,
Parts Delivery Note, Media and Technical Library — not rules, and it contains no
rule register, no mention of "tracker" and no mention of "tablet friendly".

### What the searches did recover: 32 standing rules, verbatim

| | Source | Count |
|---|---|---|
| `SCOPE-P01`…`SCOPE-P09` | the scope document's §2 *Product objective and principles* | 9 |
| `SCOPE-D01`…`SCOPE-D08` | its §28 *Development control rule* | 8 |
| `PRIN-01`…`PRIN-14` | the founding instruction's *ARCHITECTURAL PRINCIPLES* | 14 |
| `STAND-01` | the CR-12 instruction's *MOST IMPORTANT RULE* | 1 |

All thirty-two are recorded as first-class rules and are in force. **None of them
carries a number**, and none was renumbered into the gap: assigning a number to a
rule on a resemblance — however good the arithmetic looks — is the fabrication
the rules forbid. **TRK-BD-01** is the owner's to close, with four options
including mapping named rules onto numbers or closing the gap by decision.

## Standing directives

Mandatory sections of the owner's own instructions, verbatim, that are not part
of the numbered series — EJE protection, clean code, no regressions, database
consistency, testing, tablet-first, security, demo users, tracker isolation,
deployment evidence, quality gate, cleanup, git, no guessing, no fake certainty.
They are recorded under their own `DIR-` identifiers rather than being
renumbered into the 11–24 gap, because renumbering them would be an invention of
exactly the kind the rules forbid.
