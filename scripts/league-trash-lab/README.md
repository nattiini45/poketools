# League trash SQL lab

A manual lab for the league recycle bin (`supabase/migrations/20261026091000_league_trash.sql` and the five files after
it). It runs against the **local** Supabase stack only (container `supabase_db_poketools`, `npx supabase start`, then
`npx supabase db reset --local`). Never point it at a hosted project.

The opt-in vitest file `src/lib/league-trash/__tests__/league-trash.local.test.ts` covers everything that works through
PostgREST. This lab covers what it cannot: **DDL** (schema drift while a league sits in the trash, a probe table that
the inventory guard must reject) and the **superuser-only** facts (the read-only archive `redraft_trade_requests`,
fingerprints computed inside the database). No dependency is added for it: plain `psql` through `docker exec`.

```bash
bash scripts/league-trash-lab/run-all.sh            # every script below, 01 to 04 and 06
bash scripts/league-trash-lab/run-all.sh --timing   # plus 05 for four league sizes
```

| File | What it proves |
|---|---|
| `seed.sql` | `lt_lab.seed(players, rounds, name)` builds one evolution-point-buy league that touches all 50 owned tables, four draft pools (one drafting, one in submissions), a circular redraft slot and pick, groups, teams on completed matches, streak pointers, polymorphic rows and outside rows that point in. |
| `fingerprint.sql` | `lt_lab.fp(season)` (row count and md5 per owned table, minus the columns that legitimately change) and `lt_lab.others(season)` (row counts of everything else). |
| `01_cycle.sql` | Delete leaves no row by any inventory key and touches nothing else; restore is row-identical. |
| `02_clocks_and_pointers.sql` | After a simulated 30 days in the trash every running deadline moved by exactly the shift (an overdue one too), the draft is paused with a frozen slot, outside rows are re-linked, games come back unmarked with one pending increment job each. |
| `03_edge_cases.sql` | Junction blocks (player, ruleset, list version), season id taken again, a NOT NULL parent that vanished anyway (`LEAGUE_TRASH_PARENT_MISSING`), a nullable parent (warning), `LEAGUE_TRASH_PLAN_MISMATCH` (unknown captured table, wrong row count), the rebuild marker versus expiry, the inventory guard (unclassified cascade child and unclassified parent), bad retention, missing league. |
| `04_schema_drift.sql` | A column dropped since the delete (`columns_ignored` warning), a new NOT NULL column with a default (applied), without a default (`LEAGUE_TRASH_SCHEMA_DRIFT`, nothing restored), a captured table dropped (`LEAGUE_TRASH_PLAN_MISMATCH`). |
| `05_timing.sql` | Delete and restore time for a league of the given size (`-v players=32 -v rounds=12`). |
| `06_service_role.sql` | The whole cycle as `service_role`, the role PostgREST uses: the archive rows come back through the owner-rights helper and the helper refuses any other table. |

A restore needs the rebuild after the delete confirmed (`league_trash_rebuild_done`, else `LEAGUE_TRASH_REBUILD_PENDING`), so the scripts call it between delete and restore; `03_edge_cases.sql` also proves the refusal.

Each script prints what it expects. A block that must fail prints the error and the script goes on.

Timings (local, PostgreSQL 17, vacuumed, one statement each; PostgREST allows 8 s per call):

| League | matches | battle_stats | delete | restore |
|---|---|---|---|---|
| small (24 x 8) | 360 | 6.3k | 0.32 s | 0.37 s |
| realistic large (32 x 12) | 684 | 12k | 0.46 s | 0.50 s |
| big (48 x 30) | 2,394 | 42k | 1.2 s | 1.6 s |
| huge (96 x 40) | 6,600 | 118k | 3.3 s | 4.4 s |

Without `VACUUM ANALYZE` after a bulk load the huge league needs several times longer (stale statistics, dead tuples);
production tables are autovacuumed, but a restore right after another bulk operation can be slower.

The lab leaves its `lt_lab` schema and `ltp_*` players behind; `npx supabase db reset --local` clears everything.
