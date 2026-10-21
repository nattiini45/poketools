-- players.sprite_style: the signed-in viewer's Pokemon sprite style (docs/pkmn.md, "Sprite styles").
--
--   site      = follow the deployment's default (SITE_DEFAULT_SPRITE_STYLE in src/lib/pkmn/sprite-styles.ts)
--   broadcast = the self-hosted high-resolution broadcast renders (falls back to home when unavailable)
--   home      = the HOME 3D renders
--   animated  = animated battle sprites
--   pixel     = static pixel sprites
--
-- The app's matching guard is isSpriteStylePreference (src/lib/pkmn/sprite-styles.ts); the anonymous
-- equivalent is the plc_sprite_style cookie written by POST /api/sprite-style.
--
-- Grants: none. public.players is service-role-only (20261008081443_close_public_api_roles.sql); a new
-- column inherits the table-level privileges, so anon and authenticated still hold nothing on it.
--
-- Locking: ADD COLUMN with a constant default is a catalog-only change (no table rewrite); the CHECK is
-- validated against the existing rows inside the same ACCESS EXCLUSIVE lock, which at league scale is
-- milliseconds (every existing row gets the default 'site', which passes).
ALTER TABLE "public"."players"
    ADD COLUMN "sprite_style" text NOT NULL DEFAULT 'site',
    ADD CONSTRAINT "players_sprite_style_check"
        CHECK ("sprite_style" IN ('site', 'broadcast', 'home', 'animated', 'pixel'));

COMMENT ON COLUMN "public"."players"."sprite_style" IS
    'Per-player Pokemon sprite style (default site = the deployment default): broadcast, home, animated or pixel. Read by /dashboard/settings, written by POST /api/sprite-style.';
