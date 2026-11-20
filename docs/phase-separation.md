# Phase-owned storage

ADR 0005 requires league phases and their children to live separately from standalone tournaments. The additive foundation creates the target graph without moving data or switching application readers. Existing leagues remain on the legacy tournament-shaped store until a separately approved maintenance transfer.

## Storage boundary

`league_phases` owns its enrollment, groups, rounds, bracket state, matches, games, battle statistics, reports, match artifacts, teams, cast sessions, admins, notifications/integrations and notes. Its ruleset pin still names an immutable ruleset version. Shared pure engines may serve both domains; a phase never needs a tournament mechanics row after cutover.

Phase usage projections and jobs have dedicated tables. League and all-time projections still combine the two domains. The foundation does not start the phase aggregate worker, change ratings or re-credit games.

Ownership FKs ensure a match's round is in its phase, a mirrored group is in its league, and an aggregate job's game, match, phase and league agree. `league_phases.enrollment_source_phase_id` is generated from the stored enrollment JSON and enforces a same-league source without rewriting that JSON. `phase_groups.season_id`, `phase_group_members.phase_id` and `phase_aggregate_jobs.match_id` supply the composite ownership keys; copy manifests must populate them. Generated columns are omitted from restore INSERT lists.

Every new table enables RLS and explicitly grants only the required service-role privileges. Public and authenticated API roles receive nothing. New nullable external pointers retain independent library teams, agent suggestions and cast sessions without keeping phase matches in tournament storage. The legacy format challenge keys remain in place until the maintenance migration; their new nullable phase counterparts are dormant.

While both generations exist, a challenge's nullable native phase pointer must equal its legacy phase UUID: UUID preservation makes that equality deliberate, not a link between unrelated competitions. The cutover package replaces the legacy challenge FKs and removes this compatibility constraint before removing legacy phase parents.

## Dormant storage and operator state

`phase_storage_state` is a singleton whose mode is defined by the registered `phase_storage` machine. It starts in `legacy`. Service role can read, but cannot update the state or execute `phase_storage_transition`; that compare-and-set function is operator-only.

The fence reads its mode through the zero-argument owner-rights `phase_storage_mode` accessor. Its fixed, qualified SELECT takes a shared row lock without granting service role UPDATE privilege on the state table; the accessor accepts no rows or SQL and cannot change the generation.

Phase-table row writes and non-null phase pointers are fenced while mode is not `phase`. The row-level trigger deliberately does not reject an empty legacy cascade. The schema owner may prepare fixtures and transfer rows in a maintenance transaction; this is not a browser or service-role bypass. The exemption requires the session itself to have logged in as the owner (`current_user` and `session_user` both `postgres`, `20261120120000_phase_storage_fence_session.sql`): PostgreSQL runs `ON DELETE CASCADE` and `SET NULL` actions as the referencing table's owner, so a service-role `DELETE` on `players` would otherwise change phase rows that a rollback from phase to legacy left behind. `scripts/phase-separation/phase-fence-cascade-rehearsal.sql` rehearses that rollback-then-cascade case in CI.

The four modes are `legacy`, `frozen_legacy`, `frozen_phase` and `phase`. Frozen modes record the maintenance boundary. **The foundation is not the full-site write freeze:** the cutover package must fence legacy writers, queues and scheduled callers before any live transfer and must not enable phase mode before the new application and integrations are ready. No operator should invoke these transitions merely because the foundation migration has been applied.

The legacy half of the freeze is `20261120110000_phase_legacy_write_freeze.sql`. It puts a statement-level trigger, `trg_phase_storage_legacy_freeze`, on the 31 legacy tables that the P6 transfer reads or rewrites: the tournament family, the match children, the aggregate rows, teams, cast sessions, the polymorphic admin, webhook, social and wiki rows, and the outside pointer tables. In either frozen mode it refuses every statement with `phase_storage_not_ready`, whether or not the statement would touch a row, unless the session itself logged in as the schema owner (`current_user` and `session_user` both `postgres`). Checking `session_user` matters because PostgreSQL runs `ON DELETE CASCADE` and `SET NULL` actions as the referencing table's owner: a service-role `DELETE` on `players` would otherwise reach `teams`, `resource_admins` or `cast_sessions` through its foreign keys. With the check, deleting a player is frozen too. The trigger reads the mode through `phase_storage_mode()`, which holds the mode row `FOR SHARE`. A writer that got in before the freeze therefore makes `phase_storage_transition('legacy', 'frozen_legacy')` wait until it commits, and `lock_timeout` bounds that wait. In `legacy` and `phase` mode the trigger lets writes through, so standalone tournaments keep working. It is a backstop: ingress, workers and scheduled callers are still stopped and drained first. The frozen pass of `npm run test:db` checks the refusal on every one of the 31 tables (`legacy-write-freeze.local.test.ts`).

