-- EPB progress sources and token ledgers (EvoLiga draft tool, Prompts 6–7; draft-backend §4.4, package B-SCHEMA, migration M4).
--   1. increment_tracker_progress learns 'transferred_evo_progress'; total_kos = sum of FIVE source columns (was four,
--      20260727010000:43-52).
--   2. epb_apply_progress maps the new log source 'transferred'; evo_progress_log.source CHECK widened.
--   3a. Legacy carry-over backfill: trackers created by the legacy free-swap redraft or a legacy trade stored the
--       carried progress in real_kills (pre-M7 payload). It moves to transferred_evo_progress; total_kos unchanged.
--   3b. Backfill of the total_kos invariant over EPB trackers only (line_id IS NOT NULL). Legacy evolution-tier
--       trackers (line_id NULL) write total_kos directly and keep it. On EPB rows it only repairs earlier drift:
--       3a keeps the five-column sum unchanged.
--   4. Ledgers: epb_draft_token_purchases (Draft Kill Tokens, one per request) and epb_comeback_token_spends
--      (Comeback Tokens; balance = earned from matches − spends); format_rules.comeback_spend_open admin switch.
-- Column names of the progress sources stay (BR-14); the spec names live in COMMENT ON COLUMN (M1) and in TS.
-- Service-role only: RLS enabled, no policies, grants to service_role only (AGENTS.md "Never Do").
--
-- Placeholder version: renamed to the live-recorded version at apply time (APPLY package). Not applied by B-SCHEMA.
BEGIN;

-- 1. Atomic increment learns the new source; total_kos = sum of five columns.
CREATE OR REPLACE FUNCTION public.increment_tracker_progress(p_tracker_id uuid, p_source text, p_amount integer)
RETURNS public.evolution_tracker LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_row public.evolution_tracker;
BEGIN
  IF p_source NOT IN ('real_kills', 'draft_tokens', 'kill_tokens', 'cosmo_points', 'transferred_evo_progress') THEN
    RAISE EXCEPTION 'Invalid progress source: %', p_source;
  END IF;
  UPDATE public.evolution_tracker SET
    real_kills   = CASE WHEN p_source = 'real_kills'   THEN GREATEST(0, real_kills + p_amount)   ELSE real_kills END,
    draft_tokens = CASE WHEN p_source = 'draft_tokens' THEN GREATEST(0, draft_tokens + p_amount) ELSE draft_tokens END,
    kill_tokens  = CASE WHEN p_source = 'kill_tokens'  THEN GREATEST(0, kill_tokens + p_amount)  ELSE kill_tokens END,
    cosmo_points = CASE WHEN p_source = 'cosmo_points' THEN GREATEST(0, cosmo_points + p_amount) ELSE cosmo_points END,
    transferred_evo_progress = CASE WHEN p_source = 'transferred_evo_progress'
                                    THEN GREATEST(0, transferred_evo_progress + p_amount) ELSE transferred_evo_progress END,
    updated_at = now()
  WHERE id = p_tracker_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tracker not found: %', p_tracker_id; END IF;
  UPDATE public.evolution_tracker
     SET total_kos = real_kills + draft_tokens + kill_tokens + cosmo_points + transferred_evo_progress
   WHERE id = p_tracker_id RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- 2. epb_apply_progress maps the new log source 'transferred' (20260728000000:125-160 otherwise unchanged).
CREATE OR REPLACE FUNCTION public.epb_apply_progress(p_tracker_id uuid, p_source text, p_amount integer,
  p_matchday integer DEFAULT NULL, p_note text DEFAULT NULL, p_created_by uuid DEFAULT NULL)
RETURNS public.evolution_tracker LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_column text; v_row public.evolution_tracker;
BEGIN
  v_column := CASE p_source WHEN 'real_kill' THEN 'real_kills' WHEN 'draft_token' THEN 'draft_tokens'
    WHEN 'kill_token' THEN 'kill_tokens' WHEN 'cosmo_point' THEN 'cosmo_points'
    WHEN 'transferred' THEN 'transferred_evo_progress' ELSE NULL END;
  IF v_column IS NULL THEN RAISE EXCEPTION 'Invalid progress source: %', p_source; END IF;
  v_row := public.increment_tracker_progress(p_tracker_id, v_column, p_amount);
  INSERT INTO public.evo_progress_log (tracker_id, season_id, matchday, source, amount, note, created_by)
  VALUES (p_tracker_id, v_row.season_id, p_matchday, p_source, p_amount, p_note, p_created_by);
  RETURN v_row;
END $$;

