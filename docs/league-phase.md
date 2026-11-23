# League Phase

The league phase's own data model: every tournament-shaped entity (enrollment, groups, rounds, matches, games, stats, reports, teams, notes) stored under `league_phases` instead of the standalone-tournament tables. ADR 0005 requires it; [Phase-owned storage](./phase-separation.md) documents the boundary, the storage-generation state machine and the P6 cutover. This doc is the module's file map.

## File Structure

```
src/lib/league-phase/                   Phase-owned storage, services and page data (server-only)
├── route-mode.ts                       Phase-route mode gate: isPhaseRouteModeEnabled, requireOpenPhaseRouteMode
├── paths.ts                            phaseHref/phaseStatsHref/phaseMatchHref URL helpers
├── legacy-redirect.ts                  Legacy phase path parse + redirect to the native route
├── competition-route-owner.ts          Which store holds a competition id (tournament or league phase)
├── match-route-owner.ts                resolveIdOnlyMatchRoute: which store holds a match id
├── team-route-owner.ts                 resolveIdOnlyTeamRoute: which store holds a team id
├── season-start.ts                     readLeagueStarted
├── storage-state.ts                    phaseStorageMachine: the storage-generation operator machine
├── phase-state.ts                      phaseMachine: phase lifecycle state
├── phase-round-state.ts                phaseRoundMachine
├── phase-match-state.ts                phaseMatchMachine
├── phase-outcome-state.ts              phaseMatchOutcomeMachine
├── phase-aggregate-job-state.ts        Aggregate-job and game-aggregate-marker machines
├── phase-game-marker-state.ts          Game evolution-credit, edit-lease and stats-lock machines
├── lifecycle-persistence.ts            Phase lifecycle persistence (legacy vs native ports)
├── bracket-persistence.ts              Native bracket persistence + initial classic bracket detection
├── enrollment-persistence.ts           Native enrollment persistence
├── format-storage.ts                   FormatStoragePort: legacy vs native format storage
├── format-cron.ts                      Native format cron pass
├── kit-storage.ts                      KitStoragePort: legacy vs native kit storage
├── kit-groups-storage.ts               Kit league groups storage (legacy vs native)
├── kit-events.ts                       Native kit status events (fireNativeKitStatusEvent)
├── kit-match-effects.ts                Native kit match effects + phase status port
├── classic-storage.ts                  ClassicLeagueStoragePort: legacy vs native classic storage
├── classic-epb-storage.ts              createNativeEpbPhaseStorage: EPB phase storage on the native model
├── epb-storage.ts                      Phase EPB storage + mixed EPB rebuild storage
├── epb-game-edit.ts                    EPB game-edit storage + rechecker
├── evolution-checker.ts                Phase evolution tracker checker
├── phase-aggregate-storage.ts          Phase aggregate owner: enqueue/cancel/apply aggregate jobs
├── aggregate-maintenance.ts            Process-aggregates handler + mixed aggregate maintenance storage
├── game-pipeline-storage.ts            Native game pipeline storage (bracket propagation, pipeline runner)
├── game-pipeline-types.ts              Game pipeline DTOs (match, round, competition, participant, actor)
├── substitution-storage.ts             Native substitution storage
├── roster-scope.ts                     loadPhaseRosterScope: participant/seed reads for roster routes
├── enrollment-services.ts              Native phase enrollment services
├── round-pairing.ts                    planNativeRoundGroups + pairNativeRound: round generation
├── round-reset.ts                      planPhaseRoundReset
├── bracket-repair.ts                   planPhaseBracketRepair: heal missing bracket slots
├── match-services.ts                   Phase match services (effects port)
├── match-decisions.ts                  Native match decision handler (confirm/dispute)
├── match-prep.ts                       Native match prep: load, validate, save
├── match-maintenance.ts                Phase auto-confirm runner (deadline heal)
├── finalization.ts                     Phase match finalizer (finalize steps)
├── manual-result.ts                    recordNativeManualResult: player-reported results
├── reopen.ts                           Native match reopen + outcome takeback
├── replay-result.ts                    submitNativeReplay: replay submission path
├── result-effects.ts                   emitPhaseResultEffects: result side-effects
├── announcements.ts                    Phase announcements (match completion/dispute, stage/phase completion)
├── admin-locks.ts                      assertNativePhaseNotArchived archive lock
├── admin-replay.ts                     Admin replay-match resolution + recording
├── admin-transition.ts                 updateAdminPhase: admin phase transitions
├── admin-correction-services.ts        Admin match-correction service wiring for native phases
├── entity-rebuild.ts                   Mixed entity delete rebuilder (trash-restore support)
├── test-league-rating-rebuild.ts       Test-league rating rebuild storage
├── reconciliation.ts                   Mixed season reconciler
├── time-proposals.ts                   Time-proposal match load + accept/reject
├── standings-context.ts                Native season standings context + kit standings data
├── report-standings.ts                 loadPhaseReportStandings
├── report-publication.ts               Phase report publisher
├── public-report.ts                    toPublicPhaseReport: the public report shape
├── public-page-data.ts                 loadNativePhasePageData: public phase page reads
├── achievement-streams.ts              Phase achievement checks (checkPhaseAchievements, mixed tournaments)
├── rating-streak-streams.ts            Rating-history + streak streams (merge, mixed storage)
├── team-audit.ts                       Native phase team audit
├── services.ts                         createNativePhaseServices: service composition + invalidation
└── __tests__/                          54 test files: state machines, storage ports, services, page data
```