## Route readiness

The route layer reads the operator-owned singleton only when the server is configured with `READ_PHASE_STORAGE_STATE=true`. Unset or false keeps the pre-schema legacy path free of database mode reads. Set true only after the phase schema is installed; the flag does not change the database mode. Once enabled, failed or invalid mode reads propagate instead of silently selecting legacy storage. The mode is not cached across requests.

A canonical league phase lookup requires both a league UUID and a phase UUID. It reads the league's tournament row in legacy mode or the native phase row in phase mode, never falling back to the other store. Frozen modes expose neither result through this lookup. The operator still controls the maintenance freeze, transfer, and reopening. Permanent redirects must wait for phase-ready mode and an actual resolved owner.

The public phase detail, match, and stats pages live under `/leagues/[id]/phases/[phaseId]`. The default legacy generation serves them through a scoped adapter that keeps existing actions on their legacy endpoints. In native mode the proxy resolves old phase, match, stats and admin-rounds links before the old tournament existence check. It returns a 308 with repeated query keys intact only for a verified phase owner. Canonical children outside their league return a real 404; an unavailable storage generation returns 503, not an alias to the other store.

This route layer is deployable without the new SQL when `READ_PHASE_STORAGE_STATE` remains unset or false. Do not enable native storage from this slice alone: the native match and admin pages do not yet expose legacy-only writes. A later integration must complete the native controls and remaining consumers before the cutover package can reopen traffic.

`GET /api/seasons/[id]/phases/[phaseId]/matches/head-to-head` takes two distinct player UUIDs (`player_1_id` and `player_2_id`). After resolving the owning league and phase, it reads completed matches for that pair in either seat order. The response contains the match and phase IDs and the match and game winners, without replay data or administrative fields. The native cache shares one entry across seat orders and expires it on phase writes. This endpoint does not request supplementary historical records.

## League recycle bin

The same-league enrollment-source FK is deferred `NO ACTION`: deleting the complete phase graph may remove its source and dependent phases together, but a committed dangling source is still rejected.

The foundation extends the complete inventory, restore order, external pointers, capture predicates, deadline shifts, derived-job restoration and expiry match IDs for both storage families. Legacy snapshot rows remain readable without conversion at this stage. A phase game restored with statistics gets a pending phase aggregate job and an uncounted marker; the phase, league and all-time projections are rebuilt by the phase worker once that worker ships.

The inventory contains 86 owned tables, eight derived tables and the same two kept logs. Phase-owned cast sessions are captured; independent sessions are outside pointers. The restore defers independent teams' phase match/fork pointers until phase teams exist, then re-links outside rows. Expiry includes both match stores when returning IDs for the existing social-image sweep.

Old captured snapshots are not converted by an expand migration. Their schema-aware conversion, inverse transfer and protection-junction parity belong to the separately invoked cutover package. A live migration must preserve phase and child UUIDs, ruleset pins, deadlines, credentials and capability keys, and prove parity before deleting the legacy copy.

## Dormant lifecycle persistence

The lifecycle layer adds `phase_lifecycle` and `phase_format_materialisation` migrations after the foundation. They implement native enrollment, groups, rounds, bracket writes, participant substitution, phase ordering and format attachment without enabling the generation fence. `Phase`, `PhaseRound` and phase group types describe native rows; no native persistence adapter constructs a tournament mechanics row.

The existing handlers explicitly retain legacy persistence. Default requests neither read the generation singleton nor call a new native RPC, so this application layer remains deployable before its two migrations are applied. Native persistence requires those migrations and operator-enabled phase mode; applying SQL alone does not select it. Production application and activation remain separate approvals.

