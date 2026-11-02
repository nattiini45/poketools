-- A pool list names each Pokémon once (issue #47 follow-up).
--
-- The legacy picks route compares names by id (toID), so `Mr. Mime` and `mrmime` are one Pokémon. A pool list that
-- holds both counts two entries that only one pick can ever take, and a draft sized to the list can then never
-- complete. draft_pool_entries was unique on the exact (season_id, pokemon_name) only. This index is the arbiter of
-- two writers racing with different spellings (the admin pool routes and the evolution tier auto-sync):
--
--   uq_draft_pool_entries_season_folded_name  UNIQUE (season_id, epb_fold_id(pokemon_name))
--
-- epb_fold_id (20261012024103) is the SQL twin of toID. A violation is SQLSTATE 23505, which the pool-entry writers
-- (src/lib/supabase/queries/draft-pool-entries.ts) answer as 409 pool_entry_duplicate_name.
--
-- No backfill: stored names are not rewritten.
--
-- PRE-CHECK (read-only; run it against the target before applying). It must return no rows:
--   SELECT season_id, public.epb_fold_id(pokemon_name) AS folded, count(*), array_agg(pokemon_name)
--     FROM public.draft_pool_entries GROUP BY 1, 2 HAVING count(*) > 1;
-- The block below runs the same query and aborts with the offending season ids rather than skipping the index: a
-- silent skip would leave the duplicate hole open. On a hit, delete the duplicate entries by hand, then re-run.
--
-- A pool list is small (a few hundred rows), so a plain CREATE INDEX under a lock timeout is enough
-- (docs/operations-backup.md, "Writing migrations that do not lock busy tables", rule 4). No table or data change,
-- RLS and grants unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_seasons text;
BEGIN
  SELECT string_agg(DISTINCT d.season_id::text, ', ') INTO v_seasons
    FROM (SELECT season_id
            FROM public.draft_pool_entries
           GROUP BY season_id, public.epb_fold_id(pokemon_name)
          HAVING count(*) > 1) d;
  IF v_seasons IS NOT NULL THEN
    RAISE EXCEPTION 'uq_draft_pool_entries_season_folded_name: pool lists hold the same Pokémon twice (name folded with epb_fold_id); resolve before applying. Seasons: %', v_seasons;
  END IF;
END $$;

CREATE UNIQUE INDEX uq_draft_pool_entries_season_folded_name
  ON public.draft_pool_entries (season_id, public.epb_fold_id(pokemon_name));

COMMIT;