## Pointers

- Design and cutover: [Phase-owned storage](./phase-separation.md); decision: [ADR 0005](./adr/0005-league-phases-own-data-model.md).
- Phase machines in context: [State Machines](./state-machines.md); the EPL/EPB flow that built on this storage: [Evolution Point Buy](./evolution-point-buy.md) and [Format Kit](./format-kit.md).
## Testing

- **Test Files — `src/lib/league-phase/`**: `src/lib/league-phase/__tests__/` (54 test files): `achievement-streams.test.ts`, `announcements.test.ts`, `bracket-port.test.ts`, `competition-route-owner.test.ts`, `empty-round.test.ts`, `enrollment-port.test.ts`, `enrollment-services.test.ts`, `epb-credit-sql.test.ts`, `epb-credits.local.test.ts`, `epb-game-edit.test.ts`, `evolution-checker.test.ts`, `finalization.test.ts`, `format-cron.test.ts`, `format-storage.test.ts`, `game-pipeline.test.ts`, `kit-groups-storage.test.ts`, `kit-match-effects.test.ts`, `kit-storage.test.ts`, `legacy-format-freeze.local.test.ts`, `legacy-redirect.test.ts`, `legacy-write-freeze.local.test.ts`, `lifecycle-sql.test.ts`, `lifecycle.local.test.ts`, `manual-result.test.ts`, `match-decisions.test.ts`, `match-game.local.test.ts`, `match-route-owner.test.ts`, `match-services.test.ts`, `native-format-import.test.ts`, `native-format.local.test.ts`, `native-group-rounds-port.test.ts`, `native-queries.test.ts`, `page-storage-scope.test.ts`, `phase-aggregate-rebuild.test.ts`, `phase-aggregates.local.test.ts`, `phase-aggregates.test.ts`, `phase-marker-state.test.ts`, `phase-rating-history.test.ts`, `public-page-data.test.ts`, `rating-completion-fence.test.ts`, `rating-scope.test.ts`, `rating-streak-sql.test.ts`, `rating-streak-streams.local.test.ts`, `rating-streak-streams.test.ts`, `reopen.test.ts`, `report-publication.test.ts`, `report-standings.test.ts`, `route-mode.test.ts`, `schema-foundation.test.ts`, `services.test.ts`, `team-audit.test.ts`, `team-route-owner.test.ts`, `test-league-rating-rebuild.test.ts`, `transfer-migration.test.ts`.

- **Running Tests**: `npx vitest run src/lib/<module>/__tests__` (the suite guards this doc).
