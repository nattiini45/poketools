-- Persist admin-controlled redraft phase open/close on format_rules.
ALTER TABLE "public"."format_rules"
    ADD COLUMN IF NOT EXISTS "redraft_phase_open" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."format_rules"."redraft_phase_open" IS
    'When true, redraft swaps/trades and kill-token distribution are allowed for this EPB season.';
