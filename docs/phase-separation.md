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

Phase-table row writes and non-null phase pointers are fenced while mode is not `phase`. The row-level trigger deliberately does not reject an empty legacy cascade. The schema owner may prepare fixtures and transfer rows in a maintenance transaction; this is not a browser or service-role bypass.

The four modes are `legacy`, `frozen_legacy`, `frozen_phase` and `phase`. Frozen modes record the maintenance boundary. **The foundation is not the full-site write freeze:** the cutover package must fence legacy writers, queues and scheduled callers before any live transfer and must not enable phase mode before the new application and integrations are ready. No operator should invoke these transitions merely because the foundation migration has been applied.

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

The native phase admin page uses the league's roster as its enrollment picker and only imports standings when an admin asks. Its participant commands address the owning league and phase. The default participant read stays public; the explicit `?view=admin` read uses the live league-admin guard and adds only `is_guest`. Archived phases don't accept roster or group edits through these admin routes. Group draws, clears and moves remain unavailable when the league owns the groups. Legacy historical group repair is not offered in phase mode; its route refuses instead of opening the retired copy.

**Intentional cutover difference.** Native phases with rounds reject manual group redraws, clears and member moves (`PHASE_GROUPS_ROUNDS_EXIST`) so current group membership cannot reinterpret existing fixtures. Once an elimination phase has rounds, it rejects manual adds/removes and forced enrollment with a different participant set (`PHASE_ELIMINATION_ROSTER_LOCKED` for the elimination guard); a forced re-import of the same players can still update their seeds. Both refusals run under the lock shared with round generation. Legacy controls and substitution remain unchanged. The P6 rehearsal should expect these native refusals, not a roster or fixture diff.

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
