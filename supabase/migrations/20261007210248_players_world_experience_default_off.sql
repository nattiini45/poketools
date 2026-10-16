-- players.world_experience: the 3D route world is opt-in (owner, 2026-10-06).
-- The column default becomes 'off', and every existing player is set to 'off',
-- including explicit 'on' / 'auto' choices (owner decision: force everyone Off;
-- players can switch it back on /dashboard/settings). The app's matching
-- default for signed-out visitors and failed reads is DEFAULT_WORLD_EXPERIENCE
-- in src/types/player.ts. Written only — applied through the repo's migration
-- process, never by hand.
-- Locking: the file applies as one transaction, so the ALTER's ACCESS EXCLUSIVE
-- lock on players is held through the UPDATE and the COMMENT, and every players
-- read (the live auth guards re-read it on each guarded call) waits for the
-- commit. The UPDATE touches only rows not yet 'off', so at league scale that is
-- milliseconds. The ALTER comes first on purpose: a sign-up during the migration
-- waits for the lock and gets 'off'; with the UPDATE first, a sign-up between
-- the two statements would keep 'auto'. Should players grow large, move the
-- UPDATE into a later migration: the new default covers rows inserted between.
ALTER TABLE "public"."players"
    ALTER COLUMN "world_experience" SET DEFAULT 'off';

UPDATE "public"."players"
    SET "world_experience" = 'off'
    WHERE "world_experience" <> 'off';

COMMENT ON COLUMN "public"."players"."world_experience" IS
    'Per-player 3D world experience (default off): auto = capability detection decides, on = always render the route tier (hard capability floors still apply), off = always the simple Lite version.';
