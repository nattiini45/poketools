-- ---------------------------------------------------------------------------
-- AI Agent: move stored model priorities off the retired Xiaomi model id
-- ---------------------------------------------------------------------------
-- Xiaomi invalidates `mimo-v2.5-pro` on 2026-10-21 10:00 (UTC+8); its named
-- replacement is `mimo-v2.6-pro`, which is now the registry id. The router maps
-- the old id at read time as well (LEGACY_MODEL_IDS), but stored rows are
-- rewritten here so the settings form and the config route (which rejects
-- unknown ids on save) only ever see current ids.
-- ---------------------------------------------------------------------------

ALTER TABLE user_agent_profile
  ALTER COLUMN model_priority
  SET DEFAULT '["mimo-v2.6-pro","deepseek-v4-pro","claude-haiku-4-5"]';

UPDATE user_agent_profile
SET model_priority = (
      SELECT jsonb_agg(
               CASE WHEN elem = '"mimo-v2.5-pro"'::jsonb THEN '"mimo-v2.6-pro"'::jsonb ELSE elem END
               ORDER BY ord
             )
      FROM jsonb_array_elements(model_priority) WITH ORDINALITY AS t(elem, ord)
    ),
    updated_at = now()
WHERE jsonb_typeof(model_priority) = 'array'
  AND model_priority @> '["mimo-v2.5-pro"]'::jsonb;
