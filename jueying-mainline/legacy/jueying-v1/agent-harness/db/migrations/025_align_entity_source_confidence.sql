ALTER TABLE entity
  ADD COLUMN IF NOT EXISTS source_confidence real;

ALTER TABLE entity_attribute
  ADD COLUMN IF NOT EXISTS value_type text;