The native phase and round machines share pure transition definitions with their legacy counterparts but have separate registry entries and writer paths. Enrollment uses the source timestamp as a compare-and-set and retains frozen-state and existing-round refusal guards; bracket generation freezes enrollment atomically. Native round and bracket RPCs lock the league and phase before writing children; competing status changes cannot leave a partial bracket. Creating an empty round alone leaves phase status and its round counter unchanged, while the pairing writer starts the phase. The first round refuses an incomplete league-group mirror. Participant swaps preserve seed and starting bracket and move the group slot through the native enrollment foreign key's update cascade.

A native roster re-sync preserves the group slots of retained participants, even when their enrollment seeds change. Before the first round, removing an enrollee removes only that player's group slots. Once a phase has rounds, neither a manual removal nor a forced re-sync may remove a grouped player from its roster (`PHASE_GROUP_ROSTER_SCHEDULED`). Use substitution to preserve the slot and its results. This check and the roster writes take the same phase lock as round and group writers.

The native phase admin page uses the league's roster as its enrollment picker and only imports standings when an admin asks. Its participant commands address the owning league and phase. The default participant read stays public; the explicit `?view=admin` read uses the live league-admin guard and adds only `is_guest`. Archived phases don't accept roster or group edits through these admin routes. Group draws, clears and moves remain unavailable when the league owns the groups. Repairing a group row whose recorded owner has left the phase is not offered in phase mode; the route refuses instead of opening the retired copy.

**Intentional cutover difference.** Native phases with rounds reject manual group redraws, clears and member moves (`PHASE_GROUPS_ROUNDS_EXIST`) so current group membership cannot reinterpret existing fixtures. Once an elimination phase has rounds, it rejects manual adds/removes and forced enrollment with a different participant set (`PHASE_ELIMINATION_ROSTER_LOCKED` for the elimination guard); a forced re-import of the same players can still update their seeds. Both refusals run under the lock shared with round generation. Legacy controls and substitution remain unchanged. The P6 rehearsal should expect these native refusals, not a roster or fixture diff.

Historical group repair is a pre-transfer operation. The native `phase_group_members_participant_fkey` requires every group slot holder to be enrolled; a legacy group row still held by a departed player cannot be copied. P6 must report such rows and stop before transfer. Use the legacy dry-run and reviewed repair in the owning league where the replacement is known. Do not discard a row, create a placeholder enrollment, or guess a replacement to make the copy succeed.

The native admin match schedule uses the same admin action and live correction-target authorization as a standalone match. It reads only an exact count of that native match's unexpired pending proposals. A failed count is shown as unknown, not zero; completed matches display the time without querying proposals.

**Intentional native scheduling guarantee.** Existing player and admin URLs use the native match under verified ownership. Native proposal acceptance saves the time and cancels pending alternatives in one transaction. Native admin changes use the same locks and win over a racing accept; legacy still uses separate writes. P6 should expect the stronger native guarantee without changes to preserved matches, proposals or historical times.

Manual native phase creation uses one season-scoped transaction for the name check, append position or explicit insertion, and any position shifts. The RPC locks the phase rows before validating their status and refuses to shift a started phase. Reordering takes the same locks and rejects a stale phase list or a changed pinned prefix. The insert response includes the shifted IDs for cache expiry. Enrollment and resource-admin assignment still run after creation, and a failed enrollment cannot prevent cache expiry for the committed phases.

The initial native elimination bracket takes the phase lock before making any writes. A changed settings timestamp, roster seed, starting side, or expected format revision refuses the plan; nothing is materialized from those stale inputs. The guarded write delegates to the same atomic round/match/freeze transaction once the inputs match.

The native league admin phase page saves settings and description through the owned phase PATCH. Archive and restore change only the archived flag; settings and lifecycle edits compare the stored status and archive flag before writing. Hand-managed phase completion and reopening use the phase machine; format-owned structure and status remain under their existing format guards. The ruleset card submits a phase pin, not a tournament pin, and archive and completion lock its update.

Native automatic round generation reads Swiss or round-robin history from the phase. The write checks the phase, roster, rounds, match facts, group layouts and format revision under the season and phase locks. The first group mirror, round, pairings, byes and any calendar deadline commit together. Existing elimination brackets use the bracket engine instead; batch round generation is separate.

