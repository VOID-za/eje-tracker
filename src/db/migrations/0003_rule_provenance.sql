-- Provenance, and the record of the search itself.
--
-- WHY. The project owner asked for each rule's source TYPE and DATE, not just a
-- citation string, and — where a rule cannot be recovered — for the tracker to
-- record what was searched, how, and what was found. A missing rule with an
-- auditable search behind it is a finding; a missing rule with nothing behind it
-- is just an absence, and the two should not look alike.
--
-- ADDITIVE AND IDEMPOTENT. No column is dropped, no row is rewritten.

ALTER TABLE rules ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS source_date date;

DO $$ BEGIN
  ALTER TABLE rules ADD CONSTRAINT rules_source_type_known CHECK (source_type IN (
    -- The project owner wrote it, in a message to the project.
    'OWNER_MESSAGE',
    -- It is in the authoritative business scope document.
    'SCOPE_DOCUMENT',
    -- The owner restated rules that exist elsewhere; the wording is theirs, the
    -- rule is older than the restatement.
    'OWNER_RESTATEMENT',
    -- No source was found at all.
    'NONE',
    'UNKNOWN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE rule_variants ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE rule_variants ADD COLUMN IF NOT EXISTS source_date date;

-- A variant is not only "older" or "another version": the evidence now
-- distinguishes a wording written for one task from a description of what
-- somebody believed was already recorded.
ALTER TABLE rule_variants DROP CONSTRAINT IF EXISTS rule_variants_kind_known;
ALTER TABLE rule_variants ADD CONSTRAINT rule_variants_kind_known CHECK (kind IN (
  -- A wording the current one replaced.
  'HISTORICAL',
  -- Another version recorded at the same time, unresolved.
  'ALTERNATE',
  -- Written for one task, not as a standing rule ("in this task").
  'TASK_SCOPED',
  -- A description of what somebody believed was already recorded.
  'DESCRIPTION'));

-- THE SEARCH RECORD. Append-only: what was looked in, how, and what came back.
-- This is what makes "SOURCE_MISSING" an auditable conclusion rather than an
-- assumption, and it is why nobody has to run the same search twice.
CREATE TABLE IF NOT EXISTS rule_searches (
  id          bigserial PRIMARY KEY,
  scope       text NOT NULL,
  source      text NOT NULL,
  method      text NOT NULL,
  result      text NOT NULL,
  found       boolean NOT NULL DEFAULT false,
  evidence    text NOT NULL DEFAULT '',
  searched_by text NOT NULL DEFAULT '',
  searched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, source, method)
);

CREATE INDEX IF NOT EXISTS rule_searches_scope_idx ON rule_searches (scope);
