-- Evolution Point Buy: retire consented trades (trades are abolished).
--
-- Lines now change hands only through the secret-drop redraft (redraft pool, redraft_* RPCs).
-- POST /api/seasons/[id]/redraft answers 410 REDRAFT_TRADE_RETIRED, and the trade-request routes,
-- consent UI and query module are deleted. This migration retires the database side:
--
--   1. Pending trade requests are cancelled: nothing can execute them any more.
--   2. epb_execute_trade_request (latest body 20261012025134_epb_token_rpcs.sql) is dropped.
--   3. epb_execute_redraft (20260728000000_epb_remediation.sql), the older batch swap RPC for
--      free swaps and trades, has had no caller since the consent flow replaced it; it is
--      dropped too, so no RPC can write a new 'trade' or 'free_swap' redraft_history row.
--   4. redraft_trade_requests stays as a read-only archive: the player-deletion guard
--      (src/lib/supabase/queries/players.ts) and the applied progress backfill
--      (20261012024254_epb_progress_sources.sql) read it. No API role may write to it.
--
-- Kept on purpose (history, not a trade path):
--   * redraft_history.transfer_type CHECK ('trade', 'free_swap', 'secret_drop') and
--     redraft_history.trade_partner_id: historical rows stay valid.
--   * The per-season advisory lock (hashtext(season_id)) shared by the redraft phase toggle and
--     the draft RPCs (20261012024916_draft_rpcs.sql). Only the comments that named the trade RPC
--     change; no RPC body had a trade branch to remove (the void-pick guard for a line that moved
--     to another player still protects trackers moved by trades executed before this migration).
--
-- Grants: this migration creates no function and grants nothing to anon or authenticated.
-- RLS on redraft_trade_requests stays enabled with no policies (service_role only).

-- 1. Cancel every pending request. cancelled_by stays NULL: the system retired it, not a player.
UPDATE public.redraft_trade_requests
   SET status = 'cancelled',
       cancelled_at = now()
 WHERE status = 'pending';

-- 2. + 3. Drop the trade and legacy swap RPCs.
DROP FUNCTION public.epb_execute_trade_request(uuid, jsonb);
DROP FUNCTION public.epb_execute_redraft(uuid, jsonb);

-- 4. Read-only archive.
ALTER TABLE public.redraft_trade_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.redraft_trade_requests FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE public.redraft_trade_requests FROM service_role;
-- service_role keeps SELECT (deletion guard) and DELETE (season clean-up; ON DELETE CASCADE from
-- seasons runs as the table owner either way).

COMMENT ON TABLE public.redraft_trade_requests IS
  'Read-only archive of the retired EPB consented trades (retired 2026-10-18). No row can be pending; no API role may insert or update. Service-role only; no anon/browser RLS policies by design.';

COMMENT ON FUNCTION public.epb_set_redraft_phase_open(uuid, boolean) IS
  'Atomically toggle format_rules.redraft_phase_open under the per-season advisory lock (hashtext(season_id)) shared with the draft RPCs. Consented trades, which also took this lock, are retired (20261018140300_epb_retire_trades.sql).';
