-- One battle, one recorded game (owner decision 2026-10-20 on audit lead F1, docs/security/audit-2026-10-20/README.md).
--
-- A Showdown replay is evidence for exactly one game result. Until now only the per-match URL check
-- (assertReplayNotDuplicate in src/lib/pkmn/game-pipeline.ts) stopped a replay from being reused, so the same battle
-- could be recorded again in another match, or in the same match through another URL form of it. From now on every
-- game recorded from a replay (POST /api/parse-replay, POST /api/admin/matches/[id]/replay-import) stores the SHA-256
-- of the replay's canonical battle log in games.replay_hash, in the same insert that records the result, and the
-- result itself (winner, battle stats) is parsed from that same fetched log (BoundReplay, src/lib/pkmn/replay-binding.ts).
-- What is hashed, and why, is documented in src/lib/pkmn/replay-identity.ts (version 'poketools-replay-hash-v1').
--
-- 1. games.replay_hash text, NULL for games not recorded from a replay. CHECK: 64 lowercase hex characters.
-- 2. UNIQUE partial index games_replay_hash_key (replay_hash) WHERE replay_hash IS NOT NULL: a battle already bound to
--    any game, in any match, is refused. The pipeline reads first (409 replay_already_recorded before any write);
--    createGame maps a violation of this index to the same error, so two concurrent submissions of one battle cannot
--    both insert (the residual "two identical replay submissions can both insert" in docs/match.md closes for replays).
--
-- This supersedes the "No replay_url uniqueness" note in 20261018130000_match_finalize_integrity.sql: the index is
-- partial (replay_hash IS NOT NULL) and only new or backfilled rows carry a hash. Existing rows keep replay_hash NULL; scripts/backfill-replay-hashes.ts
-- (dry run by default, refuses to write on any collision) fills them from replay.pokemonshowdown.com when a maintainer
-- runs it. The DO block below fails loudly (never deletes) if an environment already holds duplicate hashes, e.g. a
-- re-run after a partial backfill by hand.
--
-- Locks: ADD COLUMN without a default is metadata-only; the CHECK and the index scan games once under ACCESS EXCLUSIVE /
-- SHARE locks while they build; check the live row count before applying (docs/operations-backup.md).
--
-- No new grants: anon and authenticated hold nothing on public.games (20261008081443_close_public_api_roles.sql);
-- service_role keeps its table privileges, which cover the new column. RLS on games is unchanged.
BEGIN;

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS replay_hash text;

COMMENT ON COLUMN public.games.replay_hash IS
  'SHA-256 (64 lowercase hex) of the canonical battle log of the replay this game was recorded from '
  '(src/lib/pkmn/replay-identity.ts, version poketools-replay-hash-v1). Unique where set: one battle, one game. '
  'NULL for games not recorded from a replay, and for replay games recorded before 2026-10-20 until '
  'scripts/backfill-replay-hashes.ts fills them.';

-- Guarded like the column and the index (ADD CONSTRAINT has no IF NOT EXISTS), so a re-run of this file is a no-op
-- instead of failing here.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.games'::regclass AND conname = 'games_replay_hash_format_check'
  ) THEN
    ALTER TABLE public.games
      ADD CONSTRAINT games_replay_hash_format_check CHECK (replay_hash IS NULL OR replay_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.games WHERE replay_hash IS NOT NULL GROUP BY replay_hash HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'games holds % replay_hash values bound to more than one game; resolve them (admin game delete) first', n;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS games_replay_hash_key
  ON public.games (replay_hash)
  WHERE replay_hash IS NOT NULL;

COMMIT;
