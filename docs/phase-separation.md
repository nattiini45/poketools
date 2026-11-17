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

## League recycle bin

The same-league enrollment-source FK is deferred `NO ACTION`: deleting the complete phase graph may remove its source and dependent phases together, but a committed dangling source is still rejected.

The foundation extends the complete inventory, restore order, external pointers, capture predicates, deadline shifts, derived-job restoration and expiry match IDs for both storage families. Legacy snapshot rows remain readable without conversion at this stage. A phase game restored with statistics gets a pending phase aggregate job and an uncounted marker; the phase, league and all-time projections are rebuilt by the phase worker once that worker ships.

The inventory contains 86 owned tables, eight derived tables and the same two kept logs. Phase-owned cast sessions are captured; independent sessions are outside pointers. The restore defers independent teams' phase match/fork pointers until phase teams exist, then re-links outside rows. Expiry includes both match stores when returning IDs for the existing social-image sweep.

Old captured snapshots are not converted by an expand migration. Their schema-aware conversion, inverse transfer and protection-junction parity belong to the separately invoked cutover package. A live migration must preserve phase and child UUIDs, ruleset pins, deadlines, credentials and capability keys, and prove parity before deleting the legacy copy.

## Dormant lifecycle persistence

The lifecycle layer adds `phase_lifecycle` and `phase_format_materialisation` migrations after the foundation. They implement native enrollment, groups, rounds, bracket writes, participant substitution, phase ordering and format attachment without enabling the generation fence. `Phase`, `PhaseRound` and phase group types describe native rows; no native persistence adapter constructs a tournament mechanics row.

The existing handlers explicitly retain legacy persistence. Default requests neither read the generation singleton nor call a new native RPC, so this application layer remains deployable before its two migrations are applied. Native persistence requires those migrations and operator-enabled phase mode; applying SQL alone does not select it. Production application and activation remain separate approvals.

The native phase and round machines share pure transition definitions with their legacy counterparts but have separate registry entries and writer paths. Enrollment uses the source timestamp as a compare-and-set and retains frozen-state and existing-round refusal guards; bracket generation freezes enrollment atomically. Native round and bracket RPCs lock the league and phase before writing children; competing status changes cannot leave a partial bracket. Creating an empty round alone leaves phase status and its round counter unchanged, while the pairing writer starts the phase. The first round refuses an incomplete league-group mirror. Participant swaps preserve seed and starting bracket and move the group slot through the native enrollment foreign key's update cascade.

Format materialisation, kit context, advancement, group formation, classic creation and substitution expose explicit persistence ports. Native status reactions use native context and pure event/check planners, with a required revision/idempotency-aware event writer and invalidation callback. Native paths that need match results, standings, aggregate counts, repair or notifications require explicit callbacks from their owning later layers; they never silently load legacy results. These dormant adapters are not authorization to enable native traffic before those consumers ship.

## Delivery and verification

The database lifecycle suite explicitly opts into native fixture rows; route and admin-agent fixtures retain legacy storage until their native consumers and aggregate worker ship. Known generated columns are recomputed, not reported as removed-column schema drift.

The PostgREST recycle-bin fixture populates both ownership families and checks native clocks, fingerprints and aggregate jobs without relaxing its every-owned-table assertion. After the dormant-state SQL rehearsal, database CI enables phase mode only on its disposable local stack for this fixture. A manual run of that fixture likewise requires operator-enabled phase mode on a disposable stack; never change a shared or hosted stack for a test.

The sequence is additive schema/security/trash, lifecycle/pairing persistence, match pipelines/projections, ancillary services/contracts, canonical routes/cache/redirects, then an explicitly approved maintenance transfer. The private companion ships its matching adapter changes before cutover. Retirement is separate work and is not part of the initial transfer.

Before enabling phase writes, prove global replay binding across both games stores, capability-token uniqueness, state/CAS races, phase and combined aggregate idempotency, cache invalidation and bounded queries. Existing phase URLs will receive 308 redirects under their league only when the canonical surfaces are ready. The foundation changes no public URLs or UI.

The database CI job replays migrations and runs the synthetic phase foundation rehearsal on its own ephemeral stack. Agents must not apply these files to a hosted project or use a shared development stack for a reset. Production preflight, migration application and cutover each require PawCommit Studio's separate approval after rehearsal. No merge authorizes them.

`src/lib/league-phase/__tests__/lifecycle.local.test.ts` exercises native enrollment and status contention, first-round uniqueness, group-mirror refusal, substitution and atomic bracket/status contention through PostgREST. It belongs only to the loopback-guarded `db` project and requires phase mode on a disposable stack, as does the native trash fixture. Unit port tests prohibit legacy persistence on native paths; they do not substitute for the database rehearsal.
