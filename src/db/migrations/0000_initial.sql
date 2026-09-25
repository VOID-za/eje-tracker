-- EJE Project Tracker — initial schema.
--
-- WHAT THIS IS NOT. It is not a copy of the EJE application's data model and it
-- never holds EJE business data: no customers, no machines, no job cards, no
-- signatures. It holds the PROJECT's record of itself — what was required, what
-- was decided, what was built, what was verified and what is actually running.
--
-- IDENTITY IS THE SCOPE'S OWN. `items.id` is the identifier the authoritative
-- document already uses — 'CR-12', 'BD-06', 'PARTS-17' — so importing the same
-- document twice updates the same row rather than creating a second one, and a
-- requirement keeps the name everybody already calls it by. Tracker-native
-- records get 'T-0001'.

-- The runner creates this before it reads the directory, so that it can tell
-- which migrations have run; it is declared here as well because this file is
-- the schema of record and a reader should not have to know that.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

/* -------------------------------------------------------------------------- */
/* The ledger                                                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE items (
  id          text PRIMARY KEY,
  kind        text NOT NULL,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',

  -- TWO AXES, DELIBERATELY NOT ONE.
  --
  -- `status` is how far the WORK has got; `delivery` is where the CODE has got
  -- to. Collapsing them is what lets "pushed" be mistaken for "deployed", which
  -- is the confusion this system exists to end.
  status      text NOT NULL DEFAULT 'OPEN',
  delivery    text NOT NULL DEFAULT 'NOT_STARTED',

  priority    text NOT NULL DEFAULT 'NORMAL',
  category    text NOT NULL DEFAULT '',
  -- Grouping is DATA, not code: 'PLATFORM/Offline & PWA'. A new grouping needs
  -- no deployment.
  group_path  text NOT NULL DEFAULT '',
  phase       text NOT NULL DEFAULT '',
  severity    text,
  acceptance_blocker boolean NOT NULL DEFAULT false,

  -- Where this came from, precisely enough to go and look.
  source        text NOT NULL DEFAULT '',
  source_ref    text NOT NULL DEFAULT '',
  source_line   integer,
  source_status text NOT NULL DEFAULT '',
  source_missing boolean NOT NULL DEFAULT false,

  evidence    text NOT NULL DEFAULT '',
  notes       text NOT NULL DEFAULT '',
  parent_id   text REFERENCES items(id) ON DELETE SET NULL,

  approved_by text,
  approved_at timestamptz,
  production_verified_at timestamptz,

  -- Nothing in the project's own records carries a date it is due by, so this is
  -- null for every imported item. It exists so that "overdue" can eventually be
  -- counted rather than estimated, and until a date is set the dashboard says so
  -- instead of quietly reporting zero.
  due_date     date,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deployed_at  timestamptz,

  CONSTRAINT items_status_known CHECK (status IN (
    'OPEN','PLANNED','IN_PROGRESS','BLOCKED','DECISION_REQUIRED','IMPLEMENTED',
    'TESTING','APPROVED','DONE','DEFERRED','CANCELLED','SUPERSEDED')),
  CONSTRAINT items_delivery_known CHECK (delivery IN (
    'NOT_STARTED','LOCAL','COMMITTED','PUSHED','DEPLOYED')),
  CONSTRAINT items_priority_known CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL'))
);

CREATE INDEX items_status_idx   ON items (status);
CREATE INDEX items_kind_idx     ON items (kind);
CREATE INDEX items_delivery_idx ON items (delivery);
CREATE INDEX items_group_idx    ON items (group_path);
CREATE INDEX items_parent_idx   ON items (parent_id);
CREATE INDEX items_blocker_idx  ON items (acceptance_blocker) WHERE acceptance_blocker;

/* -------------------------------------------------------------------------- */
/* History — APPEND ONLY. Nothing here is ever updated or deleted.             */
/* -------------------------------------------------------------------------- */

CREATE TABLE history (
  id          bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  actor       text NOT NULL DEFAULT 'system',
  kind        text NOT NULL,
  summary     text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  evidence    text NOT NULL DEFAULT ''
);

CREATE INDEX history_entity_idx ON history (entity_type, entity_id, at);

/* -------------------------------------------------------------------------- */
/* Traceability                                                               */
/* -------------------------------------------------------------------------- */

CREATE TABLE relations (
  id        bigserial PRIMARY KEY,
  from_type text NOT NULL,
  from_id   text NOT NULL,
  to_type   text NOT NULL,
  to_id     text NOT NULL,
  kind      text NOT NULL,
  UNIQUE (from_type, from_id, to_type, to_id, kind)
);

CREATE INDEX relations_from_idx ON relations (from_type, from_id);
CREATE INDEX relations_to_idx   ON relations (to_type, to_id);

