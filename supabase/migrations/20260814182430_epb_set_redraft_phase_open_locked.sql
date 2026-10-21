-- Evolution Point Buy: serialize the redraft phase toggle with trade execution.
--
-- epb_execute_trade_request (migration 20260814182419) re-reads
-- format_rules.redraft_phase_open inside its transaction, under a per-season
-- advisory xact lock (pg_advisory_xact_lock(hashtext(season))). The previous
-- phase-toggle path was a plain `UPDATE format_rules` with NO lock, so a phase
-- close could commit concurrently with an in-flight trade execution — the two
-- were not guaranteed to order against each other.
--
-- This RPC toggles redraft_phase_open under the SAME per-season advisory lock
-- the execute RPC takes, so a phase close/open cannot commit while a trade
-- holds the lock, and vice versa. Phase-toggle and trade-execute are now
-- mutually exclusive, closing the race. The lock key is identical in both RPCs:
-- hashtext(season_id::text).
--
-- For EPB seasons a format_rules row always exists; if it is somehow missing
-- the RPC raises 'format_rules_not_found' (P0002) so the TS caller can fall
-- back to its upsert path (defensive; keeps the previous contract).

CREATE OR REPLACE FUNCTION public.epb_set_redraft_phase_open(
  p_season_id uuid,
  p_open boolean
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
BEGIN
  -- Same per-season advisory lock the execute RPC takes, so phase changes
  -- serialize with trade execution (and vice versa).
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  UPDATE public.format_rules
     SET redraft_phase_open = p_open
   WHERE season_id = p_season_id
   RETURNING to_jsonb(format_rules.*) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'format_rules_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.epb_set_redraft_phase_open(uuid, boolean) IS
  'Atomically toggle format_rules.redraft_phase_open under the per-season advisory lock shared with epb_execute_trade_request, so phase changes serialize with trade execution. Service-role only.';