-- Tighten the broadcast_moments.match_id FK from ON DELETE NO ACTION to
-- ON DELETE CASCADE (spec §26).
--
-- broadcast_moments is a match-derived child table, NOT a shared object: each
-- row is a highlight moment (turning_point / big_ko / misplay / clutch /
-- highlight) scoped to a single match's games. Its sibling match-children FKs
-- are all ON DELETE CASCADE for the same reason — they are owned by the match:
--   - match_prep_teams.match_id        (CASCADE)
--   - match_proposals.match_id         (CASCADE)
--   - match_analyses.match_id          (CASCADE)
--   - match_prep_analyses.match_id     (CASCADE)
--   - match_evolution_snapshots.match_id (CASCADE)
--   - games.match_id                   (CASCADE)
--   - epb_animation_views.match_id     (CASCADE)
--   - rating_history.match_id          (CASCADE)
--
-- The baseline schema left broadcast_moments.match_id as a bare FOREIGN KEY
-- (NO ACTION), which is the one clearly-wrong, orphan-prone exception: a hard
-- DELETE on matches(id) would be BLOCKED by the existing moments rows instead
-- of cleaning them up. The soft-reset path (cleanMatchChildren, spec §17/§18,
-- Task T5) already deletes broadcast_moments by match_id explicitly, so this
-- CASCADE is defense-in-depth: it additionally guarantees no orphan rows and
-- no blocked hard delete at the DB level. cleanMatchChildren continues to work
-- identically — it deletes by match_id regardless of the FK action.

ALTER TABLE "public"."broadcast_moments"
  DROP CONSTRAINT IF EXISTS "broadcast_moments_match_id_fkey";

ALTER TABLE "public"."broadcast_moments"
  ADD CONSTRAINT "broadcast_moments_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE CASCADE;

COMMENT ON CONSTRAINT "broadcast_moments_match_id_fkey" ON "public"."broadcast_moments" IS
  'broadcast_moments is match-derived (not a shared object), so ON DELETE CASCADE matches the sibling match-children FKs (match_prep_teams, match_proposals, match_analyses, match_prep_analyses, match_evolution_snapshots). The soft-reset path (cleanMatchChildren) deletes them explicitly; this CASCADE is defense-in-depth for hard deletes + referential integrity.';

-- NOTE — INTENTIONALLY-PRESERVED SET NULL FKs on SHARED objects (do NOT cascade):
--   - teams.match_id            ON DELETE SET NULL
--       A teambuilder team is a shared, reusable object the player owns; a
--       match delete must only detach the team (clear the provenance pointer),
--       not destroy the saved team.
--   - cast_sessions.match_id    ON DELETE SET NULL
--       A Cast Studio session is reusable across matches; a match delete must
--       only clear the association, not drop the session.
--   - agent_suggestions.match_id ON DELETE SET NULL
--       An AI suggestion row is reusable across matches; only the pointer is
--       cleared. (agent_tables migration, 20260610220000.)
-- These SET NULL actions are the documented §26 decision: shared objects are
-- preserved on match delete; only match-derived/owned rows cascade.

-- NOTE — player_streaks.last_match_id is intentionally left ON DELETE NO ACTION
-- (untouched here). last_match_id is a staleness/pointer column whose value is
-- reconciled by recomputeStreaks (spec §17), not by the match-delete path.
-- Changing its FK action is out of scope for §26 and risky: a cascade would
-- drop the whole streak row (losing the streak history) and a SET NULL would
-- leave a streak pointing at a deleted match until the next recompute. The
-- NO ACTION default is correct as long as hard match deletes go through a path
-- that nulls/recomputes streaks first; that orchestration is tracked separately.