-- The cleanup record: what a change ADDED, and what it REMOVED, and whether the
-- removal was proved. "Added the new implementation and left the old one" is
-- the failure this table exists to make visible.
CREATE TABLE item_files (
  id      bigserial PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  path    text NOT NULL,
  action  text NOT NULL,
  verified_unreferenced boolean NOT NULL DEFAULT false,
  note    text NOT NULL DEFAULT '',
  UNIQUE (item_id, path, action),
  CONSTRAINT item_files_action_known CHECK (action IN ('ADDED','MODIFIED','REMOVED'))
);

/* -------------------------------------------------------------------------- */
/* Git, releases and evidence                                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE commits (
  hash         text PRIMARY KEY,
  repo         text NOT NULL DEFAULT 'VOID-za/EJE-Managment',
  branch       text NOT NULL DEFAULT '',
  author       text NOT NULL DEFAULT '',
  committed_at timestamptz,
  subject      text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT ''
);

CREATE TABLE releases (
  id            text PRIMARY KEY,
  commit_hash   text NOT NULL REFERENCES commits(hash),
  repo          text NOT NULL DEFAULT 'VOID-za/EJE-Managment',
  server        text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'PUSHED',
  deployed_at   timestamptz,
  build_result  text NOT NULL DEFAULT '',
  health_result text NOT NULL DEFAULT '',
  verification_result text NOT NULL DEFAULT '',
  -- WHERE THE DEPLOYMENT CLAIM CAME FROM. A release is only DEPLOYED when
  -- something outside this database said so — the live /api/health build stamp.
  -- Nobody gets to type "deployed" into a form and have it believed.
  evidence      text NOT NULL DEFAULT '',
  observed_at   timestamptz,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_status_known CHECK (status IN
    ('LOCAL','COMMITTED','PUSHED','DEPLOYED','ROLLED_BACK'))
);

CREATE TABLE release_items (
  release_id text NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (release_id, item_id)
);

CREATE TABLE verification_runs (
  id         bigserial PRIMARY KEY,
  item_id    text REFERENCES items(id) ON DELETE SET NULL,
  release_id text REFERENCES releases(id) ON DELETE SET NULL,
  command    text NOT NULL,
  result     text NOT NULL,
  passed     integer,
  total      integer,
  commit_hash text,
  ran_at     timestamptz NOT NULL DEFAULT now(),
  detail     text NOT NULL DEFAULT '',
  CONSTRAINT verification_result_known CHECK (result IN ('PASS','FAIL','SKIPPED','UNKNOWN'))
);

CREATE INDEX verification_item_idx ON verification_runs (item_id);

/* -------------------------------------------------------------------------- */
/* Rules and decisions                                                        */
/* -------------------------------------------------------------------------- */

-- THE PROJECT'S RULES, VERBATIM. `text` is never paraphrased: a rule that has
-- been reworded is a different rule. Where the authoritative wording could not
-- be recovered, the row exists with status SOURCE_MISSING and an EMPTY text —
-- an honest gap rather than an invented sentence.
CREATE TABLE rules (
  id          text PRIMARY KEY,
  ordinal     integer,
  text        text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'ACTIVE',
  -- Why a rule is in the state it is in — used to say, on the Rules page, that a
  -- SOURCE_MISSING rule is an unrecovered gap rather than an empty rule.
  note        text NOT NULL DEFAULT '',
  source      text NOT NULL DEFAULT '',
  source_ref  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rules_status_known CHECK (status IN ('ACTIVE','SOURCE_MISSING','SUPERSEDED','RETIRED'))
);

-- The decision record. The QUESTION and the OPTIONS are kept even after the
-- decision is made: how something was decided is part of the decision.
CREATE TABLE decisions (
  id        text PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  question  text NOT NULL,
  options   text NOT NULL DEFAULT '',
  blocks    text NOT NULL DEFAULT '',
  decision  text NOT NULL DEFAULT '',
  decided_by text NOT NULL DEFAULT '',
  decided_at timestamptz,
  implementation_status text NOT NULL DEFAULT '',
  affected_files text NOT NULL DEFAULT ''
);

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL DEFAULT '',
  -- scrypt, salt inside the encoded value. There is no plaintext anywhere and
  -- no password in any migration, seed, document or log.
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'admin',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE TABLE sessions (
  -- The SHA-256 of the token, never the token. A stolen database does not
  -- hand over a usable session.
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  user_agent text NOT NULL DEFAULT ''
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Who did what in the tracker itself.
CREATE TABLE audit_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL DEFAULT 'anonymous',
  action  text NOT NULL,
  target  text NOT NULL DEFAULT '',
  detail  text NOT NULL DEFAULT '',
  ip      text NOT NULL DEFAULT ''
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