ALTER TABLE public.evo_progress_log DROP CONSTRAINT IF EXISTS evo_progress_log_source_check;      -- 20260727000000:74
ALTER TABLE public.evo_progress_log ADD CONSTRAINT evo_progress_log_source_check
  CHECK (source IN ('real_kill', 'draft_token', 'kill_token', 'cosmo_point', 'transferred', 'admin_correction'));

-- 3a. Legacy carry-over out of real_kills. A legacy redraft / trade tracker is one named by redraft_history (same
--     season, player, target base and locked stage 3; free_swap or trade) or by an executed trade request's
--     executed_tracker_ids. The legacy RPCs inserted it with real_kills = total_kos = the carried total and wrote no
--     evo_progress_log row for it, while every later match KO went through epb_apply_progress (logged 'real_kill').
--     So the carry is real_kills − Σ logged real_kill deltas of that tracker, capped at [0, real_kills]: the history
--     row stores only missing_kills_transferred, not the resulting total, and the source stage is gone with the
--     deleted source tracker. Idempotent: only EPB rows (line_id NOT NULL) with transferred_evo_progress = 0.
WITH legacy_redraft AS (
  SELECT t.id,
         LEAST(t.real_kills, GREATEST(0, t.real_kills - COALESCE(
           (SELECT sum(l.amount) FROM public.evo_progress_log l WHERE l.tracker_id = t.id AND l.source = 'real_kill'), 0)))
           AS carry
    FROM public.evolution_tracker t
   WHERE t.line_id IS NOT NULL AND t.transferred_evo_progress = 0 AND t.real_kills > 0
     AND (EXISTS (SELECT 1 FROM public.redraft_history h
                   WHERE h.season_id = t.season_id AND h.player_id = t.player_id
                     AND h.to_base_pokemon = t.base_pokemon
                     AND h.to_stage3_pokemon IS NOT DISTINCT FROM t.locked_stage3_pokemon
                     AND h.transfer_type IN ('free_swap', 'trade'))
       OR EXISTS (SELECT 1 FROM public.redraft_trade_requests r
                   WHERE r.season_id = t.season_id AND r.status = 'executed'
                     AND r.executed_tracker_ids @> jsonb_build_array(t.id::text)))
)
UPDATE public.evolution_tracker t
   SET real_kills = t.real_kills - c.carry,
       transferred_evo_progress = t.transferred_evo_progress + c.carry,
       updated_at = now()
  FROM legacy_redraft c
 WHERE t.id = c.id AND c.carry > 0;

-- 3b. Backfill the invariant for EPB rows only; legacy evolution-tier trackers (line_id NULL) keep their total_kos.
UPDATE public.evolution_tracker SET total_kos = real_kills + draft_tokens + kill_tokens + cosmo_points + transferred_evo_progress
 WHERE line_id IS NOT NULL
   AND total_kos <> real_kills + draft_tokens + kill_tokens + cosmo_points + transferred_evo_progress;

-- 4. Token ledgers.
CREATE TABLE public.epb_draft_token_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  line_id text NOT NULL,
  tracker_id uuid REFERENCES public.evolution_tracker(id) ON DELETE SET NULL,
  points_spent smallint NOT NULL CHECK (points_spent > 0),
  client_request_id uuid NOT NULL,
  created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, line_id),                 -- max 1 per line
  UNIQUE (season_id, player_id, client_request_id)
);
CREATE TABLE public.epb_comeback_token_spends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  line_id text NOT NULL,
  tracker_id uuid REFERENCES public.evolution_tracker(id) ON DELETE SET NULL,
  amount smallint NOT NULL CHECK (amount BETWEEN 1 AND 20),
  client_request_id uuid NOT NULL,
  created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, player_id, client_request_id, line_id)
);
CREATE INDEX idx_comeback_spends_player ON public.epb_comeback_token_spends (season_id, player_id);
ALTER TABLE public.format_rules ADD COLUMN comeback_spend_open boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.format_rules.comeback_spend_open IS 'Admin switch: Comeback Tokens may be spent although the season has no completed redraft (NQ 34).';
ALTER TABLE public.epb_draft_token_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.epb_comeback_token_spends ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE public.epb_draft_token_purchases, public.epb_comeback_token_spends TO service_role;
COMMENT ON TABLE public.epb_draft_token_purchases IS 'Service-role only. Draft Kill Token purchases (3 points each, max 2 per player, 1 per line); no RLS policies by design.';
COMMENT ON TABLE public.epb_comeback_token_spends IS 'Service-role only. Comeback Token spends (balance = earned from matches - spends); no RLS policies by design.';

REVOKE ALL ON FUNCTION public.increment_tracker_progress(uuid, text, integer),
  public.epb_apply_progress(uuid, text, integer, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_tracker_progress(uuid, text, integer),
  public.epb_apply_progress(uuid, text, integer, integer, text, uuid) TO service_role;
COMMIT;
