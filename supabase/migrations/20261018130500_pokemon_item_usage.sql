-- Item usage of one species, aggregated in SQL (code review H9).
--
-- `GET /api/pokemon/[name]/stats` is public and runs on every species page.
-- It used to read the full `pokemon` JSONB of every match-linked team row
-- through PostgREST (capped at max_rows, so the counts were silently wrong
-- past 1000 rows) and count items in Node. This function does the count in
-- the database and returns one small row per item:
--
--   * only teams linked to a COMPLETED match count (spec §7: a roster is
--     public once its match is completed);
--   * the GIN containment filter (`pokemon @> [{"species": ...}]`) narrows the
--     rows before the JSONB is expanded, using the partial index below;
--   * scope follows the match: `tournament` = the match's tournament,
--     `league` = any stage of the season (derived from tournaments, not from
--     teams.season_id, which match-linked rows never set), `all_time`
--     excludes test seasons and test accounts exactly as
--     `get_total_games_in_scope` does;
--   * the result is ordered by count and LIMITed (default 50, at most 200);
--     `total_sets` is the number of counted sets (with an item) over the whole
--     scope, computed before the limit, so percentages stay exact.
--
-- service_role only (AGENTS.md: no privilege in `public` for anon,
-- authenticated or PUBLIC).
--
-- Lock note: a plain CREATE INDEX holds a SHARE lock on `teams` (reads go on,
-- writes wait) for the build. CONCURRENTLY cannot run inside the transaction
-- a migration file runs in. `teams` is a small league table (one row per
-- player per tournament plus one per match-prep), so the build is expected to
-- take well under a second. If the table has grown large by the time this is
-- applied, move this statement to its own migration run as
-- CREATE INDEX CONCURRENTLY outside a transaction instead.

CREATE INDEX IF NOT EXISTS idx_teams_pokemon_match_linked
  ON public.teams USING gin (pokemon jsonb_path_ops)
  WHERE match_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_item_usage_for_pokemon(
  p_species text,
  p_scope_type public.aggregate_scope,
  p_scope_id uuid DEFAULT NULL,
  p_player_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (item text, uses bigint, total_sets bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH scoped_teams AS (
    SELECT t.pokemon
    FROM public.teams t
    JOIN public.matches m ON m.id = t.match_id
    WHERE t.match_id IS NOT NULL
      AND m.status = 'completed'
      AND jsonb_typeof(t.pokemon) = 'array'
      AND t.pokemon @> jsonb_build_array(jsonb_build_object('species', p_species))
      AND (p_player_id IS NULL OR t.player_id = p_player_id)
      AND (
        p_scope_type = 'all_time'
        OR (p_scope_type = 'tournament' AND m.tournament_id = p_scope_id)
        OR (
          p_scope_type = 'league'
          AND m.tournament_id IN (
            SELECT tr.id FROM public.tournaments tr WHERE tr.season_id = p_scope_id
          )
        )
      )
      AND (
        p_scope_type <> 'all_time'
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.tournaments tr
            JOIN public.seasons s ON s.id = tr.season_id
            WHERE tr.id = m.tournament_id AND s.is_test_season = true
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.players p
            WHERE p.id IN (m.player_1_id, m.player_2_id) AND p.is_test_account = true
          )
        )
      )
  ),
  sets AS (
    SELECT elem->>'item' AS item
    FROM scoped_teams st
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(st.pokemon) = 'array' THEN st.pokemon ELSE '[]'::jsonb END
    ) AS elem
    WHERE jsonb_typeof(elem) = 'object'
      AND elem->>'species' = p_species
      AND coalesce(elem->>'item', '') <> ''
  ),
  counted AS (
    SELECT s.item, count(*)::bigint AS uses
    FROM sets s
    GROUP BY s.item
  )
  SELECT c.item, c.uses, (sum(c.uses) OVER ())::bigint AS total_sets
  FROM counted c
  ORDER BY c.uses DESC, c.item
  LIMIT greatest(1, least(coalesce(p_limit, 50), 200));
$$;

COMMENT ON FUNCTION public.get_item_usage_for_pokemon(text, public.aggregate_scope, uuid, uuid, integer) IS
  'Item usage of one species in teams linked to completed matches, per scope (H9). service_role only.';

REVOKE ALL ON FUNCTION public.get_item_usage_for_pokemon(text, public.aggregate_scope, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_item_usage_for_pokemon(text, public.aggregate_scope, uuid, uuid, integer)
  TO service_role;
