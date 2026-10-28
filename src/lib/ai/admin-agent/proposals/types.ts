/**
 * Shapes of the proposal staging module (plan 4.5, spec §18.6). Type-only except for the refusal class, so the pure
 * helpers around it (`text.ts`, `provenance.ts`, `fingerprints.ts`, `turn.ts`) import no database module.
 *
 * `stage.ts` takes every collaborator as an injected dependency (`StagerDeps`): the store, the live guards, the live
 * reads (`StagingSource`), the clock, the id and the token key. `live.ts` binds the real ones, the tests bind fakes.
 */
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { JsonValue } from '@/lib/studio-core/json';
import type { AdminAgentConfig } from '../env';
import type { PlanDocument } from '../plans/schema';
import type { PlanFacts } from '../plans/facts';
import type { GuardKind, GuardSpecOf, GuardedAs } from '../registry/guard';
import type { StagedTool } from '../registry/define';
import type { AdminAgentStore } from '../store/create';
import type { AdminId } from '../store/ids';
import type { ConversationRecord } from '../store/types';
import type { UndoLockFacts } from '../plans/undo';
import type { FingerprintSource } from './fingerprints';

/** A Build left `executing` can be resumed this long after its claim, under the same approval (spec §18.6). */
export const RESUME_WINDOW_MS = 10 * 60 * 1000;

/** The live admin who staged the call (from `requireAnyAdmin()` at the chat request, never the model or the client). */
export interface StagingAdmin {
  readonly id: AdminId;
  readonly isSiteAdmin: boolean;
}

/** What staging needs of the conversation row. */
export type StagingConversation = Pick<ConversationRecord, 'id' | 'tool_set' | 'tool_registry_version' | 'ui_locale'>;

export interface StageInput {
  readonly conversation: StagingConversation;
  readonly admin: StagingAdmin;
  readonly toolName: string;
  /** The model's arguments, exactly as received. */
  readonly args: unknown;
  /** The counters of the assistant turn in progress (`newTurnStaging()`); a staged proposal is recorded on it. */
  readonly turn: TurnStaging;
}

/** The counters behind "at most 4 stagings and one Go-live card per assistant turn" (plan 3.4). */
export interface TurnStaging {
  stagings: number;
  goLive: number;
}

