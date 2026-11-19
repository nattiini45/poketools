BEGIN;

CREATE FUNCTION public.get_item_usage_for_pokemon_phase_storage(
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
    FROM public.phase_teams t
    JOIN public.phase_matches m ON m.phase_id = t.phase_id AND m.id = t.match_id
    JOIN public.league_phases ph ON ph.id = m.phase_id
    JOIN public.seasons s ON s.id = ph.season_id
    WHERE t.match_id IS NOT NULL
      AND m.status = 'completed'
      AND jsonb_typeof(t.pokemon) = 'array'
      AND t.pokemon @> jsonb_build_array(jsonb_build_object('species', p_species))
      AND (p_player_id IS NULL OR t.player_id = p_player_id)
      AND (
        (p_scope_type = 'league' AND ph.season_id = p_scope_id)
        OR (
          p_scope_type = 'all_time'
          AND s.is_test_season IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1 FROM public.players p
            WHERE p.id IN (m.player_1_id, m.player_2_id) AND p.is_test_account = true
          )
        )
      )

    UNION ALL

    SELECT t.pokemon
    FROM public.teams t
    JOIN public.matches m ON m.id = t.match_id
    JOIN public.tournaments tr ON tr.id = m.tournament_id AND tr.season_id IS NULL
    WHERE p_scope_type = 'all_time'
      AND t.match_id IS NOT NULL
      AND m.status = 'completed'
      AND jsonb_typeof(t.pokemon) = 'array'
      AND t.pokemon @> jsonb_build_array(jsonb_build_object('species', p_species))
      AND (p_player_id IS NULL OR t.player_id = p_player_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.players p
        WHERE p.id IN (m.player_1_id, m.player_2_id) AND p.is_test_account = true
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

COMMENT ON FUNCTION public.get_item_usage_for_pokemon_phase_storage(text, public.aggregate_scope, uuid, uuid, integer) IS
  'Item usage in phase storage: completed native rosters for a league; all-time also includes completed standalone tournaments, excluding test play. service_role only.';

REVOKE ALL ON FUNCTION public.get_item_usage_for_pokemon_phase_storage(text, public.aggregate_scope, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_item_usage_for_pokemon_phase_storage(text, public.aggregate_scope, uuid, uuid, integer)
  TO service_role;

COMMIT;
