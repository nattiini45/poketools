#!/usr/bin/env bash
# Rehearses the Ruleset Studio migrations on the LOCAL Supabase stack (container supabase_db_poketools) with the legacy
# fixtures of legacy-fixtures.sql, and writes three JSON exports for the vitest rehearsal test:
#   <out>/legacy.json     the legacy rulesets, phases and leagues BEFORE the migrations
#   <out>/after-b1.json   the converted definitions / versions, the replayed pins and the log, after the expand file
#   <out>/after-b2.json   the same pins after the contract file
# then replays the database to HEAD (`db reset --local`) so the stack ends pristine.
#   bash scripts/ruleset-lab/rehearse.sh [out-dir]
# Never point it at a hosted project. Run the test afterwards:
#   RULESET_REHEARSAL_DIR=<out-dir> npx vitest run src/lib/ruleset-studio/__tests__/ruleset-conversion.local.test.ts
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-$(mktemp -d)}"
mkdir -p "$OUT"
PSQL=(docker exec -i supabase_db_poketools psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
export2() { "${PSQL[@]}" -At -c "$1" > "$2"; }

npx supabase db reset --local --version 20261026091500 > /dev/null 2>&1
"${PSQL[@]}" < scripts/ruleset-lab/legacy-fixtures.sql

export2 "select json_build_object(
  'rulesets', (select json_agg(to_jsonb(r) order by r.created_at, r.id) from public.rulesets r),
  'tournaments', (select json_agg(json_build_object('id', t.id, 'season_id', t.season_id, 'bracket_type', t.bracket_type, 'ruleset_id', t.ruleset_id) order by t.id) from public.tournaments t),
  'seasons', (select json_agg(json_build_object('id', s.id, 'name', s.name, 'ruleset_id', s.ruleset_id) order by s.id) from public.seasons s)
)" "$OUT/legacy.json"

"${PSQL[@]}" < supabase/migrations/20261026100000_ruleset_definitions.sql
# The expand file converts and replays; the test compares the replay against the TypeScript oracle.
"${PSQL[@]}" < supabase/migrations/20261026100100_ruleset_conversion_and_pins.sql
export2 "select json_build_object(
  'definitions', (select json_agg(to_jsonb(d) order by d.slug) from public.ruleset_definitions d),
  'versions', (select json_agg(to_jsonb(v) order by v.id) from public.ruleset_definition_versions v),
  'tournaments', (select json_agg(json_build_object('id', t.id, 'ruleset_id', t.ruleset_id) order by t.id) from public.tournaments t),
  'seasons', (select json_agg(json_build_object('id', s.id, 'ruleset_id', s.ruleset_id) order by s.id) from public.seasons s),
  'log', (select coalesce(json_agg(json_build_object('kind', l.kind, 'target_id', l.target_id, 'old', l.old_ruleset_id, 'new', l.new_ruleset_id, 'step', l.step) order by l.kind, l.target_id), '[]'::json) from public.ruleset_pin_backfill_log l),
  'season_formats', (select json_agg(json_build_object('season_id', f.season_id, 'preset_rulesets', f.preset_rulesets)) from public.season_formats f)
)" "$OUT/after-b1.json"

"${PSQL[@]}" < supabase/migrations/20261026100200_ruleset_contract.sql
export2 "select json_build_object(
  'tournaments', (select json_agg(json_build_object('id', t.id, 'ruleset_id', t.ruleset_id) order by t.id) from public.tournaments t),
  'seasons', (select json_agg(json_build_object('id', s.id, 'ruleset_id', s.ruleset_id) order by s.id) from public.seasons s),
  'legacy_rows', (select count(*) from public.rulesets_legacy)
)" "$OUT/after-b2.json"

npx supabase db reset --local > /dev/null 2>&1
echo "$OUT"
