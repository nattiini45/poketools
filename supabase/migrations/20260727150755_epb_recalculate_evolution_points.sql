-- EPB: transactional evolution-point rebuild from development events.
-- Replaces the client wipe+loop in recalculateEvolutionPoints.

CREATE OR REPLACE FUNCTION public.epb_recalculate_evolution_points(
  p_season_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_points_awarded integer := 0;
  v_players_updated integer := 0;
BEGIN
  -- Zero counters first (same semantics as the previous client wipe).
  UPDATE public.evolution_tracker
  SET evolution_points_awarded = 0,
      updated_at = now()
  WHERE season_id = p_season_id;

  DELETE FROM public.evo_progress_log
  WHERE season_id = p_season_id
    AND note = 'evolution_point_awarded';

  -- One award per (player, matchday) with a non-devolution event.
  -- Carrier tracker = lexicographically first base_pokemon (matches
  -- awardEvolutionPointForMatchday sort).
  WITH awards AS (
    SELECT DISTINCT e.player_id, e.matchday
    FROM public.evolution_events e
    WHERE e.season_id = p_season_id
      AND e.matchday IS NOT NULL
      AND e.is_devolution = false
  ),
  carriers AS (
    SELECT DISTINCT ON (t.player_id)
      t.player_id,
      t.id AS tracker_id
    FROM public.evolution_tracker t
    WHERE t.season_id = p_season_id
    ORDER BY t.player_id, t.base_pokemon ASC
  ),
  applied AS (
    INSERT INTO public.evo_progress_log
      (tracker_id, season_id, matchday, source, amount, note)
    SELECT
      c.tracker_id,
      p_season_id,
      a.matchday,
      'admin_correction',
      1,
      'evolution_point_awarded'
    FROM awards a
    INNER JOIN carriers c ON c.player_id = a.player_id
    RETURNING tracker_id, matchday
  ),
  bumped AS (
    UPDATE public.evolution_tracker t
    SET evolution_points_awarded = t.evolution_points_awarded + sub.cnt,
        updated_at = now()
    FROM (
      SELECT tracker_id, COUNT(*)::integer AS cnt
      FROM applied
      GROUP BY tracker_id
    ) sub
    WHERE t.id = sub.tracker_id
    RETURNING t.player_id
  )
  SELECT
    COALESCE((SELECT COUNT(*)::integer FROM applied), 0),
    COALESCE((SELECT COUNT(DISTINCT player_id)::integer FROM bumped), 0)
  INTO v_points_awarded, v_players_updated;

  RETURN jsonb_build_object(
    'players_updated', v_players_updated,
    'points_awarded', v_points_awarded
  );
END;
$$;

COMMENT ON FUNCTION public.epb_recalculate_evolution_points(uuid) IS
  'Service-role only. Atomically rebuilds evolution_points_awarded from evolution_events.';
