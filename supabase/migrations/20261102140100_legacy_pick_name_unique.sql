-- A legacy pool never holds the same Pokémon twice (issue #47).
--
-- The legacy picks route compared names exactly (`Garchomp` vs `garchomp` were two Pokémon) and stored what the client
-- sent. The route now folds names with toID (src/lib/pkmn/i18n/id.ts) and stores the pool entry's canonical spelling;
-- this index is the database backstop and the arbiter of two picks racing for the same Pokémon. A violation is
-- SQLSTATE 23505 on uq_draft_picks_legacy_name_live, which the picks route answers as POKEMON_TAKEN (the pick-number
-- index uq_draft_picks_pool_number_live, 20261012024202, answers PICK_CONFLICT; the route tells them apart by name).
--
--   uq_draft_picks_legacy_name_live  UNIQUE (draft_pool_id, epb_fold_id(pokemon_name))
--                                    WHERE voided_at IS NULL AND line_id IS NULL
--
-- epb_fold_id (20261012024103) is the SQL twin of toID, so `Mr. Mime`, `Mr.Mime` and `mrmime` are one Pokémon, and the
-- accents and gender signs fold the same way in both languages. line_id IS NULL selects legacy picks: queue-engine and
-- Evolution Point Buy picks carry a line id and store the line's base name by design (two branches of one base share
-- it), so they are outside the index. Voided picks (an undo) free the name again.
--
-- No backfill: stored names are not rewritten (battle_stats joins, ownership checks and Discord history read them);
-- canonical spelling applies to new picks only.
--
-- PRE-CHECK (read-only; run it against the target before applying). It must return no rows:
--   SELECT draft_pool_id, public.epb_fold_id(pokemon_name) AS folded, count(*), array_agg(pokemon_name)
--     FROM public.draft_picks
--    WHERE voided_at IS NULL AND line_id IS NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;
-- The block below runs the same query and aborts with the offending pool ids rather than skipping the index: a
-- silent skip would leave the duplicate hole open. On a hit, void or repair the duplicate rows by hand, then re-run.
--
-- draft_picks is small (a league holds a few hundred rows), so a plain CREATE INDEX under a lock timeout is enough
-- (docs/operations-backup.md, "Writing migrations that do not lock busy tables", rule 4). No table or data change,
-- RLS and grants unchanged. Deploy order: before the code (the code only adds the 23505 mapping and the fold).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_pools text;
BEGIN
  SELECT string_agg(DISTINCT d.draft_pool_id::text, ', ') INTO v_pools
    FROM (SELECT draft_pool_id
            FROM public.draft_picks
           WHERE voided_at IS NULL AND line_id IS NULL
           GROUP BY draft_pool_id, public.epb_fold_id(pokemon_name)
          HAVING count(*) > 1) d;
  IF v_pools IS NOT NULL THEN
    RAISE EXCEPTION 'uq_draft_picks_legacy_name_live: legacy draft pools hold the same Pokémon twice (name folded with epb_fold_id); resolve before applying. Pools: %', v_pools;
  END IF;
END $$;

CREATE UNIQUE INDEX uq_draft_picks_legacy_name_live
  ON public.draft_picks (draft_pool_id, public.epb_fold_id(pokemon_name))
  WHERE voided_at IS NULL AND line_id IS NULL;

COMMIT;
