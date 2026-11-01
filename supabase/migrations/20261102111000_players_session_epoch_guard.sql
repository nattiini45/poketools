-- players.sessions_valid_after: database-side guard for the session epoch.
--
-- 20261102110000 added the epoch; the application moves it forward on a password reset, a ban or suspension, a
-- guest claim and "sign out everywhere". Two properties are enforced here, in the same statement that makes the
-- change, instead of by the callers:
--
--   1. Monotonic. A write never lowers the epoch. The application stamps it with its own clock, so a sanction
--      written by an instance whose clock runs behind would otherwise move it back and revive the tokens that an
--      earlier revocation ended (a reinstatement would then accept them again).
--
--   2. A guest claim revokes in the claim's own transaction. claim_guest_player (20261018160000) flips is_guest from
--      true to false while it moves the source account's identity onto the guest row. A token minted for that source
--      identity must not carry on as the claimed player, and a revocation written by the caller afterwards could
--      fail and leave the claim committed with the old tokens valid. The trigger moves the epoch to the database
--      clock in the same UPDATE, so the claim and the revocation commit or roll back together. Tokens carry the
--      application clock, so the claim route also writes an application-clock cutoff on the guest row BEFORE the
--      claim and aborts when that write fails; the epoch only moves forward and ends at the later of the two.
--
-- The function is trigger-only: EXECUTE is revoked from every API role. anon and authenticated hold no privilege on
-- `players` (20261008081443), and nothing here adds one. RLS stays enabled.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.players_session_epoch_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.is_guest AND NOT NEW.is_guest THEN
    NEW.sessions_valid_after := GREATEST(OLD.sessions_valid_after, NEW.sessions_valid_after, clock_timestamp());
  ELSE
    NEW.sessions_valid_after := GREATEST(OLD.sessions_valid_after, NEW.sessions_valid_after);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.players_session_epoch_guard() IS
  'BEFORE UPDATE trigger function of public.players: keeps sessions_valid_after monotonic and moves it to now when a guest row becomes a registered player (guest claim). Trigger-only.';

REVOKE ALL ON FUNCTION public.players_session_epoch_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS players_session_epoch_guard ON public.players;
CREATE TRIGGER players_session_epoch_guard
  BEFORE UPDATE ON public.players
  FOR EACH ROW
  WHEN (
    OLD.sessions_valid_after IS DISTINCT FROM NEW.sessions_valid_after
    OR (OLD.is_guest AND NOT NEW.is_guest)
  )
  EXECUTE FUNCTION public.players_session_epoch_guard();

COMMIT;