The scoped round DELETE requires `confirm: true` and deletes only a latest round with no completed or active results and no linked records. It rechecks the round timestamp, fixtures and dependencies under lock, and rewinds the current round in the same transaction. Played-round takeback, kit-managed deletion and release of linked teams are not supported by this handler.

Format materialisation, kit context, advancement, group formation, classic creation and substitution expose explicit persistence ports. Native status reactions use native context and pure event/check planners, with a required revision/idempotency-aware event writer and invalidation callback. Native paths that need match results, standings, aggregate counts, repair or notifications require explicit callbacks from their owning later layers; they never silently load legacy results. These dormant adapters are not authorization to enable native traffic before those consumers ship.

## Delivery and verification

The database lifecycle suite explicitly opts into native fixture rows; route and admin-agent fixtures retain legacy storage until their native consumers and aggregate worker ship. Known generated columns are recomputed, not reported as removed-column schema drift.

The PostgREST recycle-bin fixture populates both ownership families and checks native clocks, fingerprints and aggregate jobs without relaxing its every-owned-table assertion. After the dormant-state SQL rehearsal, database CI enables phase mode only on its disposable local stack for this fixture. A manual run of that fixture likewise requires operator-enabled phase mode on a disposable stack; never change a shared or hosted stack for a test.

The sequence is additive schema/security/trash, lifecycle/pairing persistence, match pipelines/projections, ancillary services/contracts, canonical routes/cache/redirects, then an explicitly approved maintenance transfer. The private companion ships its matching adapter changes before cutover. Retirement is separate work and is not part of the initial transfer.

Before enabling phase writes, prove global replay binding across both games stores, capability-token uniqueness, state/CAS races, phase and combined aggregate idempotency, cache invalidation and bounded queries. Existing phase URLs will receive 308 redirects under their league only when the canonical surfaces are ready. The foundation changes no public URLs or UI.

The database CI job replays migrations and runs the synthetic phase foundation rehearsal on its own ephemeral stack. Agents must not apply these files to a hosted project or use a shared development stack for a reset. Production preflight, migration application and cutover each require PawCommit Studio's separate approval after rehearsal. No merge authorizes them.

`src/lib/league-phase/__tests__/lifecycle.local.test.ts` exercises native enrollment and status contention, first-round uniqueness, group-mirror refusal, substitution and atomic bracket/status contention through PostgREST. It belongs only to the loopback-guarded `db` project and requires phase mode on a disposable stack, as does the native trash fixture. Unit port tests prohibit legacy persistence on native paths; they do not substitute for the database rehearsal.

`native-format.local.test.ts` uses the same disposable phase-mode gate to exercise native format creation, attachment, replacement, detachment, preset pins and cleanup. Its runtime-clear confirmation, started-round refusal and failed-materialisation rollback checks run through the real RPCs, not the mocked unit adapters.

## P6 preflight

`scripts/phase-separation/p6-preflight.sql` is the sanitized measurement that precedes the maintenance transfer. It is a single read-only psql script: the whole file runs in one `BEGIN READ ONLY` transaction, so a write — or a function that writes — aborts it instead of changing anything. It creates no temp table, selects nothing `INTO`, and calls no writer. `\timing on` prints a cost line per statement, so the window is chosen from a measurement rather than an estimate.

