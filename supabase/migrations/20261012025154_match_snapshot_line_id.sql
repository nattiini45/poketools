-- Branch-exact match evolution snapshots (EvoLiga draft tool, E3 reconciliation R-SQL, T07 handoff).
--
-- A branched base (Oshawott -> Samurott / Samurott-Hisui) has one tracker per LINE, and a player may own both lines of
-- one base. Snapshots were keyed by (match, player, base_pokemon), so the two lines collided and the evolution rebuild
-- resolved a stage-1/2 snapshot to whichever branch it met last. This migration:
--   1. adds match_evolution_snapshots.line_id (NULL for old rows and for legacy evolution-tier leagues);
--   2. backfills it from the tracker the snapshot points at (tracker_id, when the tracker still exists);
--   3. replaces UNIQUE (match_id, player_id, base_pokemon) with two partial unique indexes: one row per (match, player,
--      line) when line_id is set, the old key for the line-less legacy rows;
--   4. replaces epb_replace_match_snapshots (latest definition: 20260728120000_epb_kilo_review_fixes.sql) so the payload
--      carries line_id. Same signature, LANGUAGE, search_path and SECURITY INVOKER as before; EXECUTE stays service_role only.
-- RLS on the table is unchanged (enabled by 20261008081443_close_public_api_roles.sql); nothing is granted to API roles.
--
-- Placeholder version: renamed to the recorded version at apply time (APPLY package; after 20261010120700).
BEGIN;

ALTER TABLE public.match_evolution_snapshots ADD COLUMN IF NOT EXISTS line_id text;
COMMENT ON COLUMN public.match_evolution_snapshots.line_id IS
  'Draft line id of the tracker this snapshot was taken from (branch-exact). NULL for rows written before 20261010120800 whose tracker is gone, and for legacy evolution-tier leagues.';

UPDATE public.match_evolution_snapshots s SET line_id = t.line_id
  FROM public.evolution_tracker t
 WHERE s.line_id IS NULL AND s.tracker_id = t.id AND t.line_id IS NOT NULL;

ALTER TABLE public.match_evolution_snapshots
  DROP CONSTRAINT IF EXISTS match_evolution_snapshots_match_id_player_id_base_pokemon_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_evolution_snapshots_line
  ON public.match_evolution_snapshots (match_id, player_id, line_id) WHERE line_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_evolution_snapshots_legacy_base
  ON public.match_evolution_snapshots (match_id, player_id, base_pokemon) WHERE line_id IS NULL;

CREATE OR REPLACE FUNCTION public.epb_replace_match_snapshots(
  p_match_id uuid,
  p_snapshots jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'p_match_id is required';
  END IF;

  DELETE FROM public.match_evolution_snapshots
  WHERE match_id = p_match_id;

  IF p_snapshots IS NULL OR jsonb_typeof(p_snapshots) <> 'array' THEN
    RAISE EXCEPTION 'p_snapshots must be a JSON array';
  END IF;

  IF jsonb_array_length(p_snapshots) = 0 THEN
    RETURN;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_snapshots) LOOP
    INSERT INTO public.match_evolution_snapshots (
      match_id,
      player_id,
      tracker_id,
      base_pokemon,
      line_id,
      species_at_match,
      stage_at_match,
      progress_before,
      progress_after,
      real_kos,
      draft_tokens_delta,
      kill_tokens_delta,
      cosmo_points_delta,
      evolution_triggered,
      suspension_triggered,
      brought
    ) VALUES (
      p_match_id,
      (v_row->>'player_id')::uuid,
      NULLIF(v_row->>'tracker_id', '')::uuid,
      v_row->>'base_pokemon',
      NULLIF(v_row->>'line_id', ''),
      v_row->>'species_at_match',
      (v_row->>'stage_at_match')::smallint,
      COALESCE((v_row->>'progress_before')::integer, 0),
      COALESCE((v_row->>'progress_after')::integer, 0),
      COALESCE((v_row->>'real_kos')::smallint, 0),
      COALESCE((v_row->>'draft_tokens_delta')::smallint, 0),
      COALESCE((v_row->>'kill_tokens_delta')::smallint, 0),
      COALESCE((v_row->>'cosmo_points_delta')::smallint, 0),
      COALESCE((v_row->>'evolution_triggered')::boolean, false),
      COALESCE((v_row->>'suspension_triggered')::boolean, false),
      COALESCE((v_row->>'brought')::boolean, false)
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.epb_replace_match_snapshots(uuid, jsonb) IS
  'Atomically replace all match_evolution_snapshots for a match (single transaction). Rows carry line_id (branch-exact). Service-role only.';

-- CREATE OR REPLACE keeps the function's ACL, which 20261008081443 already closed to PUBLIC/anon/authenticated (no REVOKE
-- here: src/lib/supabase/__tests__/migration-api-grants.test.ts replays the folder without that close-out as a control).
GRANT EXECUTE ON FUNCTION public.epb_replace_match_snapshots(uuid, jsonb) TO service_role;

COMMIT;
