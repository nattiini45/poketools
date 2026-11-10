-- The guard triggers of the Admin Assistant's three status columns enforce the whole from -> to matrix of their machines
-- (src/lib/ai/admin-agent/store/{proposal,action,plan}-state.ts; docs/state-machines.md). Until now
-- admin_agent_proposals__guard refused only a move back to proposed, admin_agent_actions__guard only a move back to
-- executing and an undone from anything but ok, and admin_agent_plans__guard did not look at the status at all. The store
-- guards every write with the machine's source states, but a raw UPDATE (a maintainer's psql, a future writer that skips
-- the store, a dashboard edit) could move a row out of a terminal state, e.g. a failed ledger row to ok or a declined card to
-- executing.
--
-- Each trigger keeps its existing rules (the retention purge bypasses it; the approval lock; the revision never goes down;
-- no regress to proposed / executing; undone stays undone) and then allows a status change only when (OLD.status,
-- NEW.status) is one of the machine's transitions. A write that leaves the status as it is (an outcome column, a revision,
-- the ON DELETE SET NULL of an admin, the idempotent undone -> undone) is never refused. A refused move raises
-- ADMIN_AGENT_STATUS_REGRESS (P0001, DETAIL with the row id, from and to), which the store already maps to
-- AdminAgentStoreDbError; the store's own guards refuse the same moves first (state_transition_invalid, plan_stale,
-- proposal_not_pending), so no legitimate flow reaches it.
--
-- The trigger functions keep their signatures (CREATE OR REPLACE keeps the triggers and the ACL); the grants are restated
-- as in 20261027100000_admin_agent_tables.sql: service_role only.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_agent_proposals__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'proposed' AND OLD.status <> 'proposed' THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('proposal_id', OLD.id, 'from', OLD.status)::text;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (VALUES
       ('proposed', 'executing'), ('proposed', 'declined'), ('proposed', 'superseded'), ('proposed', 'expired'),
       ('executing', 'completed'), ('executing', 'partial'), ('executing', 'failed'), ('executing', 'stale'),
       ('executing', 'unknown')) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('proposal_id', OLD.id, 'from', OLD.status, 'to', NEW.status)::text;
  END IF;
  IF (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     OR (OLD.approved_by IS NOT NULL AND NEW.approved_by IS NOT NULL AND NEW.approved_by <> OLD.approved_by) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_APPROVAL_LOCKED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('proposal_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_actions__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF (NEW.status = 'executing' AND OLD.status <> 'executing') OR (NEW.status = 'undone' AND OLD.status <> 'ok' AND OLD.status <> 'undone') THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('action_id', OLD.id, 'from', OLD.status, 'to', NEW.status)::text;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (VALUES
       ('executing', 'ok'), ('unknown', 'ok'), ('executing', 'failed'), ('unknown', 'failed'), ('executing', 'unknown'),
       ('executing', 'skipped'), ('ok', 'undone')) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('action_id', OLD.id, 'from', OLD.status, 'to', NEW.status)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.admin_agent_plans__guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF public.admin_agent__purging() THEN
    RETURN NEW;
  END IF;
  IF NEW.revision < OLD.revision THEN
    RAISE EXCEPTION 'ADMIN_AGENT_COUNTER_DECREASE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('plan_id', OLD.id)::text;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (VALUES
       ('drafting', 'ready'), ('ready', 'drafting'), ('drafting', 'building'), ('ready', 'building'), ('partial', 'building'),
       ('building', 'built'), ('building', 'partial'), ('building', 'drafting'), ('drafting', 'abandoned'),
       ('ready', 'abandoned'), ('partial', 'abandoned')) THEN
    RAISE EXCEPTION 'ADMIN_AGENT_STATUS_REGRESS' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('plan_id', OLD.id, 'from', OLD.status, 'to', NEW.status)::text;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.admin_agent_plans__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_proposals__guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_agent_actions__guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_agent_plans__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_proposals__guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_agent_actions__guard() TO service_role;

COMMIT;
