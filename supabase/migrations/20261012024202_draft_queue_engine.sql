-- Draft queue engine schema (EvoLiga draft tool, Prompts 3–5; draft-backend §4.2, package B-SCHEMA, migration M2).
-- Extends draft_pools with the persisted state-machine config and adds the queue tables:
--   draft_participants      frozen seat order + per-player counters (budget, penalty stage, extensions)
--   draft_slots             the queue: one row per pick opportunity, ordered by a numeric sort_key
--   draft_line_restrictions player+line pick restrictions (own redraft drops, admin)
--   draft_line_favorites    per-player favourite lines (draft finder)
--   draft_action_log        append-only draft audit trail (update/delete blocked)
-- draft_picks gains slot/void/actor columns; uniqueness moves to "live" (non-void) picks.
-- Existing pools keep engine = 'legacy'; phase is backfilled from status and kept in step by a status trigger.
-- Service-role only: RLS enabled, no policies, grants to service_role only (AGENTS.md "Never Do").
-- The plpgsql RPCs that drive these tables are M5–M7 (package B-RPC).
--
-- Placeholder version: renamed to the live-recorded version at apply time (APPLY package). Sorts after
-- 20261010120100_draft_line_ids.sql (M1). Not applied by B-SCHEMA.
BEGIN;

-- Pre-checks: abort with a clear message instead of a unique-index failure.
DO $$ BEGIN
  IF EXISTS (SELECT season_id FROM public.draft_pools GROUP BY season_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'M2: a season has more than one draft pool; resolve before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_picks GROUP BY draft_pool_id, pick_number HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'M2: duplicate (draft_pool_id, pick_number) rows exist; resolve before applying';
  END IF;
END $$;

-- 1. draft_pools: frozen config, phase, clock and claim columns.
ALTER TABLE public.draft_pools
  ADD COLUMN engine text NOT NULL DEFAULT 'legacy' CHECK (engine IN ('legacy', 'queue')),
  ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'redraft')),
  ADD COLUMN mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'slow')),
  ADD COLUMN phase text NOT NULL DEFAULT 'setup' CHECK (phase IN ('setup', 'submissions', 'drafting', 'complete', 'cancelled')),
  ADD COLUMN list_version_id uuid REFERENCES public.point_buy_list_versions(id),
  ADD COLUMN parent_pool_id uuid REFERENCES public.draft_pools(id),
  ADD COLUMN roster_size smallint CHECK (roster_size BETWEEN 1 AND 20),
  ADD COLUMN pick_seconds integer CHECK (pick_seconds BETWEEN 30 AND 172800),
  ADD COLUMN makeup_seconds integer CHECK (makeup_seconds BETWEEN 30 AND 172800),
  ADD COLUMN slow_ladder_seconds integer[] NOT NULL DEFAULT '{43200,21600,10800,5400}',
  ADD COLUMN extension_seconds integer[] NOT NULL DEFAULT '{120,60}',
  ADD COLUMN extensions_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN redraft_max_lines smallint CHECK (redraft_max_lines BETWEEN 0 AND 20),   -- same name in TS/DTO/zod (CRIT B6)
  ADD COLUMN redraft_lock_no_redraft_lines boolean NOT NULL DEFAULT true,
  ADD COLUMN submission_deadline_at timestamptz,
  ADD COLUMN submissions_published_at timestamptz,
  ADD COLUMN token_purchase_closes_at timestamptz,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN paused_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN pause_reason text CHECK (pause_reason IN ('admin', 'blocked_slot')),
  ADD COLUMN state_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN publish_notified_at timestamptz,                         -- redraft reveal Discord claim (§6.7)
  ADD COLUMN started_at timestamptz,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD CONSTRAINT draft_pools_ladder_len CHECK (array_length(slow_ladder_seconds, 1) BETWEEN 1 AND 6),
  ADD CONSTRAINT draft_pools_extension_len CHECK (array_length(extension_seconds, 1) = 2);
