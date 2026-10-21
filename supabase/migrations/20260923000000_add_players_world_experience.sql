-- players.world_experience: per-player 3D route-world preference.
-- 'auto' lets capability detection decide (default); 'on' always renders the
-- route tier (WebGL / reduced-motion hard floors still apply); 'off' always
-- shows the simple (Lite) version. Written only — applied through the repo's
-- migration process, never by hand.
ALTER TABLE "public"."players"
    ADD COLUMN IF NOT EXISTS "world_experience" text NOT NULL DEFAULT 'auto'
    CHECK ("world_experience" IN ('auto','on','off'));

COMMENT ON COLUMN "public"."players"."world_experience" IS
    'Per-player 3D world experience: auto = capability detection decides, on = always render the route tier (hard capability floors still apply), off = always the simple Lite version.';