Only the deployment's owner runs it, on the hosted project, with an operator connection:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/phase-separation/p6-preflight.sql
```

It reports counts, booleans and ids only — never a player name, e-mail, avatar, credential, replay hash or share token — in blocks emitted cheapest-first, with the plan's section number as the label. The inherently linear anti-join runs last, alone, and its output is bounded to 200 phase ids after a total row computed in the same pass:

It runs on **two schema states**, because the P6 order is preflight, then migrations, then transfer: the pre-bundle schema (production's head before the phase bundle) and the full bundle. One capability probe at the top decides which blocks may speak about the native generation. On the pre-bundle schema every legacy half still runs — block 1 counts the legacy family through the inventory that exists there, block 2 reads the snapshots, blocks 4 and 5 report their scope as unknown targets, block 9 keeps its anti-join, block 11 reports `moved_id_scope = legacy_only` — while each native block prints an explicit `skipped: needs <migration file>` row instead of failing the run. `ON_ERROR_STOP=1` therefore exits 0 on both states, with the holes named.

1. **Ownership families** — for every `public.league_trash__inventory()` relation that is `owned` or `derived`, the rows a league owns (phase ids derived from `tournaments.season_id IS NOT NULL`, closed through the inventory predicates, native `phase_*` rows counted through `{native_phases}`) against the whole-table count, plus the relation footprint and the share of it the owned rows estimate; then the split by generation and the grand total.
2. **Trash generation** — one row per snapshot format (`phase_only`, `phase_and_legacy`, `legacy_only`) and `purge_after` bucket, with the captured tables, rows and stored payload bytes, the conversion scope for snapshots that actually hold a phase-owned family, and the per-relation payload. A capture of an empty native table does not make a snapshot native.
3. **Applied migration versions** — the complete `supabase_migrations.schema_migrations` ledger, plus an explicit applied flag for the five phase migrations the plan names.
4. **Outside references** — every foreign key into the moved graph (phase targets and the legacy phase family) whose own table the inventory does not classify, with its delete action and deferrability. These are the references the transfer must retarget or refuse.
5. **Triggers on moved tables** — every trigger that fires on INSERT or DELETE there and is not the known `phase_storage__guard`, so an unknown one cannot inject side effects during the copy.
6. **Null and cross-owner anomalies** — one count per check: a league stage that lost its season, children claiming a league under a standalone tournament, a league match whose round belongs to another tournament, statistics naming a player the phase never enrolled, a moment whose game is in another match, a group/member/aggregate job that disagrees with its phase, a league pointer that no longer resolves, and a phase id that collides with an independent tournament. A standalone tournament that holds children is counted separately and marked informational: that is what a standalone event is, and reporting it as an anomaly made every real one look like a broken league phase. The "lost its season" check counts only markers a standalone write path cannot set. An enrollment source is the one that names the case: only the standings sync writes it, and it refuses unless the phase's season matches the league being synced. A format stage key is kept as a redundant second marker — `tournaments_format_stage_season_check` already makes that combination impossible, so it can only fire on a database that lost the constraint. A stage order is deliberately not one of them: `POST /api/tournaments` and `PATCH /api/tournaments/[id]` both accept it for a row with no season.
7. **Queues and leases** — aggregate jobs by status in both stores for phase-owned games, the pending/processing/failed work a freeze would strand, open game edit leases, and live cast sessions.
8. **Replay and share-key collisions** — duplicate `replay_hash` values inside the phase union, duplicate cast realtime keys and duplicate team share tokens across both stores. Counts only.
9. **Historical group repair prerequisite** — group slots whose player is not in the owning phase's roster, grouped by phase id, with a total row. A non-zero total stops the transfer before it starts (see "Historical group repair" above).
10. **Storage state** — the current `phase_storage_state.mode`, native rows per phase relation, and whether any phase row exists while the mode is not yet `phase`.
11. **JSON-embedded moved ids** — every `jsonb` column of an inventory `owned`/`derived` relation (plus the two phase parents) scanned for UUID text that resolves to a phase, match, round or game id the transfer moves, one timed statement per column. A relation whose planner estimate exceeds 2,000,000 rows is printed as `skipped_oversize` with that estimate instead of scanned, so an omission is visible. This is the half of the graph the column predicates cannot close: an id that exists only inside a stage spec, an enrollment source or a stored analysis payload.

Agents and CI never run it against the hosted project: it reads ordinary tables, and the quota rule in `AGENTS.md` covers a report just as it covers a capture loop.

## P6 transfer

`supabase/migrations/20261120100000_phase_transfer.sql` holds the maintenance transfer. Applying it moves no data: it creates the ledger (`phase_transfer_ledger`), the lineage table (`phase_transfer_lineage`) and the operator procedures. Only the schema owner can run them, on an operator connection. No API role can execute them, and the new tables are readable only by `service_role`.

**Ladder.** Each step is its own transaction, and every procedure refuses with `PHASE_TRANSFER_WRONG_MODE` outside its step:

| Step | Statement | Mode after |
| --- | --- | --- |
| Freeze | `SELECT phase_storage_transition('legacy', 'frozen_legacy');` then drain traffic, workers and leases | `frozen_legacy` |
| Transfer | `SELECT phase_transfer_forward('<operation uuid>');` | `frozen_phase` |
| Activate | `SELECT phase_transfer_activate();` (lineage gate) | `phase` |
| Rollback freeze | `SELECT phase_storage_transition('phase', 'frozen_phase');` then drain again | `frozen_phase` |
| Inverse | `SELECT phase_transfer_inverse('<operation uuid>');` | `frozen_legacy` |
| Reopen legacy | `SELECT phase_storage_transition('frozen_legacy', 'legacy');` | `legacy` |

A failed transfer rolls back completely and writes no ledger row, so the operator can rerun it with the same operation id. Once an operation id has completed, rerunning it returns the stored report with `noop: true` and copies nothing.

**What the forward does, in order:**

1. It takes the transfer advisory lock, every league advisory lock in UUID order, the season rows, and then every source and target table in `EXCLUSIVE` mode, with `lock_timeout = 5s`. The inverse takes the same locks in the same order.
2. It refuses before any write when:
   - the phase store is not empty;
   - a group slot is held by a player outside its phase roster (`PHASE_TRANSFER_GROUP_ORPHANS`);
   - a trash snapshot holds a legacy phase family (`PHASE_TRANSFER_TRASH_CONVERSION_REQUIRED`);
   - an aggregate job or team crosses owners;
   - the trash inventory assertion fails;
   - a format challenge names a phase that does not move.
3. It copies the manifest families in dependency order and keeps every id. It records a row count and an md5 fingerprint for each family.
4. It records lineage for every moved phase, round, match and game.
5. It retargets every outside pointer before any delete: agent suggestions, match-only cast sessions, streaks, outside teams' match and fork pointers, and format challenges.
6. It deletes the legacy rows, matches before teams, so the referential action clears `teams.match_id` before `trg_teams_completed_match_lock` sees the team.
7. It asserts:
   - every copy still matches its source fingerprint, and no source row is left;
   - no pointer was nulled, both per row and in the per-column counts;
   - players, seasons, rosters, the audit log, league and all-time projections, streak counters, other games' jobs and standalone tournaments are unchanged;
   - there are zero duplicate replay hashes, share tokens or realtime keys across both stores;
   - the trash inventory still holds.

The inverse moves the current native rows back, including rows written after reopening. It restores each tournament with its `season_id` before its groups and its groups before its rounds, re-points outside pointers to the legacy columns, and makes the same assertions.

**Decisions this procedure makes:**

- `format_challenges.phase_id` names the phase in whichever store owns it. The native model's own reference is `league_phase_id`, which has a foreign key to `league_phases` with `ON DELETE CASCADE` and mirrors `phase_id` (`format_challenges_phase_pointer_3_check`). The forward recreates `format_challenges_phase_id_fkey` against `league_phases(id)` with the same `ON DELETE CASCADE`, and the inverse points it back at `tournaments(id)`. The constraint therefore always exists while the site is running. A challenge whose phase does not move (for example one on a standalone tournament) stops the transfer with `PHASE_TRANSFER_CHALLENGE_UNMOVABLE` before any write.
- `aggregate_jobs.season_id` is nullable in legacy storage and required in native storage. A null value takes the phase's season.
- Retargeting an outside team's pointer is an `UPDATE`, so `trg_teams_updated` stamps that team's `updated_at`. This is accepted: it is the only column the round trip changes, and the rehearsal's whole-row comparison leaves it out for `teams`.
- Lineage has no foreign key and is never deleted, so audited activity of either generation keeps an owner proof.
- Trash snapshots that hold a moved family are refused, not converted. The production preflight found none.

**Rehearsal.** `scripts/phase-separation/p6-transfer-rehearsal.sql` runs inside one transaction and ends in `ROLLBACK`. The CI `database` job runs it. It seeds five leagues (15 phases, 150 matches, 180 games, 2,160 battle-stat rows) plus a standalone tournament with children, then checks the expected refusals and runs this sequence:

1. forward, then rerun with the same id (no-op), then activate;
2. inverse, then a whole-row comparison of 36 tables against the pre-forward state;
3. re-forward, then native writes after reopening;
4. inverse, which carries those rows and their lineage back;
5. a final re-forward.

`-v leagues=N` scales the seed. Local timings, server-side inside the transaction:

| Seed | Rows moved | Forward | Inverse |
| --- | --- | --- | --- |
| 5 leagues | 3,843 | 0.25–0.32 s | 0.25 s |
| 50 leagues | 38,426 | 2.4–2.6 s | 2.0–2.1 s |
