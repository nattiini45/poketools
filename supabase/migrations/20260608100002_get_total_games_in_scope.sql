CREATE OR REPLACE FUNCTION public.get_total_games_in_scope(
  p_scope_type public.aggregate_scope,
  p_scope_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.games g
  JOIN public.matches m ON m.id = g.match_id
  WHERE m.status <> 'scheduled'
    AND (
      p_scope_type = 'all_time'
      OR (p_scope_type = 'tournament' AND m.tournament_id = p_scope_id)
      OR (
        p_scope_type = 'league'
        AND m.tournament_id IN (
          SELECT t.id FROM public.tournaments t WHERE t.season_id = p_scope_id
        )
      )
    );
$$;
