-- Same-pair-per-round guard (issue #131, the index that #38's fix deferred): a second match for one pairing in one
-- round is refused by the database, not only by the application. `round_write` and `phase_round_write` already
-- serialise two concurrent generators on the phase row (FOR NO KEY UPDATE) and re-check a reused round FOR UPDATE
-- (`rounds_round_already_written`); these indexes are the backstop for every other match writer (the dev seed, an
-- accepted challenge, an admin repair script) on both storage generations — `phase_matches` is the live one in
-- `phase` mode, `public.matches` the legacy table the standalone tournaments keep writing.
--
-- The pair is normalised (LEAST/GREATEST), so (A, B) and (B, A) are one pairing. Scoped to `bracket_pos IS NULL`:
-- a bracket match keeps its slot in `matches_round_side_pos_unique` / `phase_matches_round_side_pos_unique`, and a
-- bracket needs same-pair repeats in one round — the double-elimination Grand Finals reset shares the Grand Finals
-- round (`appendBracketReset`, src/lib/tournament/bracket-structure.ts).
--
-- Each precheck fails the migration when the table already holds duplicates; remove them through the admin UI first.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.matches WHERE bracket_pos IS NULL
    GROUP BY round_id, LEAST(player_1_id, player_2_id), GREATEST(player_1_id, player_2_id)
    HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'matches holds % duplicate pairings in one round; delete the extra matches first', n;
  END IF;
END $$;

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.phase_matches WHERE bracket_pos IS NULL
    GROUP BY round_id, LEAST(player_1_id, player_2_id), GREATEST(player_1_id, player_2_id)
    HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'phase_matches holds % duplicate pairings in one round; delete the extra matches first', n;
  END IF;
END $$;

CREATE UNIQUE INDEX matches_round_pair_unique
  ON public.matches (round_id, LEAST(player_1_id, player_2_id), GREATEST(player_1_id, player_2_id))
  WHERE bracket_pos IS NULL;

CREATE UNIQUE INDEX phase_matches_round_pair_unique
  ON public.phase_matches (round_id, LEAST(player_1_id, player_2_id), GREATEST(player_1_id, player_2_id))
  WHERE bracket_pos IS NULL;

COMMIT;