UPDATE public.draft_pools SET phase = CASE status WHEN 'pending' THEN 'setup' WHEN 'in_progress' THEN 'drafting' ELSE 'complete' END;
-- Legacy pools keep their phase in step with status after the one-time backfill: the legacy engine (drafts.ts)
-- writes status only, and the redraft (M5 draft_create_pool) and the Draft Kill Token window (M7) read phase.
CREATE OR REPLACE FUNCTION public.draft_pools_sync_legacy_phase() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.engine = 'legacy' AND NEW.phase IS NOT DISTINCT FROM OLD.phase THEN   -- an explicit phase write wins
    NEW.phase := CASE NEW.status WHEN 'pending' THEN 'setup' WHEN 'in_progress' THEN 'drafting' ELSE 'complete' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_draft_pools_sync_legacy_phase BEFORE UPDATE OF status ON public.draft_pools
  FOR EACH ROW EXECUTE FUNCTION public.draft_pools_sync_legacy_phase();
REVOKE ALL ON FUNCTION public.draft_pools_sync_legacy_phase() FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX uq_draft_pools_season_initial ON public.draft_pools (season_id) WHERE kind = 'initial';
CREATE UNIQUE INDEX uq_draft_pools_season_redraft ON public.draft_pools (season_id) WHERE kind = 'redraft' AND phase <> 'cancelled';
CREATE INDEX idx_draft_pools_tickable ON public.draft_pools (phase) WHERE engine = 'queue';
COMMENT ON COLUMN public.draft_pools.engine IS 'legacy = client-ordered picks (pre-queue pools); queue = persisted queue engine (draft_slots + RPCs).';
COMMENT ON COLUMN public.draft_pools.phase IS 'Queue-engine phase: setup | submissions (redraft secret drop) | drafting | complete | cancelled.';
COMMENT ON COLUMN public.draft_pools.state_version IS 'Bumped by every shared-state mutation; clients short-circuit snapshot polls on it.';
COMMENT ON COLUMN public.draft_pools.token_purchase_closes_at IS 'Draft Kill Token purchase cutoff; NULL = closes at the first completed season match.';

-- 2. Participants: frozen seat order and per-player counters.
CREATE TABLE public.draft_participants (
  draft_pool_id uuid NOT NULL REFERENCES public.draft_pools(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat >= 1),
  standing_rank smallint,                    -- redraft: frozen first-half rank (1 = best)
  slots_total smallint NOT NULL DEFAULT 0 CHECK (slots_total >= 0),
  budget_start integer NOT NULL DEFAULT 0,
  penalty_stage smallint NOT NULL DEFAULT 0 CHECK (penalty_stage >= 0),
  timeout_count smallint NOT NULL DEFAULT 0,
  ext_plus120_used_at timestamptz,
  ext_plus60_used_at timestamptz,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_pool_id, player_id),
  CONSTRAINT draft_participants_seat_unique UNIQUE (draft_pool_id, seat) DEFERRABLE INITIALLY IMMEDIATE
);

-- 3. Slots: the persisted queue.
CREATE TABLE public.draft_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_pool_id uuid NOT NULL REFERENCES public.draft_pools(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  sort_key numeric NOT NULL,
  round smallint NOT NULL CHECK (round >= 1),
  nominal_pick_number integer NOT NULL CHECK (nominal_pick_number >= 1),
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'makeup')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done', 'timed_out', 'blocked', 'forfeited')),
  origin_slot_id uuid REFERENCES public.draft_slots(id),
  previous_slot_id uuid REFERENCES public.draft_slots(id),
  timeouts smallint NOT NULL DEFAULT 0,
  timer_seconds integer,
  started_at timestamptz,
  deadline_at timestamptz,
  remaining_ms_at_pause integer,
  extension_seconds integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  notified_turn_at timestamptz,
  reminder_mask smallint NOT NULL DEFAULT 0,       -- bit0 = 8h, bit1 = 4h, bit2 = 1h (sent or not applicable)
  alert_notified_at timestamptz,                   -- blocked / in-place-timeout admin alert claim
  alert_kind text CHECK (alert_kind IN ('blocked', 'inplace_timeout')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_pool_id, sort_key)
);
CREATE UNIQUE INDEX uq_draft_slots_one_current ON public.draft_slots (draft_pool_id) WHERE status IN ('active', 'blocked');
CREATE INDEX idx_draft_slots_pool_status_key ON public.draft_slots (draft_pool_id, status, sort_key);
CREATE INDEX idx_draft_slots_active_deadline ON public.draft_slots (deadline_at) WHERE status = 'active';

