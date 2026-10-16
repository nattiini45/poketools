-- Redraft secret drop schema (EvoLiga draft tool, Prompt 5; draft-backend §4.3, package B-SCHEMA, migration M3).
--   redraft_submissions  SECRET drop submissions until publish (read only through owner/admin-guarded routes)
--   redraft_slots        published replacement slots A, B, C… per player with the slot-bound real-kill transfer
-- Adds the deferred FKs from M1/M2 (draft_picks.redraft_slot_id, evolution_tracker.redraft_slot_id), extends
-- redraft_history for the secret drop and widens its transfer_type CHECK.
-- Service-role only: RLS enabled, no policies, grants to service_role only (AGENTS.md "Never Do").
--
-- Placeholder version: renamed to the live-recorded version at apply time (APPLY package). Not applied by B-SCHEMA.
BEGIN;

CREATE TABLE public.redraft_submissions (                      -- secret until publish; read only via owner/admin routes
  draft_pool_id uuid NOT NULL REFERENCES public.draft_pools(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  tracker_id uuid NOT NULL REFERENCES public.evolution_tracker(id) ON DELETE CASCADE,
  line_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_pool_id, tracker_id)
);
CREATE INDEX idx_redraft_submissions_player ON public.redraft_submissions (draft_pool_id, player_id);

CREATE TABLE public.redraft_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_pool_id uuid NOT NULL REFERENCES public.draft_pools(id) ON DELETE CASCADE,
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label ~ '^[A-Z]$'),
  dropped_line_id text NOT NULL,
  dropped_entry_id uuid REFERENCES public.point_buy_list_entries(id),
  dropped_price integer NOT NULL CHECK (dropped_price >= 0),
  transferred_real_kills smallint NOT NULL CHECK (transferred_real_kills >= 0),
  dropped_stage smallint NOT NULL,
  dropped_tracker_snapshot jsonb NOT NULL,               -- for redraft_admin_restore_drop
  filled_by_pick_id uuid REFERENCES public.draft_picks(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_pool_id, player_id, label)
);
CREATE UNIQUE INDEX uq_redraft_slots_fill ON public.redraft_slots (filled_by_pick_id) WHERE filled_by_pick_id IS NOT NULL;
CREATE INDEX idx_redraft_slots_season_player ON public.redraft_slots (season_id, player_id);
COMMENT ON COLUMN public.redraft_slots.transferred_real_kills IS 'Real kills (self_earned_kills) of the dropped line, frozen at publish; moved into the new tracker''s transferred_evo_progress.';

ALTER TABLE public.draft_picks ADD CONSTRAINT draft_picks_redraft_slot_fkey
  FOREIGN KEY (redraft_slot_id) REFERENCES public.redraft_slots(id);
ALTER TABLE public.evolution_tracker ADD CONSTRAINT evolution_tracker_redraft_slot_fkey
  FOREIGN KEY (redraft_slot_id) REFERENCES public.redraft_slots(id) ON DELETE SET NULL;

ALTER TABLE public.redraft_history
  ADD COLUMN draft_pool_id uuid REFERENCES public.draft_pools(id) ON DELETE SET NULL,
  ADD COLUMN dropped_line_id text,
  ADD COLUMN transferred_real_kills smallint,
  ADD COLUMN points_refunded smallint;
ALTER TABLE public.redraft_history DROP CONSTRAINT IF EXISTS redraft_history_transfer_type_check;   -- 20260727000000:114
ALTER TABLE public.redraft_history ADD CONSTRAINT redraft_history_transfer_type_check
  CHECK (transfer_type IN ('trade', 'free_swap', 'secret_drop'));

ALTER TABLE public.redraft_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redraft_slots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.redraft_submissions, public.redraft_slots TO service_role;
COMMENT ON TABLE public.redraft_submissions IS 'Service-role only. SECRET redraft drop submissions until publish; read only through owner/admin-guarded routes; no RLS policies by design.';
COMMENT ON TABLE public.redraft_slots IS 'Service-role only. Published redraft replacement slots with slot-bound real-kill transfer; no RLS policies by design.';
COMMIT;
