-- Evolution Point Buy format extension
-- Adds: versioned point-buy lists, progress source tracking, format rules,
-- redraft history, team roles, and extends evolution_tracker with source columns.

-- 1.1 Extend season format enum
ALTER TYPE "public"."season_format_type" ADD VALUE IF NOT EXISTS 'evolution_point_buy';

-- 1.2 Versioned point-buy list container (immutable snapshots)
CREATE TABLE IF NOT EXISTS "public"."point_buy_list_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "name" "text" NOT NULL,
    "version" integer NOT NULL DEFAULT 1,
    "source" "text",
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    UNIQUE("name", "version")
);

ALTER TABLE "public"."point_buy_list_versions" OWNER TO "postgres";
ALTER TABLE "public"."point_buy_list_versions" ENABLE ROW LEVEL SECURITY;

-- 1.3 Point-buy list entries (102 evolution lines per version)
CREATE TABLE IF NOT EXISTS "public"."point_buy_list_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "list_version_id" "uuid" NOT NULL REFERENCES "public"."point_buy_list_versions"("id") ON DELETE CASCADE,
    "line_number" smallint NOT NULL,
    "base_pokemon" "text" NOT NULL,
    "stage2_pokemon" "text" NOT NULL,
    "stage3_pokemon" "text",
    "price" smallint NOT NULL,
    "kills_to_stage2" smallint NOT NULL,
    "additional_kills_to_stage3" smallint,
    "price_group" "text" NOT NULL,
    "early_rating" "text",
    "mid_rating" "text",
    "late_rating" "text",
    "rationale" "text",
    "historical_data" "text",
    "special_rules" "jsonb" DEFAULT NULL,
    UNIQUE("list_version_id", "line_number"),
    UNIQUE("list_version_id", "base_pokemon", "stage3_pokemon")
);

ALTER TABLE "public"."point_buy_list_entries" OWNER TO "postgres";
ALTER TABLE "public"."point_buy_list_entries" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "idx_pble_version" ON "public"."point_buy_list_entries" ("list_version_id");

-- Postgres treats NULLs as distinct in UNIQUE constraints; enforce dedup for
-- 2-stage lines (no stage3) with a partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pble_no_stage3"
    ON "public"."point_buy_list_entries" ("list_version_id", "base_pokemon")
    WHERE "stage3_pokemon" IS NULL;

-- 1.4 Bind seasons to a point-buy list version
ALTER TABLE "public"."seasons"
    ADD COLUMN IF NOT EXISTS "point_buy_list_id" "uuid" REFERENCES "public"."point_buy_list_versions"("id");

-- 1.5 Extend evolution_tracker with progress source columns
ALTER TABLE "public"."evolution_tracker"
    ADD COLUMN IF NOT EXISTS "real_kills" smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "draft_tokens" smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "kill_tokens" smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "cosmo_points" smallint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "suspended_until_matchday" smallint DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS "evolution_points_awarded" smallint NOT NULL DEFAULT 0;

-- 1.6 Evolution progress audit log
CREATE TABLE IF NOT EXISTS "public"."evo_progress_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "tracker_id" "uuid" NOT NULL REFERENCES "public"."evolution_tracker"("id") ON DELETE CASCADE,
    "season_id" "uuid" NOT NULL REFERENCES "public"."seasons"("id"),
    "matchday" smallint,
    "source" "text" NOT NULL CHECK ("source" IN ('real_kill', 'draft_token', 'kill_token', 'cosmo_point', 'admin_correction')),
    "amount" smallint NOT NULL,
    "note" "text",
    "created_by" "uuid" REFERENCES "public"."players"("id"),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."evo_progress_log" OWNER TO "postgres";
ALTER TABLE "public"."evo_progress_log" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "idx_epl_tracker" ON "public"."evo_progress_log" ("tracker_id");
CREATE INDEX IF NOT EXISTS "idx_epl_season" ON "public"."evo_progress_log" ("season_id");

-- 1.7 Per-season format configuration
CREATE TABLE IF NOT EXISTS "public"."format_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "season_id" "uuid" NOT NULL UNIQUE REFERENCES "public"."seasons"("id") ON DELETE CASCADE,
    "banned_moves" "text"[] NOT NULL DEFAULT '{}',
    "banned_items" "text"[] NOT NULL DEFAULT '{}',
    "tera_rules" "jsonb" NOT NULL DEFAULT '{"stage1":"any","stage2":"stab_only","stage3":"none"}',
    "tiebreaker_order" "text"[] NOT NULL DEFAULT '{"match_points","evolution_points","kill_difference","head_to_head","decision_match"}',
    "draft_budget" smallint NOT NULL DEFAULT 180,
    "draft_picks" smallint NOT NULL DEFAULT 9,
    "draft_token_ratio" smallint NOT NULL DEFAULT 3,
    "draft_token_max" smallint NOT NULL DEFAULT 2,
    "draft_token_max_per_line" smallint NOT NULL DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."format_rules" OWNER TO "postgres";
ALTER TABLE "public"."format_rules" ENABLE ROW LEVEL SECURITY;

-- 1.8 Redraft/trade audit history
CREATE TABLE IF NOT EXISTS "public"."redraft_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "season_id" "uuid" NOT NULL REFERENCES "public"."seasons"("id"),
    "player_id" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "from_tracker_id" "uuid" REFERENCES "public"."evolution_tracker"("id"),
    "to_base_pokemon" "text" NOT NULL,
    "to_stage3_pokemon" "text",
    "transfer_type" "text" NOT NULL CHECK ("transfer_type" IN ('trade', 'free_swap')),
    "trade_partner_id" "uuid" REFERENCES "public"."players"("id"),
    "missing_kills_transferred" smallint NOT NULL DEFAULT 0,
    "points_spent" smallint NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."redraft_history" OWNER TO "postgres";
ALTER TABLE "public"."redraft_history" ENABLE ROW LEVEL SECURITY;

-- 1.9 Team roles for matchup sheet (8 categories)
CREATE TABLE IF NOT EXISTS "public"."team_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "species_form" "text" NOT NULL,
    "stage" smallint,
    "category" "text" NOT NULL CHECK ("category" IN (
        'hazard_setting', 'hazard_removal', 'healing_cleric', 'momentum',
        'item_removal', 'status', 'priority', 'disruption'
    )),
    "move_name" "text" NOT NULL,
    "source" "text",
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    UNIQUE("species_form", "category", "move_name")
);

ALTER TABLE "public"."team_roles" OWNER TO "postgres";
ALTER TABLE "public"."team_roles" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "idx_team_roles_species" ON "public"."team_roles" ("species_form");
