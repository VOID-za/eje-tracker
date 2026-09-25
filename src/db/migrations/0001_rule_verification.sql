-- Rules become first-class constraints with a provenance of their own.
--
-- WHY THIS EXISTS. The project rules are permanent constraints, not tasks, and
-- the difference between "this is the rule, in the owner's own words" and "this
-- is somebody's tidy summary of the rule" turned out to matter: the
-- authoritative wording of rules 25-27 arrived and differed materially from the
-- rendering the tracker had been given for them. A rule therefore now carries
-- how good its wording is known to be, and when a human last confirmed it.
--
-- ADDITIVE AND IDEMPOTENT. Nothing is dropped, nothing is rewritten, and every
-- existing row keeps its text, its status and its history.

ALTER TABLE rules ADD COLUMN IF NOT EXISTS wording_authority text NOT NULL DEFAULT 'RENDERING';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS verified_by text NOT NULL DEFAULT '';
-- The wording this rule had before, where a different version is on record.
-- Kept so that a rule whose wording was corrected still shows what it replaced.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS variant_wording text NOT NULL DEFAULT '';
ALTER TABLE rules ADD COLUMN IF NOT EXISTS variant_source text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE rules ADD CONSTRAINT rules_wording_authority_known CHECK (wording_authority IN (
    -- The project owner's own words, on record.
    'AUTHORITATIVE',
    -- In force, but the text on file is somebody's rendering of it. The rule
    -- binds; the wording awaits confirmation.
    'RENDERING',
    -- No wording could be recovered from any source, and none was invented.
    'MISSING'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
