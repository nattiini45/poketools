-- Rehearses the phase storage fence against foreign-key cascades after a rollback from phase to legacy
-- (20261120120000_phase_storage_fence_session.sql). Run after scripts/league-trash-lab/seed.sql inside one transaction
-- that this file rolls back; the database starts in legacy mode:
--   { printf 'BEGIN;\n'; cat scripts/league-trash-lab/seed.sql scripts/phase-separation/phase-fence-cascade-rehearsal.sql; } |
--     docker exec -i supabase_db_poketools psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
-- An API request reaches the database as session_user authenticator with role service_role, and the operator as
-- session_user postgres. SET SESSION AUTHORIZATION reproduces both inside this transaction; only a superuser login
-- (supabase_admin on the local stack) may switch it, so the file connects as one and works as postgres.
\set QUIET on
SET SESSION AUTHORIZATION postgres;
SELECT gen_random_uuid() AS season, gen_random_uuid() AS phase, gen_random_uuid() AS player, gen_random_uuid() AS bystander \gset

SELECT 1 / CASE WHEN public.phase_storage_mode() = 'legacy' THEN 1 ELSE 0 END AS starts_in_legacy;
SELECT public.phase_storage_transition('legacy', 'frozen_legacy');
SELECT public.phase_storage_transition('frozen_legacy', 'frozen_phase');
SELECT public.phase_storage_transition('frozen_phase', 'phase');

INSERT INTO public.players (id, name, is_guest) VALUES (:'player', 'Fence fixture player', true), (:'bystander', 'Fence fixture bystander', true);
INSERT INTO public.seasons (id, name, format_type) VALUES (:'season', 'Fence fixture league', 'singles');
INSERT INTO public.league_phases (id, name, season_id, bracket_type, ruleset_id)
  VALUES (:'phase', 'Fence fixture phase', :'season', 'round_robin', lt_lab.make_ruleset(gen_random_uuid(), gen_random_uuid(), 'fence fixture ruleset'));
INSERT INTO public.phase_teams (player_id, phase_id) VALUES (:'player', :'phase');
INSERT INTO public.phase_participants (phase_id, player_id) VALUES (:'phase', :'player');

-- In phase mode an API session writes phase rows; written here so the rollback below has rows to leave behind.
SELECT public.phase_storage_transition('phase', 'frozen_phase');
SELECT public.phase_storage_transition('frozen_phase', 'frozen_legacy');
SELECT public.phase_storage_transition('frozen_legacy', 'legacy');

SET SESSION AUTHORIZATION authenticator;
SET ROLE service_role;
SELECT set_config('fixture.player', :'player', true), set_config('fixture.bystander', :'bystander', true) \gset
SELECT set_config('fixture.season', :'season', false) \gset
DO $$
BEGIN
  IF session_user <> 'authenticator' OR current_user <> 'service_role' THEN RAISE EXCEPTION 'not an API session'; END IF;
  BEGIN
    DELETE FROM public.players WHERE id = current_setting('fixture.player')::uuid;
    RAISE EXCEPTION 'a player delete cascaded into phase rows after the rollback to legacy';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'phase_storage_not_ready' THEN RAISE; END IF;
  END;
  DELETE FROM public.players WHERE id = current_setting('fixture.bystander')::uuid;
  IF FOUND IS NOT TRUE THEN RAISE EXCEPTION 'a player without phase rows could not be deleted in legacy mode'; END IF;
END $$;
RESET ROLE;
SET SESSION AUTHORIZATION postgres;

DO $$
BEGIN
  IF session_user <> 'postgres' THEN RAISE EXCEPTION 'session authorization was not reset'; END IF;
  IF (SELECT count(*) FROM public.phase_teams WHERE player_id = current_setting('fixture.player')::uuid) <> 1
     OR (SELECT count(*) FROM public.phase_participants WHERE player_id = current_setting('fixture.player')::uuid) <> 1
     OR NOT EXISTS (SELECT FROM public.league_phases WHERE season_id = current_setting('fixture.season')::uuid)
  THEN RAISE EXCEPTION 'refused cascades changed phase rows'; END IF;
END $$;

-- The operator connection stays exempt: it can clean the leftover phase rows up in legacy mode.
DELETE FROM public.players WHERE id = :'player';
SELECT 1 / CASE WHEN NOT EXISTS (SELECT FROM public.phase_teams WHERE player_id = :'player') THEN 1 ELSE 0 END AS owner_cascade_ran;

\echo 'phase fence: API cascades into phase rows refused after a rollback to legacy; owner session exempt'
ROLLBACK;
