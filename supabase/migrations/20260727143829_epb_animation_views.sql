-- Per-player viewed state for EPB Crystal XP match replays (replaces localStorage).

CREATE TABLE IF NOT EXISTS "public"."epb_animation_views" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "player_id" uuid NOT NULL REFERENCES "public"."players"("id") ON DELETE CASCADE,
  "match_id" uuid NOT NULL REFERENCES "public"."matches"("id") ON DELETE CASCADE,
  "viewed_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "epb_animation_views_player_match_key" UNIQUE ("player_id", "match_id")
);

ALTER TABLE "public"."epb_animation_views" OWNER TO "postgres";
ALTER TABLE "public"."epb_animation_views" ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE "public"."epb_animation_views" IS
  'Tracks which EPB match evolution replays a player has already viewed.';
