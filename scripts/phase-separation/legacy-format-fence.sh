#!/usr/bin/env bash
set -euo pipefail

db="${1:?Pass the disposable PostgreSQL container name}"
if [[ "$db" == supabase_db_poketools && "${GITHUB_ACTIONS:-}" != true ]]; then
  printf '%s\n' 'Refusing a shared Supabase stack; use an isolated disposable database.' >&2
  exit 1
fi
fixture=41928000-0000-4000-8000-000000000001
marker=419280
tmp=$(mktemp -d)
writer=
freezer=
gate=
trap 'for pid in "$writer" "$freezer" "$gate"; do if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; fi; done; rm -f "$tmp/writer" "$tmp/freeze" "$tmp/gate"; rmdir "$tmp"' EXIT

sql() {
  local app=$1
  shift
  docker exec -i -e "PGAPPNAME=$app" "$db" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

wait_for() {
  local query=$1 i
  for ((i=0; i<100; i++)); do
    if [[ $(sql fence_observer -Atc "$query") == t ]]; then return 0; fi
    sleep 0.1
  done
  cat "$tmp/writer" "$tmp/freeze" "$tmp/gate" >&2 || true
  return 1
}

sql fence_seed -v "fixture=$fixture" <<'SQL'
SELECT mode = 'legacy' AS legacy FROM public.phase_storage_state WHERE id \gset
\if :legacy
INSERT INTO public.seasons (id, name, format_type) VALUES (:'fixture', 'Synthetic legacy format fence', 'custom');
\else
\quit 3
\endif
SQL
sql fence_gate -v "marker=$marker" >"$tmp/gate" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(:marker);
DO $$
BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN EXISTS (
      SELECT FROM pg_stat_activity f JOIN pg_stat_activity w ON w.pid = ANY(pg_blocking_pids(f.pid))
      WHERE f.application_name = 'fence_freezer' AND w.application_name = 'fence_writer'
    );
    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
COMMIT;
SQL
gate=$!
wait_for "SELECT EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name = 'fence_gate' AND l.locktype = 'advisory' AND l.objid = $marker AND l.granted)"

sql fence_writer -v "fixture=$fixture" -v "marker=$marker" >"$tmp/writer" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL ROLE service_role;
SELECT public.format_attach_season(:'fixture', NULL, 1, '{}', repeat('a', 64), 'synthetic-seed', '[]');
SELECT pg_advisory_xact_lock(:marker);
COMMIT;
SQL
writer=$!
wait_for "SELECT EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name = 'fence_writer' AND l.locktype = 'advisory' AND l.objid = $marker AND NOT l.granted)"

sql fence_freezer -c "SET statement_timeout = '60s'; SELECT public.phase_storage_transition('legacy', 'frozen_legacy');" >"$tmp/freeze" 2>&1 &
freezer=$!
wait "$gate" || { cat "$tmp/gate" "$tmp/freeze" >&2; exit 1; }; gate=
wait "$writer"; writer=
wait "$freezer"; freezer=

sql fence_verify -v "fixture=$fixture" <<'SQL'
SELECT set_config('fixture.legacy_format_league', :'fixture', false);
SET ROLE service_role;
DO $$
DECLARE league uuid := current_setting('fixture.legacy_format_league')::uuid;
BEGIN
  IF public.phase_storage_mode() <> 'frozen_legacy' OR NOT EXISTS (
    SELECT FROM public.season_formats WHERE season_id = league AND spec_hash = repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'freeze did not follow the committed legacy attach';
  END IF;
  BEGIN
    PERFORM public.format_attach_season(league, NULL, 1, '{}', repeat('b', 64), 'synthetic-seed', '[]');
    RAISE EXCEPTION 'stale legacy attach was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'phase_storage_not_ready' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.format_detach_season(league);
    RAISE EXCEPTION 'stale legacy detach was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'phase_storage_not_ready' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.competition_create_from_format(NULL, '{}', '{}', '[]', '[]', false);
    RAISE EXCEPTION 'stale legacy creation was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'phase_storage_not_ready' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT FROM public.season_formats WHERE season_id = league AND spec_hash = repeat('a', 64)) THEN
    RAISE EXCEPTION 'stale legacy request changed the attachment';
  END IF;
END $$;
RESET ROLE;
DELETE FROM public.season_formats WHERE season_id = :'fixture';
DELETE FROM public.seasons WHERE id = :'fixture';
SQL
printf '%s\n' 'Freeze waited for the committing legacy attach; all three stale RPCs refused without writing.'
