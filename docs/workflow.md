# The shared control workflow

The tracker is the shared memory of three parties who cannot talk to each other
directly: the **project owner**, **ChatGPT** and **Claude**. Nothing important
should exist only in a conversation.

```
HUMAN ──▶ CHATGPT ──▶ TRACKER ──▶ CLAUDE ──▶ TRACKER ──▶ CHATGPT / HUMAN
                          ▲                      │
                          └──── the only shared memory ───┘
```

## What is automatic, and what is not

| | How it works | Automatic? |
|---|---|---|
| Scope, rules and tracker items → tracker | `npm run import:scope` | **Yes**, once the timer in `deploy/` is installed |
| EJE commits, releases, delivery state → tracker | `npm run import:git` | **Yes**, same timer |
| Deployment state | live `/api/health` build stamp + `git merge-base` | **Yes**, and never any other way |
| Claude reads the state before work | `npm run brief` | Manual step Claude must perform |
| Claude records what it did | edit `data/tracker-items.json`, import, commit | Manual, and deliberately so |
| ChatGPT reads the state | the owner pastes `npm run brief` output, or reads `/rules`, `/items` over the tunnel | **Manual — see the limitation below** |
| Marking work DONE | owner approval | **Manual, always** |

### The ChatGPT limitation, stated plainly

There is no ChatGPT → tracker integration, and none is being invented. ChatGPT
cannot reach a service bound to `127.0.0.1:3100` on the VPS, and exposing the
tracker publicly to make that possible would be a security decision the owner has
not taken. The workable path, which needs no new software and no open port:

1. The owner runs `npm run brief` (or opens the tracker over the SSH tunnel).
2. The owner pastes that output into ChatGPT. It is one page and it is complete.
3. ChatGPT reasons about it and produces the next task.
4. The owner gives that task to Claude, which reads the tracker itself.

`npm run brief -- --json` gives the same state as JSON for anything that can
consume it. `/api/summary`, `/api/items`, `/api/rules`, `/api/decisions`,
`/api/releases` and `/api/verification` serve the same data to anything that can
reach the host, read-only, with a session or a bearer token that cannot write.

## Before any EJE work, Claude must

1. Run `npm run brief` — or read `/rules`, `/items`, `/decisions` over the tunnel.
2. Identify **which requirement and task IDs** the request affects. Name them.
3. Check none of them is already DONE. Work already finished is not redone.
4. Check no **open business decision** governs the change. There are open ones;
   implementing past a decision silently is forbidden by rule 3.
5. Identify **which rules apply** — always rule 25 (tablet) and rule 27
   (security), plus the cleanup rule whenever something is replaced.
6. Read what was implemented before, and what was verified before.
7. Check the current deployment state. PUSHED is not DEPLOYED.

If the right requirement cannot be determined, or a business decision is needed:
**stop and ask**. Do not choose silently.

## After any EJE work, Claude must record

In `data/tracker-items.json`, then `npm run import:scope`, then commit:

- the task or change ID, and the requirement IDs it affects;
- what changed, and **what was removed** — the cleanup rule is checkable, not aspirational;
- files changed, tests added or changed, tests actually run with their results;
- verification performed, including tablet and security where they apply;
- database or schema changes, and the migration status;
- the commit hash and whether it is pushed;
- the delivery state — `PUSHED` until the live build stamp proves otherwise;
- anything still outstanding, and any decision created or affected.

## What DONE means

A task is DONE only after **implementation + tests + verification + demo-role
testing + regression checks + the owner's approval**. Not before.

- Code exists → `IMPLEMENTED`, delivery `LOCAL` or `COMMITTED`.
- Pushed → delivery `PUSHED`. Still not deployed.
- Tests pass → `TESTING`.
- Verified → `APPROVED`.
- Owner approves → `DONE`.

The tracker enforces the shape of this: a status cannot jump from OPEN to DONE,
and `DECISION_REQUIRED → DONE` is allowed only for a decision record, where the
recorded answer is the whole deliverable. It cannot enforce the owner's approval
— that is a judgement, and claiming it falsely is the one failure the tracker
cannot catch. Do not claim it.

## What automation may never do

No automation in this system may deploy EJE, restart it, modify its files,
mutate its database, bypass human approval, mark work DONE without verification,
or expose a credential. The importers are read-only against the EJE checkout and
against the live health endpoint, and that is the whole of their contact with the
application.

## The prompt preamble

For any EJE task, the owner can paste this above the request:

> Before you write any code: read the EJE tracker (`npm run brief`, or `/rules`,
> `/items` and `/decisions` over the tunnel). Name the requirement and task IDs
> this affects, the rules that apply, and any open decision that governs it. Do
> not redo work the tracker records as DONE. Do not implement past an open
> decision — stop and ask. When you are finished, record the change in the
> tracker with its tests, verification, commit and delivery state, and do not
> mark it DONE without my approval.
