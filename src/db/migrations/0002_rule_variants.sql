-- A rule can have more than one wording on record, so variants get a table.
--
-- WHY THIS REPLACES THE COLUMNS IT REPLACES. Migration 0001 gave each rule a
-- single `variant_wording`/`variant_source` pair, which was enough when exactly
-- two versions of a rule were known. Three are now known for rules 1-10, and a
-- second wording of rule 27 arrived a day after the first. A pair of columns
-- cannot hold that, and keeping them beside a variants table would leave two
-- places to look for the same fact.
--
-- NOTHING IS LOST. Every existing variant is copied into the new table before
-- the columns are dropped, and the copy is what the application reads
-- afterwards. Variants are append-only: a wording that was once on record stays
-- on record, because which words the project was given is part of its history.

CREATE TABLE IF NOT EXISTS rule_variants (
  id         bigserial PRIMARY KEY,
  rule_id    text NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  text       text NOT NULL,
  source     text NOT NULL DEFAULT '',
  -- What this wording is: a version the project was given before the current
  -- one, or another version recorded at the same time that nobody has resolved.
  kind       text NOT NULL DEFAULT 'HISTORICAL',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id, text),
  CONSTRAINT rule_variants_kind_known CHECK (kind IN ('HISTORICAL', 'ALTERNATE'))
);

CREATE INDEX IF NOT EXISTS rule_variants_rule_idx ON rule_variants (rule_id);

-- Carry across whatever 0001 recorded, before its columns go.
INSERT INTO rule_variants (rule_id, text, source, kind)
SELECT id, variant_wording, variant_source, 'HISTORICAL'
  FROM rules
 WHERE variant_wording <> ''
ON CONFLICT (rule_id, text) DO NOTHING;

ALTER TABLE rules DROP COLUMN IF EXISTS variant_wording;
ALTER TABLE rules DROP COLUMN IF EXISTS variant_source;
