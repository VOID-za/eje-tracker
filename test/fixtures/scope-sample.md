# Sample scope

## Change register

### CR-99 — A sample change request
*Confirmed 1 January 2026. Implemented `abc1234`.*

It changes THING-1 and THING-2.

## Requirement register

### CR-99 — the sample requirements

| ID | Requirement | Status | Commit | Evidence |
|---|---|---|---|---|
| THING-1 | The first thing works | **DONE** | `abc1234` | `thing.test.ts` |
| THING-2 | The second thing does not exist yet | **NOT IMPLEMENTED** | — | **Business decision required** |

| THING-3 | The third thing continues the table above | **DONE** | `abc1234` | `thing.test.ts` |

### Sample audit findings

| ID | Finding | Severity | Status | Where |
|---|---|---|---|---|
| AUD-1 | **Something is missing** and it matters | **ACCEPTANCE BLOCKER** | OPEN | THING-2 |

## Open business decisions

| ID | Question | Blocks |
|---|---|---|
| **BD-99** | Should the second thing exist? | THING-2 |
| **BD-98** | ~~Was the first thing right?~~ **ANSWERED 1 January 2026.** Yes. | closed |
