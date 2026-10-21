-- Admin game edit lease: one running edit per game.
--
-- An admin game edit (editGame in src/lib/pkmn/game-pipeline.ts) is several requests: claim the editor's version,
-- cancel queued jobs, roll the counted aggregates back, rewrite the winner and battle_stats, re-apply the aggregates,
-- re-check evolutions. The version claim alone (a conditional UPDATE on games.updated_at) stops a second save that
-- carries the SAME editor version (a double submit, two admins on one editor version). It cannot stop an editor that
-- is reloaded WHILE an edit is running: every write of the running edit moves updated_at on, so the reloaded editor
-- holds a current version and its claim succeeds. For a counted game the rollback fence then answers 409, but for an
-- uncounted game without stats nothing else fences, and the two edits' battle_stats writes can interleave.
--
-- This migration adds an edit lease to games, claimed in the SAME statement as the version claim:
--   games.edit_lease_token  uuid         the running edit's random token, NULL when no edit holds the game
--   games.edit_lease_until  timestamptz  when the lease expires (database clock), NULL when free
--   claim_game_edit_lease(p_game_id, p_expected_updated_at, p_token, p_ttl_seconds) -> text
--       ONE conditional UPDATE: succeeds only while updated_at equals the editor's version AND no unexpired lease
--       is held; it stamps the token and now() + TTL. A second claim that waited on the first one's row lock
--       re-checks its WHERE against the committed row (READ COMMITTED) and matches nothing. Outcomes (exhaustive;
--       the TS wrapper throws on anything else):
--         'claimed'  the lease and the version are this edit's
--         'leased'   another edit holds an unexpired lease: nothing written (HTTP 409 admin_game_edit_in_progress)
--         'stale'    no lease is held, but the row is at another version: nothing written (409 admin_game_edit_stale)
--         'missing'  the row is gone: nothing written
--   release_game_edit_lease(p_game_id, p_token) -> boolean
--       Clears the lease only while it still carries p_token (an expired lease another edit took over is not
--       touched). Returns false when the token no longer holds the game (expired and taken over, or the game is
--       gone). The release moves updated_at on (trg_games_updated), so an editor opened during the edit is stale.
-- The lease expires on its own after the TTL, so an edit whose process died, or whose release failed, blocks the game
-- for at most that long. now() is the statement's transaction time: each RPC is its own transaction, so it is the
-- database clock at the call, never the app server's.
--
-- RLS on games is unchanged (enabled). games is service_role only (20261008081443_close_public_api_roles.sql); the
-- new columns inherit that, and the app's Game mapper (toGame) serialises an allowlist that does not include them.
-- Grants: both functions service_role only.
BEGIN;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS edit_lease_token uuid,
  ADD COLUMN IF NOT EXISTS edit_lease_until timestamptz;

ALTER TABLE public.games
  DROP CONSTRAINT IF EXISTS games_edit_lease_pair_check;
ALTER TABLE public.games
  ADD CONSTRAINT games_edit_lease_pair_check
  CHECK ((edit_lease_token IS NULL) = (edit_lease_until IS NULL));

COMMENT ON COLUMN public.games.edit_lease_token IS
  'Token of the admin edit running on this game (claim_game_edit_lease), NULL when no edit holds it.';
COMMENT ON COLUMN public.games.edit_lease_until IS
  'Expiry of the admin edit lease (database clock); an expired lease is free. NULL when no edit holds the game.';

CREATE OR REPLACE FUNCTION public.claim_game_edit_lease(
  p_game_id uuid,
  p_expected_updated_at timestamptz,
  p_token uuid,
  p_ttl_seconds integer
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lease_until timestamptz;
BEGIN
  IF p_game_id IS NULL OR p_expected_updated_at IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'claim_game_edit_lease: game id, expected version and token are required'
      USING ERRCODE = '22004';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION 'claim_game_edit_lease: ttl must be between 1 and 900 seconds (got %)', p_ttl_seconds
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.games
     SET edit_lease_token = p_token,
         edit_lease_until = now() + make_interval(secs => p_ttl_seconds)
   WHERE id = p_game_id
     AND updated_at = p_expected_updated_at
     AND (edit_lease_until IS NULL OR edit_lease_until <= now());
  IF FOUND THEN
    RETURN 'claimed';
  END IF;

  SELECT edit_lease_until INTO v_lease_until FROM public.games WHERE id = p_game_id;
  IF NOT FOUND THEN
    RETURN 'missing';
  END IF;
  IF v_lease_until IS NOT NULL AND v_lease_until > now() THEN
    RETURN 'leased';
  END IF;
  RETURN 'stale';
END;
$$;

COMMENT ON FUNCTION public.claim_game_edit_lease(uuid, timestamptz, uuid, integer) IS
  'Claim the admin edit lease of one game together with the editor''s version (updated_at) in one conditional UPDATE. Returns claimed | leased | stale | missing. Service-role only.';

CREATE OR REPLACE FUNCTION public.release_game_edit_lease(p_game_id uuid, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_game_id IS NULL OR p_token IS NULL THEN
    RAISE EXCEPTION 'release_game_edit_lease: game id and token are required' USING ERRCODE = '22004';
  END IF;

  UPDATE public.games
     SET edit_lease_token = NULL,
         edit_lease_until = NULL
   WHERE id = p_game_id
     AND edit_lease_token = p_token;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.release_game_edit_lease(uuid, uuid) IS
  'Release the admin edit lease of one game while it still carries p_token. Returns false when the token no longer holds the game. Service-role only.';

REVOKE ALL ON FUNCTION
  public.claim_game_edit_lease(uuid, timestamptz, uuid, integer),
  public.release_game_edit_lease(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.claim_game_edit_lease(uuid, timestamptz, uuid, integer),
  public.release_game_edit_lease(uuid, uuid)
TO service_role;

COMMIT;
