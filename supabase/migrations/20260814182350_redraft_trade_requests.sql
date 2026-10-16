-- Evolution Point Buy: deferred trade-consent flow (3B-2-a)
--
-- A trade used to execute immediately when an admin confirmed it. This adds a
-- blocking consent gate: an admin initiates a trade -> it stays PENDING -> both
-- players must consent -> only then does it execute atomically.
-- Free swaps (taking a free, undrafted line) are unchanged — they take no line
-- from another player, so they still execute immediately and need no request row.
--
-- The swap engine itself (epb_execute_redraft RPC + prepareRedraftSwap) is NOT
-- duplicated: the consent execute path reuses it with FRESH remaining points.
-- This table only holds the consent state + a denormalized line snapshot for
-- display; the authoritative validation happens at execute time, not create time.
--
-- Race/double-execute guards:
--   * Partial unique indexes on (from_tracker_a_id) / (from_tracker_b_id) for
--     pending rows mean a source tracker can be in at most ONE pending trade at
--     a time (prevents two overlapping pending trades over the same tracker).
--   * claimForExecution is an atomic UPDATE ... WHERE status='pending' AND
--     consent_a AND consent_b RETURNING *: only the caller that gets a row
--     proceeds to execute, so concurrent double-consent cannot double-execute.

CREATE TABLE IF NOT EXISTS "public"."redraft_trade_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "season_id" "uuid" NOT NULL REFERENCES "public"."seasons"("id") ON DELETE CASCADE,
    "initiated_by" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "player_a_id" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "from_tracker_a_id" "uuid" REFERENCES "public"."evolution_tracker"("id") ON DELETE SET NULL,
    "line_a" "text" NOT NULL,
    "player_b_id" "uuid" NOT NULL REFERENCES "public"."players"("id"),
    "from_tracker_b_id" "uuid" REFERENCES "public"."evolution_tracker"("id") ON DELETE SET NULL,
    "line_b" "text" NOT NULL,
    "status" "text" NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'executed', 'cancelled')),
    "consent_a" boolean NOT NULL DEFAULT false,
    "consent_b" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "executed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid" REFERENCES "public"."players"("id"),
    "executed_tracker_ids" "jsonb"
);

ALTER TABLE "public"."redraft_trade_requests" OWNER TO "postgres";
ALTER TABLE "public"."redraft_trade_requests" ENABLE ROW LEVEL SECURITY;

-- Season-scoped lookup (admin view) + per-player consent lookups.
CREATE INDEX IF NOT EXISTS "idx_redraft_trade_requests_season"
    ON "public"."redraft_trade_requests" ("season_id");
CREATE INDEX IF NOT EXISTS "idx_redraft_trade_requests_season_a"
    ON "public"."redraft_trade_requests" ("season_id", "player_a_id");
CREATE INDEX IF NOT EXISTS "idx_redraft_trade_requests_season_b"
    ON "public"."redraft_trade_requests" ("season_id", "player_b_id");

-- A source tracker may be in at most one PENDING trade at a time. Prevents two
-- overlapping pending trades over the same line from being created in parallel.
-- The partial predicate (status = 'pending' AND from_tracker_*_id IS NOT NULL)
-- means executed/cancelled rows never block a future trade over the same line.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_redraft_trade_pending_tracker_a"
    ON "public"."redraft_trade_requests" ("from_tracker_a_id")
    WHERE "status" = 'pending' AND "from_tracker_a_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_redraft_trade_pending_tracker_b"
    ON "public"."redraft_trade_requests" ("from_tracker_b_id")
    WHERE "status" = 'pending' AND "from_tracker_b_id" IS NOT NULL;

COMMENT ON TABLE "public"."redraft_trade_requests" IS
  'Service-role only. Holds the pending consent state for EPB trades (not free swaps); no anon/browser RLS policies by design.';