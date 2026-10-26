#!/usr/bin/env bash
# Runs the whole league-trash SQL lab against the LOCAL Supabase stack (container supabase_db_poketools).
#   bash scripts/league-trash-lab/run-all.sh
# Needs `npx supabase start` and a database replayed with `npx supabase db reset --local`. Never point it at a hosted project.
set -euo pipefail
cd "$(dirname "$0")"
PSQL=(docker exec -i supabase_db_poketools psql -U postgres -d postgres -v ON_ERROR_STOP=0)
run() { echo; echo "######## $1"; "${PSQL[@]}" "${@:2}" < "$1"; }
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 < seed.sql > /dev/null
"${PSQL[@]}" -q -v ON_ERROR_STOP=1 < fingerprint.sql > /dev/null
SID=$("${PSQL[@]}" -At -c "select lt_lab.seed(24, 8)" | tail -1)
run 01_cycle.sql -v sid="$SID"
SID=$("${PSQL[@]}" -At -c "select lt_lab.seed(24, 8)" | tail -1)
run 02_clocks_and_pointers.sql -v sid="$SID"
run 03_edge_cases.sql
run 04_schema_drift.sql
run 06_service_role.sql
echo
echo "Timings (05_timing.sql): bash run-all.sh --timing"
if [[ "${1:-}" == "--timing" ]]; then
  for size in "24 8" "32 12" "48 30" "96 40"; do
    set -- $size
    echo "######## 05_timing.sql players=$1 rounds=$2"
    "${PSQL[@]}" -v players="$1" -v rounds="$2" < 05_timing.sql | grep -E "matches|^ +[0-9]+ \||Time:|>>>|ERROR"
  done
fi
