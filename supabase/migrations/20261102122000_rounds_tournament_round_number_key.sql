-- One round per (tournament, round number).
--
-- generate-round, generate-all-rounds, generate-bracket and rounds/manual read the rounds, decide what is missing and
-- insert, with no lock between the read and the insert. Two overlapping calls (two admins, a double submit, a retry
-- after a lost response) wrote round N twice, each with its own set of match stubs. Every writer already intends the
-- number to be unique (Swiss, round robin and manual rounds use current_round + 1, bracket v2 uses global round
-- numbers), so the constraint only makes that intent binding. createRound maps a violation of it to a 409
-- (rounds_round_already_written, src/lib/supabase/queries/rounds.ts).
--
-- The DO block fails loudly and never deletes: an environment that already holds a duplicate pair resolves it first
-- (an empty duplicate through DELETE /api/admin/rounds/[id]; two rounds that both hold matches by a human decision).
--
-- No new grants and no league-trash inventory change: the table, its foreign keys and its triggers stay as they are,
-- and a restore re-inserts rounds that were unique when they were captured.
BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.rounds GROUP BY tournament_id, round_number HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'rounds holds % duplicate (tournament_id, round_number) pairs; delete the extra rounds through the admin round delete first', n;
  END IF;
END $$;

ALTER TABLE public.rounds
  ADD CONSTRAINT rounds_tournament_round_number_key UNIQUE (tournament_id, round_number);

COMMIT;