-- 4. Picks: slot binding, idempotency key, actor, void columns; uniqueness over live (non-void) picks.
ALTER TABLE public.draft_picks
  ADD COLUMN slot_id uuid REFERENCES public.draft_slots(id),
  ADD COLUMN redraft_slot_id uuid,                                    -- FK in M3
  ADD COLUMN client_request_id uuid,
  ADD COLUMN made_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN made_by_role text CHECK (made_by_role IN ('player', 'admin', 'system')),
  ADD COLUMN override_reason text CHECK (char_length(override_reason) <= 500),
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN void_reason text CHECK (char_length(void_reason) <= 500);
CREATE UNIQUE INDEX uq_draft_picks_slot_live ON public.draft_picks (slot_id) WHERE voided_at IS NULL AND slot_id IS NOT NULL;
CREATE UNIQUE INDEX uq_draft_picks_pool_line_live ON public.draft_picks (draft_pool_id, line_id) WHERE voided_at IS NULL AND line_id IS NOT NULL;
CREATE UNIQUE INDEX uq_draft_picks_request ON public.draft_picks (draft_pool_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX uq_draft_picks_pool_number_live ON public.draft_picks (draft_pool_id, pick_number) WHERE voided_at IS NULL;

-- 5. Restrictions, favourites.
CREATE TABLE public.draft_line_restrictions (
  draft_pool_id uuid NOT NULL REFERENCES public.draft_pools(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  line_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('own_redraft_drop', 'admin')),
  created_by uuid REFERENCES public.players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_pool_id, player_id, line_id)
);

CREATE TABLE public.draft_line_favorites (
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  line_id text NOT NULL CHECK (line_id ~ '^[a-z0-9]+--[a-z0-9]+$' AND char_length(line_id) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, line_id)
);

-- 6. Append-only draft audit trail. No FKs so pool/season deletes never fight the mutation trigger.
--    The action list is DraftAuditAction in src/types/draft-queue.ts (contract test parses this CHECK).
CREATE TABLE public.draft_action_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  season_id uuid NOT NULL,
  draft_pool_id uuid,
  actor_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('player', 'admin', 'system')),
  action text NOT NULL CHECK (action IN (
    'draft_configured', 'seats_changed', 'draft_started', 'draft_ended', 'draft_cancelled',
    'pick_confirmed', 'pick_admin_override', 'pick_voided', 'pick_corrected',
    'slot_blocked', 'slot_assigned', 'slot_forfeited', 'paused', 'resumed', 'timeout', 'extension_used',
    'penalty_changed', 'submission_changed', 'submissions_frozen', 'submissions_published', 'drop_restored',
    'token_purchased', 'comeback_spent', 'comeback_spend_opened')),
  player_id uuid, slot_id uuid, pick_id uuid, line_id text, client_request_id uuid,
  before jsonb, after jsonb,
  reason text CHECK (char_length(reason) <= 500),
  is_public boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_draft_action_log_pool ON public.draft_action_log (draft_pool_id, id DESC);
CREATE INDEX idx_draft_action_log_season ON public.draft_action_log (season_id, id DESC);
CREATE TRIGGER draft_action_log_prevent_update BEFORE UPDATE ON public.draft_action_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();        -- baseline:604
CREATE TRIGGER draft_action_log_prevent_delete BEFORE DELETE ON public.draft_action_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- 7. RLS on (no policies) and service-role-only grants.
ALTER TABLE public.draft_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_line_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_line_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_action_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.draft_participants, public.draft_slots,
  public.draft_line_restrictions, public.draft_line_favorites TO service_role;
GRANT SELECT, INSERT ON TABLE public.draft_action_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.draft_action_log_id_seq TO service_role;
COMMENT ON TABLE public.draft_participants IS 'Service-role only. Frozen seat order and per-player draft counters; no RLS policies by design.';
COMMENT ON TABLE public.draft_slots IS 'Service-role only. Persisted draft queue (one row per pick opportunity); no RLS policies by design.';
COMMENT ON TABLE public.draft_line_restrictions IS 'Service-role only. Player+line pick restrictions (own redraft drops); no RLS policies by design.';
COMMENT ON TABLE public.draft_line_favorites IS 'Service-role only. Per-player favourite draft lines; no RLS policies by design.';
COMMENT ON TABLE public.draft_action_log IS 'Service-role only. Append-only draft audit trail (update/delete blocked); no RLS policies by design.';
COMMIT;
