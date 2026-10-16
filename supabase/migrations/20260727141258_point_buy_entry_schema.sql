-- Point-buy list entry schema additions for xlsx import fidelity.
-- Adds prose/metadata columns from the sheet and stores ratings as smallint
-- so numeric filters/sorts work (text sorts "10" before "4").

ALTER TABLE "public"."point_buy_list_entries"
  ADD COLUMN IF NOT EXISTS "special_rules_text" "text",
  ADD COLUMN IF NOT EXISTS "sources" "text",
  ADD COLUMN IF NOT EXISTS "legacy_tier" "text";

-- Convert rating columns from text → smallint.
-- Empty strings and non-numeric values become NULL.
ALTER TABLE "public"."point_buy_list_entries"
  ALTER COLUMN "early_rating" TYPE smallint
    USING CASE
      WHEN "early_rating" IS NULL OR btrim("early_rating") = '' THEN NULL
      WHEN "early_rating" ~ '^-?\d+$' THEN "early_rating"::smallint
      ELSE NULL
    END,
  ALTER COLUMN "mid_rating" TYPE smallint
    USING CASE
      WHEN "mid_rating" IS NULL OR btrim("mid_rating") = '' THEN NULL
      WHEN "mid_rating" ~ '^-?\d+$' THEN "mid_rating"::smallint
      ELSE NULL
    END,
  ALTER COLUMN "late_rating" TYPE smallint
    USING CASE
      WHEN "late_rating" IS NULL OR btrim("late_rating") = '' THEN NULL
      WHEN "late_rating" ~ '^-?\d+$' THEN "late_rating"::smallint
      ELSE NULL
    END;

COMMENT ON COLUMN "public"."point_buy_list_entries"."special_rules_text" IS
  'Free-text special rules prose from the Point-Buy sheet (e.g. Mankey bans).';
COMMENT ON COLUMN "public"."point_buy_list_entries"."sources" IS
  'Source citations from the Point-Buy sheet.';
COMMENT ON COLUMN "public"."point_buy_list_entries"."legacy_tier" IS
  'Legacy tier label (Altes Tier) from the Point-Buy sheet.';