/** One catalogued reason a Plan or call is refused (a readiness blocker or a preflight code). */
export interface StageFinding {
  /** A key of an error catalog, or a Plan blocker code (`PLAN_BLOCKERS`). Never free text. */
  readonly code: string;
  readonly section?: string;
  /** RFC 6901 pointer to the field that fixes it. */
  readonly path?: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

export interface StageStaged {
  readonly status: 'staged';
  readonly proposal_id: string;
  readonly kind: 'build' | 'action' | 'undo';
  readonly class: 'B' | 'G';
  /** The 8-hex code the card shows. */
  readonly plan_code: string;
  readonly expires_at: string;
  /** Fixed text for the model: staging executes nothing. */
  readonly note: string;
}

export interface StageRefused {
  readonly status: 'refused';
  /** Always a key of an error catalog; the model never receives `err.message`. */
  readonly code: ApiErrorCode;
  readonly params?: Readonly<Record<string, string | number>>;
  /** Every preflight finding behind the refusal, most important first. */
  readonly findings?: readonly StageFinding[];
}

export type StageResult = StageStaged | StageRefused;

/** The text the model gets with `staged`. */
export const STAGED_NOTE = 'not executed; the admin must approve the card';

/** Runs the real `require*` guard of `spec` for the live admin and returns its token. Throws what the guard throws. */
export type GuardRunner = <K extends GuardKind>(spec: GuardSpecOf<K>) => Promise<GuardedAs<K>>;

// ─── Live reads ──────────────────────────────────────────────────────────────

export interface RulesetDraftFact {
  readonly draftRev: number;
  /** Diagnostics of severity `error` in the draft's current compile: they block the publish (422). */
  readonly errorDiagnostics: number;
  /** Hash of the sorted diagnostics (code, path): the publish fingerprint. */
  readonly diagnosticsHash: string;
  readonly currentVersionId: string | null;
  readonly visibility: 'private' | 'league' | 'gallery';
  readonly slug: string;
}

export interface PinTargetFact {
  readonly kind: 'season' | 'tournament';
  readonly id: string;
  /** Plain stored name; the card sanitises it. */
  readonly name: string;
  readonly started: boolean;
  readonly completed: boolean;
  readonly pinnedVersionId: string | null;
  /** The ruleset definition the pinned version belongs to. */
  readonly pinnedDefinitionId: string | null;
}

export interface PinImpactFact {
  readonly checked: number;
  readonly wouldBreak: number;
  readonly truncated: boolean;
}

export interface PhaseStartFact {
  readonly tournamentId: string;
  readonly tournamentName: string;
  readonly seasonId: string | null;
  readonly seasonName: string | null;
  readonly seasonFormatType: string | null;
  /** A custom-format league needs an attached format before its first round or bracket. */
  readonly formatAttached: boolean;
  readonly bracketType: string;
  readonly roundCount: number;
  readonly participantCount: number;
}

export interface EpbBattleRulesetHead {
  readonly versionId: string;
  readonly versionNo: number;
  readonly slug: string;
}

/**
 * The live reads staging needs beyond the guards. One implementation (`live.ts`) wraps the existing query modules and the
 * shared route functions; the tests pass scripted ones. A source that cannot say something throws `ReadUnavailable`
 * (`fingerprints.ts`): staging then refuses with `tool_not_available`, it never guesses.
 */
export interface StagingSource {
  /** Everything `planReadiness` looks up for this Plan (`planFactNeeds`), as the live admin sees it. */
  loadPlanFacts(input: { admin: StagingAdmin; plan: PlanDocument }): Promise<PlanFacts>;
  /** Names of the phases a league already has, for `PHASE_NAME_TAKEN` on a league built earlier. */
  existingPhaseNames(seasonId: string): Promise<readonly string[]>;
  /** The head of the shared Point Buy Battle ruleset an EPB league without a ruleset would pin; `null` when there is none. */
  epbBattleRulesetHead(): Promise<EpbBattleRulesetHead | null>;
  /** The draft of a ruleset the live admin may edit (after the `rulesetOwner` guard); `null` when it has none. */
  rulesetDraft(definitionId: string): Promise<RulesetDraftFact | null>;
  /** Whether version `versionNo` of the definition is published. */
  rulesetVersionExists(definitionId: string, versionNo: number): Promise<boolean>;
  pinTargets(targets: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }>): Promise<readonly PinTargetFact[]>;
  /** The pin impact count; throws a coded `rate_limited` when the shared hourly bucket is spent. */
  pinImpact(input: { definitionId: string; toVersionNo: number; targets: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }> }): Promise<PinImpactFact>;
  phaseStart(tournamentId: string): Promise<PhaseStartFact | null>;
  /** Masked counts of the channels an event would reach (PR5). Absent: the card says the app cannot tell. */
  recipients?(input: { eventType: string; tournamentId: string | null; seasonId: string | null }): Promise<{
    discord: { count: number; names: readonly string[] };
    social: { count: number; names: readonly string[] };
  }>;
  /**
   * What an undo needs beyond fingerprints: the lock facts of the leagues it would touch (a round exists, the league started) and
   * the names of the players a roster undo removes.
   */
  undoFacts(input: { leagueIds: readonly string[]; playerIds: readonly string[] }): Promise<{ locks: UndoLockFacts; playerNames: Readonly<Record<string, string>> }>;
  /** The state reads behind the precondition fingerprints (shared with the approve route's recheck). */
  fingerprints: FingerprintSource;
}

export type StagerStore = Pick<AdminAgentStore, 'proposals' | 'plans' | 'refs' | 'actions' | 'snapshots'>;

export interface StagerDeps {
  readonly store: StagerStore;
  readonly config: () => Pick<AdminAgentConfig, 'maxPhase' | 'golive' | 'proposalTtlMinutes' | 'limits'>;
  /** The model-facing entries of the B and G tools (`registry/staged.ts`). */
  readonly tools: readonly StagedTool[];
  readonly guard: GuardRunner;
  readonly source: StagingSource;
  /** Server secret the approval token is derived from. Read lazily; never logged. */
  readonly tokenKey: () => string;
  readonly now: () => Date;
  /** A fresh proposal uuid. */
  readonly newId: () => string;
}

/** Plain JSON a stored step carries. */
export type StepJson = { [key: string]: JsonValue };
