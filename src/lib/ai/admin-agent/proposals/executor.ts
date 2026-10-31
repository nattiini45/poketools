import 'server-only';
/**
 * The executor (plan 3.3, 4.4, 4.5, spec §18.6 to §18.8): what runs an approved proposal. It claims it, re-derives every
 * step from the in-code registry, writes the ledger row BEFORE each dispatch, dispatches as the verified session, reads the
 * result back, and ends the proposal. The chat side never reaches this file (a module-graph test): the model can stage a
 * proposal but there is no code path from the loop to a claim.
 *
 * Order of an approve (`mode: 'approve'`):
 *  1. live eligibility before anything is claimed: the phase cap, the Go-live flag, each step's `min_role` against the live
 *     player (a downgrade since staging is `409 proposal_forbidden`), the fail-closed write limiter;
 *  2. the reaper for this admin, then the atomic claim (the replay protection: one statement, `proposed` to `executing`);
 *  3. the recheck, AFTER the claim on purpose: a failed check must still consume the proposal. Each step is resolved by `op`
 *     in the registry (stored JSON is data, never logic), its hashes are recomputed from the stored rows, and the required
 *     acknowledgements must be present. Any failure finishes the proposal `stale`; no step is dispatched;
 *  4. the blast-radius counters, then the steps in order. A resume (`mode: 'resume'`) skips 1 (partly), 2 and the counters
 *     and repeats the live checks, the recheck and the steps against the ledger rows that already exist.
 *
 * Each step: ledger row first (awaited; a failed insert dispatches nothing), preconditions, symbolic references from the
 * ledger results of `ok` steps, the resolved path params and body parsed with the binding's own strict schemas (a request that
 * no longer fits is not sent), `invokeRoute`, outcome mapping, the binding's read-back, the ledger update, a fire-and-forget
 * `agent.step.*` audit event. A step that is not `ok` stops the run. A write whose outcome is unknown (masked 500, 504,
 * step timeout) is read back and reconciled, never retried: nothing here dispatches a step twice.
 *
 * Nothing in a result, a log line or an event carries `err.message`: causes are catalogued codes.
 */
import type { Session } from 'next-auth';
import { createTranslator } from '@/i18n/core';
import type { ApiErrorCode, ApiErrorParams } from '@/i18n/messages/errors';
import { errorsAdminAssistant } from '@/i18n/messages/errors/admin-assistant';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { AuditLogEntry } from '@/lib/audit/log';
import type { JsonValue } from '@/lib/studio-core/json';
import { isValidUuid } from '@/lib/utils/uuid';
import { DEFAULT_ROUTE_TIMEOUT_MS, checkCall, harnessError, invokeRoute, isUnknownOutcome, outcomeCode } from '../dispatch';
import type { BindingRegistry, DispatchContext, DispatchQuery, Outcome, QueryValue, RouteBinding, VerifyContext, VerifyResult } from '../dispatch';
import type { AdminAgentConfig } from '../env';
import { computePreviewHash, computeProposalHash, planCode } from '../plans/hash';
import { isRefObject, REF_PATH_PATTERN } from '../plans/route-bodies';
import { PLAN_OPS, type PlanOp } from '../plans/ops';
import { UNDO_MAX_STEPS } from '../plans/undo';
import { isUndoOperation } from '../plans/undo-recipes';
import type { ActionRepository } from '../store/actions';
import type { ConversationRepository } from '../store/conversations';
import { AdminAgentStoreError } from '../store/errors';
import type { AdminId } from '../store/ids';
import type { ProposalRepository } from '../store/proposals';
import type { ActionRecord, BlastClaim, Json, ProposalFinalStatus, ProposalRecord } from '../store/types';
import { proposalCardSchema } from './card';
import type { StepFacts } from './after-state';
import { changedPreconditions, preconditionsHash } from './fingerprints';
import type { FingerprintSource, PreconditionEntry } from './fingerprints';
import { REAPER_AGE_MS, RESULT_EVENT, ROUTE_MAX_DURATION_SECONDS, reapOverdueProposals } from './reaper';
import { storedStepSchema, stepHashMatches } from './steps';
import type { StoredStep } from './steps';
import { normalizeTypedName } from './text';
import { approvalTokenHash } from './token';
import { RESUME_WINDOW_MS } from './types';

// ─── Timing (spec §18.6, §18.7) ──────────────────────────────────────────────

// The reaper's constants live with the reaper: the chat turn reaps too and must not import this file.
export { REAPER_AGE_MS, RESULT_EVENT, ROUTE_MAX_DURATION_SECONDS };
// The resume window lives in `types.ts`: the card the chat side serves needs it to say whether a Resume is offered.
export { RESUME_WINDOW_MS };
/**
 * No new step starts after this much wall clock of one request; the proposal stays `executing` for a resume. A step started
 * just before it may still dispatch (`DEFAULT_ROUTE_TIMEOUT_MS`) and settle (`SETTLE_MS`), and all of that must end inside
 * the route's `maxDuration` (`ROUTE_MAX_DURATION_SECONDS`), with a few seconds to spare: 225 + 55 + 15 + 5 = 300 s.
 */
export const STEP_DEADLINE_MS = 225_000;
/** Reconcile waits this long and reads again before it says a write that may still be running is absent. */
export const SETTLE_MS = 15_000;
/** The write limiter: one hit per approve or resume request, not per step (spec §18.10 "Approve or resume requests"). */
const WRITE_LIMIT_WINDOW_SECONDS = 60 * 60;

// ─── Errors ──────────────────────────────────────────────────────────────────

export const EXECUTION_ERROR_STATUS = {
  agent_disabled: 404,
  phase_disabled: 501,
  agent_golive_disabled: 403,
  agent_rate_limited: 429,
  proposal_forbidden: 409,
  proposal_stale: 409,
  proposal_hash_mismatch: 409,
  proposal_ack_missing: 409,
  proposal_not_resumable: 409,
} as const satisfies Partial<Record<ApiErrorCode, number>>;

export type ProposalExecutionErrorCode = keyof typeof EXECUTION_ERROR_STATUS;

const english = createTranslator(errorsAdminAssistant, 'en');

/**
 * A refusal of the approve or resume request. `message` is the catalog's English text, so `safeErrorResponse` sends the code,
 * the params and that text; `reason` is for logs and tests and never reaches a client.
 */
export class ProposalExecutionError extends UserFacingError<ProposalExecutionErrorCode> {
  readonly reason: string;
  /** Set for `agent_rate_limited`: the route answers it with a `Retry-After` header. */
  readonly retryAfterSeconds?: number;

  constructor(code: ProposalExecutionErrorCode, reason: string, params?: ApiErrorParams<ProposalExecutionErrorCode>, retryAfterSeconds?: number) {
    super(english.dynamic(code, params as Record<string, string | number> | undefined), { code, params, status: EXECUTION_ERROR_STATUS[code] });
    this.name = 'ProposalExecutionError';
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ─── Dependencies and shapes ─────────────────────────────────────────────────

/** The slice of the store the executor uses; `adminAgentStore` satisfies it, the tests pass an in-memory one. */
export interface ExecutorStore {
  readonly proposals: Pick<ProposalRepository, 'getProposalOrThrow' | 'getProposal' | 'claimProposal' | 'finishProposal' | 'reapExecutingProposals'>;
  readonly actions: Pick<ActionRepository, 'insertAction' | 'completeAction' | 'listProposalActions' | 'getAction'>;
  readonly conversations: Pick<ConversationRepository, 'getConversation' | 'claimBudget'>;
}

export interface ExecutorDeps {
  readonly store: ExecutorStore;
  /** The in-code bindings; the only source of what a step may call (`_ops/g`). */
  readonly bindings: BindingRegistry;
  /** The precondition reads (`liveFingerprints`): the same ones staging hashed. */
  readonly fingerprints: FingerprintSource;
  /** `ADMIN_AGENT_MAX_PHASE` and the switches, read per request. */
  readonly config: () => Pick<AdminAgentConfig, 'enabled' | 'golive' | 'maxPhase' | 'limits' | 'caps'>;
  /** The registry version the running code would give a conversation of this tool set (`buildToolSet(...).registryVersion`). */
  readonly registryVersion: (toolSet: string) => string;
  /** The `admin-agent-write` limiter; it fails closed (it throws when the limiter cannot be consulted). */
  readonly rateLimit: (identity: string, options: { limit: number; windowSeconds: number }) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  /** Appends a harness event to a conversation (under its turn lease). A failure is logged; the proposal's status is the record. */
  readonly recordEvent: (adminId: AdminId, conversationId: string, event: string, data: Readonly<Record<string, Json | undefined>>) => Promise<void>;
  /** Fire-and-forget audit writer (`logAuditEvent`): never awaited into a step result. */
  readonly audit: (entry: AuditLogEntry) => void;
  /**
   * The state of an entity right after a step wrote it, for the ledger's `after_fingerprint` (an undo compares against it);
   * absent: `null` is stored. Only called for a step that ended `ok`.
   */
  readonly afterFingerprint?: (facts: StepFacts) => Promise<string | null>;
  /**
   * What a reversal needs and the route's answer will not say, read right before the dispatch and stored as the ledger's
   * `before` (the version each target of a pin move pinned). Absent or `null`: nothing is stored.
   */
  readonly beforeState?: (facts: Pick<StepFacts, 'step' | 'call'>) => Promise<Json | null>;
  readonly now: () => Date;
  /** The settle wait of the reconcile; tests pass a recorder. */
  readonly sleep: (ms: number) => Promise<void>;
}

export interface ApprovalInput {
  /** The approval token the request carried (the claim compares its sha256). */
  readonly token: string;
  readonly proposalHash: string;
  readonly previewHash: string;
  readonly acks: readonly string[];
  /** What the admin typed for each `typed_name` acknowledgement of the card, by acknowledgement id (spec §18.6 step 4). */
  readonly typed?: Readonly<Record<string, string>>;
  /** Keyed hash of the client IP and the truncated user agent, stamped on the claim. */
  readonly ipHash?: string | null;
  readonly userAgent?: string | null;
}

interface ExecuteBase {
  readonly adminId: AdminId;
  /** The human's name, for the audit events. */
  readonly adminName: string;
  /** From the live `requireAnyAdmin()`, never the session copy. */
  readonly isSiteAdmin: boolean;
  /** The session `authAndRecord()` returned on this request. */
  readonly session: Session;
  /** The inbound request: its client IP headers are forwarded to the dispatched routes. */
  readonly inbound: Pick<Request, 'headers'>;
  readonly proposalId: string;
}

export type ExecuteInput =
  | (ExecuteBase & { readonly mode: 'approve'; readonly approval: ApprovalInput })
  | (ExecuteBase & { readonly mode: 'resume'; readonly approval?: undefined });

export type StepResultStatus = 'ok' | 'failed' | 'unknown' | 'skipped' | 'pending';

export interface StepSummary {
  readonly key: string;
  readonly status: StepResultStatus;
  /** A catalogued code (`step_failed`, `unknown_outcome`, `participant_already_enrolled`, ...). */
  readonly code?: string;
  readonly entity_id?: string;
}

/** What the route answers and the harness event carries: server-built, structured, never free text. */
export interface ProposalResult {
  readonly kind: 'proposal_result';
  readonly proposal_id: string;
  readonly plan_code: string;
  /** `executing`: the proposal is not finished; a Build can be resumed within ten minutes. */
  readonly status: ProposalFinalStatus | 'executing';
  readonly steps: readonly StepSummary[];
}

/** What a binding's `verify` and the hooks receive as the step's arguments: the resolved request, as it was sent. */
export interface StepCall {
  readonly step: Pick<StoredStep, 'key' | 'op' | 'entity_type' | 'targets'>;
  readonly params: Readonly<Record<string, string>>;
  readonly query: DispatchQuery;
  readonly body: unknown;
}

/** The key of an undo step: `undo.<ledger row>` or `undo.<ledger row>.<n>`. The row it names is the one marked `undone`. */
const UNDO_KEY = /^undo\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.\d{1,3})?$/;

/** The path parameter that names the entity of an op whose ledger entity is not the id in its answer (spec §18.8: what an undo acts on). */
const ENTITY_PARAM: Readonly<Record<string, string>> = {
  start_phase: 'tid',
  generate_bracket: 'id',
  publish_ruleset: 'id',
  move_pin: 'id',
  league_archive: 'id',
  tournament_archive: 'id',
  roster_remove: 'id',
  tournament_participant_remove: 'id',
  ruleset_restore_draft: 'id',
  ruleset_delete_draft: 'id',
};

/**
 * The entity a ledger row is filed under: the tournament a start or a bracket runs on, the ruleset definition a publish or a pin
 * move belongs to (the version stays in `result`), the entity an undo step acted on; otherwise the id the route answered with.
 */
export function ledgerEntityId(op: string, call: Pick<StepCall, 'params'> | undefined, result: Record<string, JsonValue> | null): string | null {
  const param = ENTITY_PARAM[op];
  if (param !== undefined) return uuidOrNull(call?.params[param]);
  return result ? uuidOrNull(result.id) : null;
}

// ─── Symbolic references (spec §18.6) ────────────────────────────────────────

/** The step op that may fill each `$ref` root. The path patterns are the Plan's (`REF_PATH_PATTERN`). */
const REF_PRODUCERS: Readonly<Record<string, PlanOp>> = { league: 'league_create', tournament: 'tournament_create', groups: 'groups_set' };

/** Ledger result fields (ids only) per op; every other op keeps `id`. */
const RESULT_FIELDS: Readonly<Partial<Record<string, readonly string[]>>> = { league_create: ['id', 'ruleset_id'], roster_add: [], tournament_participant_add: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuidOrNull = (value: unknown): string | null => (typeof value === 'string' && isValidUuid(value) ? value.toLowerCase() : null);
const GROUP_NAME = /^Group ([A-Z])$/;

/**
 * The part of a route's answer a later step may reference or the ledger keeps: uuids only. A league keeps `id` and
 * `ruleset_id`; the groups route keeps `{ A: { id }, ... }` (the `groups.A.id` refs); the rest keep `id`. Anything else a
 * route returns (names, rows, players) never reaches the ledger from here.
 */
export function extractStepResult(op: string, data: unknown): Record<string, JsonValue> | null {
  if (!isRecord(data)) return null;
  if (op === 'groups_set') {
    const out: Record<string, JsonValue> = {};
    for (const group of Array.isArray(data.groups) ? data.groups : []) {
      if (!isRecord(group) || typeof group.name !== 'string') continue;
      const letter = GROUP_NAME.exec(group.name)?.[1];
      const id = uuidOrNull(group.id);
      if (letter !== undefined && id !== null) out[letter] = { id };
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  const out: Record<string, JsonValue> = {};
  for (const field of RESULT_FIELDS[op] ?? ['id']) {
    const id = uuidOrNull(data[field]);
    if (id !== null) out[field] = id;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const asRecord = (value: Json | null | undefined): Record<string, JsonValue> | null => (isRecord(value) ? (value as Record<string, JsonValue>) : null);

/** A `{ "$ref": path }` object and nothing else. */
const refPathOf = (value: JsonValue): string | null =>
  isRefObject(value) && Object.keys(value as object).length === 1 ? (value as { $ref: string }).$ref : null;

/** Every `$ref` in a template (an object that carries `$ref` beside other keys is returned as `''`: malformed). */
function collectRefs(value: JsonValue, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (isRecord(value)) {
    const ref = refPathOf(value as JsonValue);
    if (ref !== null) out.push(ref);
    else if ('$ref' in value) out.push('');
    else for (const item of Object.values(value)) collectRefs(item as JsonValue, out);
  }
  return out;
}

// ─── The run ─────────────────────────────────────────────────────────────────

interface StepRun {
  status: StepResultStatus;
  code?: string;
  entityId?: string;
  /** The ledger result of an `ok` step (what a `$ref` reads). */
  result?: Record<string, JsonValue> | null;
}

/** `reaped`: the proposal is no longer `executing` (the reaper moved it): nothing more is dispatched and nothing else is written for it. */
type StopReason = 'failed' | 'unknown' | 'stale' | 'deadline' | 'reaped';

interface RunContext {
  readonly deps: ExecutorDeps;
  readonly input: ExecuteInput;
  readonly proposal: ProposalRecord;
  readonly steps: readonly StoredStep[];
  readonly runs: Map<string, StepRun>;
  readonly ledger: Map<string, ActionRecord>;
  readonly startedAt: number;
}

const nowMs = (ctx: RunContext): number => ctx.deps.now().getTime();

const logTag = '[admin-agent] executor';

function refuse(code: ProposalExecutionErrorCode, reason: string, params?: ApiErrorParams<ProposalExecutionErrorCode>, retryAfterSeconds?: number): ProposalExecutionError {
  console.error(`${logTag}: refused ${code} (${reason})`);
  return new ProposalExecutionError(code, reason, params, retryAfterSeconds);
}

function stepsOf(proposal: ProposalRecord): StoredStep[] | null {
  const parsed = storedStepSchema.array().min(1).safeParse(proposal.steps);
  return parsed.success ? parsed.data : null;
}

/** The stored precondition entries. Staging wrote `read` from `ReadName`; the stored schema keeps it a string. */
const entriesOf = (step: StoredStep): PreconditionEntry[] => step.preconditions as PreconditionEntry[];

function acksRequiredOf(proposal: ProposalRecord): string[] {
  return Array.isArray(proposal.acks_required) ? proposal.acks_required.filter((ack): ack is string => typeof ack === 'string') : [];
}

// ─── Live eligibility ────────────────────────────────────────────────────────

/** Everything that is checked against the live state before a proposal is claimed (approve) or continued (resume). */
async function assertEligible(deps: ExecutorDeps, input: ExecuteInput, proposal: ProposalRecord, steps: readonly StoredStep[] | null): Promise<void> {
  const cfg = deps.config();
  if (!cfg.enabled) throw refuse('agent_disabled', 'assistant_off');
  // Phase 0 shipped the cards and the routes but executes nothing; every operation is at least phase 1.
  if (cfg.maxPhase < 1) throw refuse('phase_disabled', 'max_phase_0');

  if (input.mode === 'resume') {
    // A Go-live proposal never resumes: an interrupted one is `unknown` and goes to reconciliation.
    const started = proposal.executing_started_at === null ? Number.NaN : Date.parse(proposal.executing_started_at);
    const within = Number.isFinite(started) && deps.now().getTime() - started <= RESUME_WINDOW_MS;
    if (proposal.kind !== 'build' || proposal.class !== 'B') throw refuse('proposal_not_resumable', 'not_a_build');
    if (proposal.status !== 'executing') throw refuse('proposal_not_resumable', `status_${proposal.status}`);
    if (proposal.approved_by === null || proposal.approved_by.toLowerCase() !== input.adminId) throw refuse('proposal_not_resumable', 'approved_by_someone_else');
    if (!within) throw refuse('proposal_not_resumable', 'resume_window_over');
  } else if (proposal.status !== 'proposed') {
    // A replay or a double click: nothing is claimed and nothing is charged.
    throw new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: proposal.status } });
  }

  if (proposal.class === 'G' && !cfg.golive) throw refuse('agent_golive_disabled', 'golive_off');
  // A role downgrade since staging. An unreadable step list is dealt with after the claim, where a failure consumes the proposal.
  if (steps !== null && !input.isSiteAdmin && steps.some((step) => step.min_role === 'site')) throw refuse('proposal_forbidden', 'role_downgraded');

  const rate = await deps.rateLimit(input.adminId, { limit: cfg.limits.writesPerHour, windowSeconds: WRITE_LIMIT_WINDOW_SECONDS });
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterSeconds));
    throw refuse('agent_rate_limited', 'write_limiter', { seconds }, seconds);
  }
}

// ─── The recheck (after the claim) ───────────────────────────────────────────

interface Refusal {
  code: 'proposal_stale' | 'proposal_hash_mismatch' | 'proposal_ack_missing';
  reason: string;
}

/**
 * Whether the claimed proposal still is what was shown, and still is something the running code can execute. Stored JSON is
 * data: every step is resolved by `op` in the registry and compared with it, never trusted. First failure wins.
 */
async function recheck(deps: ExecutorDeps, input: ExecuteInput, proposal: ProposalRecord, steps: readonly StoredStep[] | null): Promise<Refusal | null> {
  const cfg = deps.config();
  if (steps === null) return { code: 'proposal_stale', reason: 'steps_unreadable' };

  const conversation = await deps.store.conversations.getConversation(input.adminId, proposal.conversation_id);
  if (conversation === null) return { code: 'proposal_stale', reason: 'conversation_gone' };
  if (deps.registryVersion(conversation.tool_set) !== proposal.tool_registry_version) return { code: 'proposal_stale', reason: 'registry_version_changed' };

  if (proposal.kind === 'undo' && (proposal.class !== 'G' || steps.length > UNDO_MAX_STEPS)) return { code: 'proposal_stale', reason: 'undo_shape' };

  const keys = new Set<string>();
  for (const step of steps) {
    if (keys.has(step.key)) return { code: 'proposal_stale', reason: `duplicate_step_key:${step.key}` };
    keys.add(step.key);
    const binding = deps.bindings.get(step.op);
    if (binding === undefined) return { code: 'proposal_stale', reason: `unknown_op:${step.op}` };
    if (binding.class !== step.class || binding.method !== step.method || binding.path !== step.route_template) return { code: 'proposal_stale', reason: `binding_differs:${step.op}` };
    // A Build never holds a Go-live step, and a Go-live proposal never a Build step. The one exception is an undo: a G proposal
    // whose steps are the compensating calls, each in the class of its own binding (checked above: step.class equals the binding's).
    if (proposal.kind !== 'undo' && step.class !== proposal.class) return { code: 'proposal_stale', reason: `class_differs:${step.key}` };
    // The registry also holds the compensating calls (archive a league, remove a roster row): staging derives only the Plan's ops.
    if (proposal.kind === 'build' && !(PLAN_OPS as readonly string[]).includes(step.op)) return { code: 'proposal_stale', reason: `op_not_buildable:${step.op}` };
    // And an undo holds nothing but those: the allow-list is the one the recipes declare, whatever the registry also binds.
    if (proposal.kind === 'undo' && (!isUndoOperation(step.op) || !UNDO_KEY.test(step.key))) return { code: 'proposal_stale', reason: `op_not_undoable:${step.op}` };
    if ((binding.phase ?? 5) > cfg.maxPhase) return { code: 'proposal_stale', reason: `phase_above_cap:${step.op}` };
    for (const template of [step.path_params, step.query, step.body_template]) {
      for (const ref of collectRefs(template as JsonValue)) {
        if (!REF_PATH_PATTERN.test(ref)) return { code: 'proposal_stale', reason: `ref_not_allowed:${step.key}` };
      }
    }
  }

  const ids = { adminId: input.adminId, conversationId: proposal.conversation_id, proposalId: proposal.id };
  if (!steps.every((step) => stepHashMatches(step, ids))) return { code: 'proposal_hash_mismatch', reason: 'step_hash' };

  const card = proposalCardSchema.safeParse(proposal.preview);
  if (!card.success) return { code: 'proposal_stale', reason: 'preview_unreadable' };
  const acksRequired = acksRequiredOf(proposal);
  const proposalHash = computeProposalHash({
    stepArgsHashes: steps.map((step) => step.args_hash),
    preconditionsHash: preconditionsHash(steps.map(entriesOf)),
    acksRequired,
  });
  const previewHash = computePreviewHash({
    preview: card.data as unknown as JsonValue,
    outwardEffects: card.data.outwardEffects as unknown as JsonValue,
    targets: card.data.steps.map((step) => ({ target: step.target, items: step.items })) as unknown as JsonValue,
    locale: proposal.locale,
  });
  // The stored hashes catch a row edited after staging; the request's catch a card the admin was not shown.
  if (proposalHash !== proposal.proposal_hash || previewHash !== proposal.preview_hash) return { code: 'proposal_hash_mismatch', reason: 'stored_hash' };
  if (input.mode === 'approve') {
    if (input.approval.proposalHash !== proposal.proposal_hash || input.approval.previewHash !== proposal.preview_hash) return { code: 'proposal_hash_mismatch', reason: 'request_hash' };
    const given = new Set(input.approval.acks);
    if (!acksRequired.every((ack) => given.has(ack))) return { code: 'proposal_ack_missing', reason: 'acks' };
    // The friction gate is the server's too: every typed-name acknowledgement of the shown card needs the typed text on the wire,
    // equal to the expected one once cleaned the way the expected text was. The ids come from the stored card (covered by the
    // preview hash), never from the request.
    for (const ack of card.data.acks) {
      if (ack.kind !== 'typed_name') continue;
      const typed = input.approval.typed?.[ack.id];
      if (ack.expected === undefined || typed === undefined || normalizeTypedName(typed) !== ack.expected.text) return { code: 'proposal_ack_missing', reason: 'typed_name' };
    }
  }
  return null;
}

// ─── Blast-radius counters ───────────────────────────────────────────────────

/** The counters a proposal claims when it is claimed (spec §18.10). A pin move claims one per league or phase it names. */
export function blastClaims(proposal: Pick<ProposalRecord, 'class'>, steps: readonly StoredStep[], caps: AdminAgentConfig['caps']): BlastClaim[] {
  const claims: BlastClaim[] = [];
  const leagues = steps.filter((step) => step.op === 'league_create').length;
  const tournaments = steps.filter((step) => step.op === 'tournament_create').length;
  if (leagues > 0) claims.push({ counter: 'league_creates', amount: leagues, cap: caps.leagueCreates });
  if (tournaments > 0) claims.push({ counter: 'tournament_creates', amount: tournaments, cap: caps.tournamentCreates });
  const pinTargets = steps.filter((step) => step.op === 'move_pin').reduce((sum, step) => sum + step.targets.filter((target) => target.kind === 'season' || target.kind === 'tournament').length, 0);
  if (pinTargets > 0) claims.push({ counter: 'pin_targets', amount: pinTargets, cap: caps.pinTargets });
  if (proposal.class === 'G') claims.push({ counter: 'golive_executions', amount: 1, cap: caps.golive });
  return claims;
}

// ─── One step ────────────────────────────────────────────────────────────────

/** What the ledger row of a step is inserted with: the request template, as data. */
function ledgerInput(proposal: ProposalRecord, step: StoredStep) {
  return {
    conversationId: proposal.conversation_id,
    toolName: step.op,
    class: step.class,
    proposalId: proposal.id,
    stepKey: step.key,
    method: step.method,
    path: step.route_template,
    args: { path_params: step.path_params, query: step.query, body_template: step.body_template } as unknown as Json,
    argsHash: step.args_hash,
  };
}

type Resolved = { ok: true; call: StepCall } | { ok: false; reason: 'dependency' | 'invalid' };

/** Resolves the step's `$ref`s from the ledger results of `ok` steps and shapes the request. */
function resolveStep(ctx: RunContext, step: StoredStep): Resolved {
  // An object, not a `let`: TypeScript would narrow a local that only closures assign to.
  const state: { failure: 'dependency' | 'invalid' | null } = { failure: null };
  const fail = (reason: 'dependency' | 'invalid'): null => {
    state.failure ??= reason;
    return null;
  };
  const lookup = (path: string): string | null => {
    const [root, ...rest] = path.split('.');
    const producer = ctx.steps.find((candidate) => candidate.ref_key === root);
    if (producer === undefined) return fail('dependency');
    if (REF_PRODUCERS[root] !== producer.op) return fail('invalid');
    const run = ctx.runs.get(producer.key);
    if (run === undefined || run.status !== 'ok') return fail('dependency');
    let node: unknown = run.result ?? null;
    for (const segment of rest) node = isRecord(node) ? node[segment] : undefined;
    return uuidOrNull(node) ?? fail('invalid');
  };
  const resolve = (value: JsonValue): JsonValue => {
    const ref = refPathOf(value);
    if (ref !== null) return REF_PATH_PATTERN.test(ref) ? lookup(ref) : fail('invalid');
    if (Array.isArray(value)) return value.map(resolve);
    if (isRecord(value)) {
      // `$ref` beside other keys is a malformed template, not a reference.
      if ('$ref' in value) return fail('invalid');
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item as JsonValue)]));
    }
    return value;
  };

  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries(step.path_params)) {
    const resolved = resolve(value);
    if (typeof resolved === 'string') params[name] = resolved;
    else fail('invalid');
  }
  const query: Record<string, QueryValue | QueryValue[]> = {};
  const queryValue = (value: JsonValue): QueryValue | null => (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null);
  for (const [name, value] of Object.entries(step.query)) {
    const resolved = resolve(value);
    if (Array.isArray(resolved)) {
      const items = resolved.map(queryValue);
      if (items.some((item) => item === null)) fail('invalid');
      else query[name] = items as QueryValue[];
      continue;
    }
    const single = queryValue(resolved);
    if (single === null) fail('invalid');
    else query[name] = single;
  }
  const body = resolve(step.body_template);
  if (state.failure !== null) return { ok: false, reason: state.failure };
  return { ok: true, call: { step: { key: step.key, op: step.op, entity_type: step.entity_type, targets: step.targets }, params, query, body } };
}

/** How a step is dispatched, as the verified session of this request. The read-back gets it too, for a repair it runs itself. */
function dispatchContextOf(ctx: RunContext, step: StoredStep): DispatchContext {
  return {
    session: ctx.input.session,
    inbound: ctx.input.inbound,
    audit: {
      agent_conversation_id: ctx.proposal.conversation_id,
      agent_proposal_id: ctx.proposal.id,
      agent_step: step.key,
      agent_tool: step.op,
      approved_by: ctx.input.adminId,
      ...(ctx.proposal.approved_at ? { approved_at: ctx.proposal.approved_at } : {}),
      plan_code: planCode(ctx.proposal.proposal_hash),
      args_hash: step.args_hash,
      tool_registry_version: ctx.proposal.tool_registry_version,
    },
  };
}

function verifyContextOf(ctx: RunContext, step: StoredStep): VerifyContext {
  return {
    adminId: ctx.input.adminId,
    isSiteAdmin: ctx.input.isSiteAdmin,
    ...(ctx.proposal.approved_at ? { approvedAt: ctx.proposal.approved_at } : {}),
    dispatch: dispatchContextOf(ctx, step),
  };
}

async function verifyStep(ctx: RunContext, step: StoredStep, binding: RouteBinding, call: StepCall, outcome: Outcome): Promise<VerifyResult & { ambiguous: boolean }> {
  if (typeof binding.verify !== 'function') return { status: 'unknown', ambiguous: false };
  try {
    const verdict = await binding.verify(call, outcome, verifyContextOf(ctx, step));
    return { ...verdict, ambiguous: verdict.detail?.ambiguous === true };
  } catch (error) {
    // The read-back could not run. The step stays unknown; the cause is in the log, never in the result.
    console.error(`${logTag}: verify failed for ${binding.operation}`, error);
    return { status: 'unknown', ambiguous: false };
  }
}

/** `verify`, and for a write that may still be running one more read after the settle window. */
async function reconcile(ctx: RunContext, step: StoredStep, binding: RouteBinding, call: StepCall, outcome: Outcome, settle: boolean): Promise<VerifyResult & { ambiguous: boolean }> {
  let verdict = await verifyStep(ctx, step, binding, call, outcome);
  if (verdict.status === 'confirmed' || verdict.status === 'failed' || verdict.ambiguous || !settle) return verdict;
  await ctx.deps.sleep(SETTLE_MS);
  verdict = await verifyStep(ctx, step, binding, call, outcome);
  return verdict;
}

/** The ledger update for a step and the run state it gives. Never throws: a ledger that cannot be written makes the step `unknown`. */
async function settleStep(
  ctx: RunContext,
  step: StoredStep,
  action: ActionRecord,
  end: {
    status: 'ok' | 'failed' | 'unknown' | 'skipped';
    code?: string;
    outcome?: Outcome;
    result?: Record<string, JsonValue> | null;
    verify?: Json | null;
    /** The resolved request the step was sent with, when this settle follows a dispatch. */
    call?: StepCall;
    /** What the reversal needs, read before the dispatch. */
    before?: Json | null;
  },
): Promise<StepRun> {
  // Only a step that wrote is filed under the entity it acted on; a failed or unknown one keeps the id its answer carried (if any).
  const entityId = end.status === 'ok' ? ledgerEntityId(step.op, end.call, end.result ?? null) : end.result ? uuidOrNull(end.result.id) : null;
  let afterFingerprint: string | null = null;
  if (end.status === 'ok' && ctx.deps.afterFingerprint) {
    try {
      afterFingerprint = await ctx.deps.afterFingerprint({
        step: { key: step.key, op: step.op },
        ...(end.call ? { call: { params: end.call.params, body: end.call.body } } : {}),
        result: end.result ?? null,
        entityId,
      });
    } catch (error) {
      console.error(`${logTag}: after-fingerprint failed for ${step.key}`, error);
    }
  }
  const httpStatus = end.outcome && 'httpStatus' in end.outcome && typeof end.outcome.httpStatus === 'number' ? end.outcome.httpStatus : null;
  try {
    await ctx.deps.store.actions.completeAction(ctx.input.adminId, action.id, {
      status: end.status,
      // A reconcile has no new answer from the route: the original status and kind stay on the row.
      ...(end.outcome ? { httpStatus, outcomeKind: end.outcome.kind } : {}),
      errorCode: end.code ?? null,
      ...(end.result !== undefined ? { result: end.result as Json | null } : {}),
      afterFingerprint,
      reversibility: step.reversal,
      ...(end.verify !== undefined ? { verify: end.verify } : {}),
      ...(end.before !== undefined && end.before !== null ? { before: end.before } : {}),
      entityType: step.entity_type,
      entityId,
    });
  } catch (error) {
    // The write may have happened and the ledger cannot say so: stop, and let a resume reconcile the `executing` row.
    console.error(`${logTag}: could not complete the ledger row of ${step.key}`, error);
    return { status: 'unknown', code: 'ledger_unavailable' };
  }
  return { status: end.status, ...(end.code !== undefined ? { code: end.code } : {}), ...(entityId !== null ? { entityId } : {}), ...(end.result !== undefined ? { result: end.result } : {}) };
}

function auditStep(ctx: RunContext, step: StoredStep, run: StepRun): void {
  const action = run.status === 'ok' ? 'agent.step.execute' : run.status === 'unknown' ? 'agent.step.unknown' : run.status === 'failed' ? 'agent.step.fail' : null;
  if (action === null) return;
  try {
    ctx.deps.audit({
      actor_id: ctx.input.adminId,
      actor_name: ctx.input.adminName,
      action,
      resource_type: step.entity_type,
      resource_id: run.entityId ?? ctx.proposal.id,
      metadata: {
        via: 'agent',
        agent_conversation_id: ctx.proposal.conversation_id,
        agent_proposal_id: ctx.proposal.id,
        agent_step: step.key,
        agent_tool: step.op,
        approved_by: ctx.input.adminId,
        plan_code: planCode(ctx.proposal.proposal_hash),
        args_hash: step.args_hash,
        status: run.status,
        ...(run.code !== undefined ? { code: run.code } : {}),
      },
    });
  } catch (error) {
    console.error(`${logTag}: audit event not written`, error);
  }
}

/** Records a step that will not run (`skipped`): a ledger row, so the card and a later Build know. Best effort. */
async function recordSkipped(ctx: RunContext, step: StoredStep, code?: string): Promise<StepRun> {
  try {
    const inserted = await ctx.deps.store.actions.insertAction(ctx.input.adminId, ledgerInput(ctx.proposal, step));
    if (inserted.inserted) {
      await ctx.deps.store.actions.completeAction(ctx.input.adminId, inserted.action.id, { status: 'skipped', ...(code !== undefined ? { errorCode: code } : {}), entityType: step.entity_type });
    }
  } catch (error) {
    console.error(`${logTag}: could not record the skipped step ${step.key}`, error);
  }
  return { status: 'skipped', ...(code !== undefined ? { code } : {}) };
}

/** The outcome of a step the ledger already had a row for (a resume, or a race with another request). */
async function adoptRow(ctx: RunContext, step: StoredStep, row: ActionRecord): Promise<StepRun> {
  switch (row.status) {
    case 'ok':
      return { status: 'ok', result: asRecord(row.result), ...(row.entity_id ? { entityId: row.entity_id } : {}) };
    case 'skipped':
      return { status: 'skipped', ...(row.error_code ? { code: row.error_code } : {}) };
    case 'failed':
    case 'undone':
      return { status: 'failed', code: row.error_code ?? 'step_failed' };
    default:
      break;
  }

  // `executing` (the request died after the insert) or `unknown`: read the resource back; never dispatch it again.
  const binding = ctx.deps.bindings.get(step.op);
  const resolved = resolveStep(ctx, step);
  if (binding === undefined || !resolved.ok) return { status: 'unknown', code: 'unknown_outcome' };
  // Nothing is dispatched here, but the read-back builds its queries from the same request: it gets only one that still parses.
  if (!checkCall(binding, resolved.call).ok) return { status: 'unknown', code: 'unknown_outcome' };
  const age = nowMs(ctx) - Date.parse(row.created_at);
  // An `executing` row this young may belong to a request that is still dispatching it (a resume racing the approve).
  // Leave the row to that request: no read-back, no ledger write; the proposal stays open for a later resume.
  if (row.status === 'executing' && !(age >= (binding.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS) + SETTLE_MS)) return { status: 'unknown', code: 'unknown_outcome' };
  const young = age < SETTLE_MS;
  const verdict = await reconcile(ctx, step, binding, resolved.call, harnessError('step_timeout', { write: true, ran: true }), young);
  return concludeReconcile(ctx, step, row, verdict, null, { call: resolved.call });
}

/** `confirmed` adopts the write as the step's result; anything else leaves it unknown (an ambiguous match says so). */
async function concludeReconcile(
  ctx: RunContext,
  step: StoredStep,
  action: ActionRecord,
  verdict: VerifyResult & { ambiguous: boolean },
  outcome: Outcome | null,
  extra: { call?: StepCall; before?: Json | null } = {},
): Promise<StepRun> {
  const verify = { status: verdict.status, ...(verdict.detail ?? {}) } as Json;
  if (verdict.status === 'confirmed') {
    const result = extractStepResult(step.op, verdict.detail ?? {});
    const run = await settleStep(ctx, step, action, { status: 'ok', ...(outcome ? { outcome } : {}), result, verify, ...extra });
    auditStep(ctx, step, run);
    return run;
  }
  if (verdict.status === 'failed') {
    // The write is there and the step still did not succeed (a tournament its creator cannot administer): the ledger keeps the id.
    const result = extractStepResult(step.op, verdict.detail ?? {});
    const run = await settleStep(ctx, step, action, { status: 'failed', code: verdict.code ?? 'step_failed', ...(outcome ? { outcome } : {}), result, verify, ...extra });
    auditStep(ctx, step, run);
    return run;
  }
  const code = verdict.ambiguous ? 'reconcile_ambiguous' : 'unknown_outcome';
  const run = await settleStep(ctx, step, action, { status: 'unknown', code, ...(outcome ? { outcome } : {}), verify, ...extra });
  auditStep(ctx, step, run);
  return run;
}

/** Everything after the ledger row exists: preconditions, references, the dispatch, the outcome mapping and the read-back. */
async function dispatchStep(ctx: RunContext, step: StoredStep, binding: RouteBinding, action: ActionRecord): Promise<{ run: StepRun; stale?: boolean }> {
  // c. Preconditions: the same reads staging hashed. A read that cannot be answered stops the run like a change (fail
  // closed), under its own code: it says nothing about whether the situation changed.
  let changed = false;
  try {
    changed = (await changedPreconditions(ctx.deps.fingerprints, entriesOf(step))).length > 0;
  } catch (error) {
    console.error(`${logTag}: a precondition read failed for ${step.key}`, error);
    const run = await settleStep(ctx, step, action, { status: 'skipped', code: 'precondition_read_failed' });
    return { run, stale: true };
  }
  if (changed) {
    const run = await settleStep(ctx, step, action, { status: 'skipped', code: 'proposal_stale' });
    return { run, stale: true };
  }

  // d. References from the ledger results of `ok` steps of this proposal.
  const resolved = resolveStep(ctx, step);
  if (!resolved.ok) {
    if (resolved.reason === 'dependency') return { run: await settleStep(ctx, step, action, { status: 'skipped', code: 'step_failed' }) };
    console.error(`${logTag}: a reference of ${step.key} did not resolve to an id`);
    const run = await settleStep(ctx, step, action, { status: 'failed', code: 'agent_harness_error' });
    auditStep(ctx, step, run);
    return { run };
  }
  const { call } = resolved;

  // d2. The resolved request against the binding's strict schemas. A step is data: a body or an id that no longer fits what the
  // binding allows is not sent. Only the zod issue paths are logged, never the values.
  const check = checkCall(binding, call);
  if (!check.ok) {
    console.error(`${logTag}: the resolved request of ${step.key} was refused before dispatch (${check.reason}: ${check.issues.join(', ')})`);
    const run = await settleStep(ctx, step, action, { status: 'failed', code: 'agent_harness_error' });
    auditStep(ctx, step, run);
    return { run };
  }

  // d3. What the reversal will need and the answer will not say (the version a pin pinned before it moves). A read that fails
  // stores nothing: the write still runs, and the reversal then reports the missing fact instead of guessing.
  let before: Json | null = null;
  if (ctx.deps.beforeState) {
    try {
      before = await ctx.deps.beforeState({ step: { key: step.key, op: step.op }, call: { params: call.params, body: call.body } });
    } catch (error) {
      console.error(`${logTag}: the before-state read failed for ${step.key}`, error);
    }
  }
  const extra = { call, before };

  // e. Dispatch as the verified session. `invokeRoute` never rejects. A route that takes no body is sent none.
  const outcome = await invokeRoute(
    binding,
    { params: call.params, query: call.query, body: binding.bodySchema === null ? undefined : call.body },
    dispatchContextOf(ctx, step),
  );

  // f. Outcome to step state.
  let run: StepRun;
  if (outcome.kind === 'ok') {
    const verdict = await verifyStep(ctx, step, binding, call, outcome);
    if (verdict.status === 'confirmed') {
      const result = extractStepResult(step.op, outcome.data) ?? extractStepResult(step.op, verdict.detail ?? {});
      run = await settleStep(ctx, step, action, { status: 'ok', outcome, result, verify: { status: verdict.status, ...(verdict.detail ?? {}) } as Json, ...extra });
    } else if (verdict.status === 'failed') {
      const result = extractStepResult(step.op, outcome.data) ?? extractStepResult(step.op, verdict.detail ?? {});
      run = await settleStep(ctx, step, action, { status: 'failed', code: verdict.code ?? 'step_failed', outcome, result, verify: { status: verdict.status, ...(verdict.detail ?? {}) } as Json, ...extra });
    } else {
      // The route said 2xx and the read-back cannot find it: unknown, to be reconciled by a resume.
      const code = verdict.ambiguous ? 'reconcile_ambiguous' : 'unknown_outcome';
      run = await settleStep(ctx, step, action, { status: 'unknown', code, outcome, verify: { status: verdict.status, ...(verdict.detail ?? {}) } as Json, ...extra });
    }
  } else if (isUnknownOutcome(outcome)) {
    // A masked 500, a 504 or a step timeout: the write may have committed (or still be running). Read it back; adopt it
    // if it is there; otherwise it stays unknown. Never retried in this request.
    const verdict = await reconcile(ctx, step, binding, call, outcome, true);
    run = await concludeReconcile(ctx, step, action, verdict, outcome, extra);
    return { run };
  } else {
    // A Go-live write the route refused with a conflict may still have done part of its work (a pin move stops at the first pin
    // that moved meanwhile and keeps the moves before it). The binding's read-back says how far it got; it is recorded beside the
    // failure and changes neither the status nor the code.
    let verify: Json | undefined;
    if (binding.class === 'G' && outcome.kind === 'conflict') {
      const verdict = await verifyStep(ctx, step, binding, call, outcome);
      verify = { status: verdict.status, ...(verdict.detail ?? {}) } as Json;
    }
    run = await settleStep(ctx, step, action, { status: 'failed', code: outcomeCode(outcome) ?? 'step_failed', outcome, ...(verify !== undefined ? { verify } : {}), ...extra });
  }
  auditStep(ctx, step, run);
  return { run };
}

/** Runs one step. Returns its state and, when it ends the run, why. */
async function runStep(ctx: RunContext, step: StoredStep): Promise<{ run: StepRun; stop?: StopReason }> {
  const existing = ctx.ledger.get(step.key);
  if (existing !== undefined) {
    const run = await adoptRow(ctx, step, existing);
    return { run, ...(run.status === 'ok' ? {} : { stop: run.status === 'unknown' ? ('unknown' as const) : ('failed' as const) }) };
  }
  if (nowMs(ctx) - ctx.startedAt >= STEP_DEADLINE_MS) return { run: { status: 'pending' }, stop: 'deadline' };

  // The proposal still has to be the one this request is running: the reaper may have taken it (a request that outlived the
  // reaper's age) and the conversation's slot is free for another claim, so a write dispatched now would run unowned. An unreadable
  // status counts as no answer: nothing new starts and the Build stays open for a resume.
  try {
    const current = await ctx.deps.store.proposals.getProposal(ctx.input.adminId, ctx.proposal.id);
    if (current === null || current.status !== 'executing') return { run: { status: 'pending' }, stop: 'reaped' };
  } catch (error) {
    console.error(`${logTag}: the proposal status could not be read before ${step.key}`, error);
    return { run: { status: 'pending' }, stop: 'deadline' };
  }

  // a. A dependency that is not `ok`.
  if (step.blocked_by.some((key) => ctx.runs.get(key)?.status !== 'ok')) return { run: await recordSkipped(ctx, step, 'step_failed'), stop: 'failed' };

  const binding = ctx.deps.bindings.get(step.op);
  if (binding === undefined) return { run: { status: 'failed', code: 'agent_harness_error' }, stop: 'failed' };

  // b. The ledger row first, awaited: no ledger, no write.
  let action: ActionRecord | undefined;
  try {
    const inserted = await ctx.deps.store.actions.insertAction(ctx.input.adminId, ledgerInput(ctx.proposal, step));
    if (inserted.inserted) action = inserted.action;
    else {
      // The key is taken: this step was dispatched before (a racing request). Continue from its row.
      const rows = await ctx.deps.store.actions.listProposalActions(ctx.input.adminId, ctx.proposal.id);
      const row = rows.find((candidate) => candidate.step_key === step.key);
      if (row === undefined) throw new Error('the step key is taken but its row cannot be read');
      const run = await adoptRow(ctx, step, row);
      return { run, ...(run.status === 'ok' ? {} : { stop: run.status === 'unknown' ? ('unknown' as const) : ('failed' as const) }) };
    }
  } catch (error) {
    console.error(`${logTag}: the ledger row of ${step.key} could not be written; nothing was dispatched`, error);
    return { run: { status: 'failed', code: 'ledger_unavailable' }, stop: 'failed' };
  }

  const { run, stale } = await dispatchStep(ctx, step, binding, action);
  if (stale) return { run, stop: 'stale' };
  if (run.status === 'ok') return { run };
  return { run, stop: run.status === 'unknown' ? 'unknown' : 'failed' };
}

// ─── The proposal ────────────────────────────────────────────────────────────

function summarize(steps: readonly StoredStep[], runs: ReadonlyMap<string, StepRun>): StepSummary[] {
  return steps.map((step) => {
    const run = runs.get(step.key);
    return {
      key: step.key,
      status: run?.status ?? 'pending',
      ...(run?.code !== undefined ? { code: run.code } : {}),
      ...(run?.entityId !== undefined ? { entity_id: run.entityId } : {}),
    };
  });
}

function finalStatusOf(proposal: ProposalRecord, summaries: readonly StepSummary[], stop: StopReason | null): ProposalResult['status'] {
  const count = (status: StepResultStatus) => summaries.filter((step) => step.status === status).length;
  if (stop === 'stale') return 'stale';
  if (stop === 'reaped') return 'unknown';
  // A write that may have happened: a Build stays open so the admin's Resume reconciles it; a Go-live proposal ends `unknown`.
  if (count('unknown') > 0) return proposal.class === 'G' ? 'unknown' : 'executing';
  if (count('failed') > 0 || count('skipped') > 0) return count('ok') > 0 ? 'partial' : 'failed';
  if (count('pending') > 0) return 'executing';
  return 'completed';
}

/**
 * An undo marks the ledger rows it reversed `undone`: a row whose steps all ended `ok` (a roster add has one step per player;
 * a partly removed roster stays `ok`). The row named by the step key must be this admin's, of this conversation and `ok`.
 * Best effort: the entities are changed either way, and a row left `ok` only means a second undo finds its fingerprint changed.
 */
async function markUndone(ctx: RunContext, summaries: readonly StepSummary[]): Promise<void> {
  const byRow = new Map<string, StepResultStatus[]>();
  for (const summary of summaries) {
    const row = UNDO_KEY.exec(summary.key)?.[1];
    if (row !== undefined) byRow.set(row, [...(byRow.get(row) ?? []), summary.status]);
  }
  for (const [rowId, statuses] of byRow) {
    if (!statuses.every((status) => status === 'ok')) continue;
    try {
      const forward = await ctx.deps.store.actions.getAction(ctx.input.adminId, rowId);
      if (forward === null || forward.conversation_id !== ctx.proposal.conversation_id || forward.status !== 'ok') continue;
      await ctx.deps.store.actions.completeAction(ctx.input.adminId, forward.id, { status: 'undone' });
    } catch (error) {
      console.error(`${logTag}: could not mark the ledger row ${rowId} undone`, error);
    }
  }
}

async function announce(deps: ExecutorDeps, adminId: AdminId, proposal: ProposalRecord, result: ProposalResult): Promise<void> {
  try {
    await deps.recordEvent(adminId, proposal.conversation_id, RESULT_EVENT, {
      proposal_id: result.proposal_id,
      plan_code: result.plan_code,
      status: result.status,
      steps: result.steps as unknown as Json,
    });
  } catch (error) {
    // The status is the record; the next turn's state refresh lists the proposals again.
    console.error(`${logTag}: could not record the result for the model`, error);
  }
}

/** Ends a claimed proposal that cannot run, tells the conversation, and answers the refusal. */
async function refuseClaimed(deps: ExecutorDeps, input: ExecuteInput, proposal: ProposalRecord, steps: readonly StoredStep[] | null, refusal: Refusal): Promise<never> {
  try {
    await deps.store.proposals.finishProposal(input.adminId, proposal.id, 'stale');
  } catch (error) {
    console.error(`${logTag}: could not finish the stale proposal`, error);
  }
  await announce(deps, input.adminId, proposal, {
    kind: 'proposal_result',
    proposal_id: proposal.id,
    plan_code: planCode(proposal.proposal_hash),
    status: 'stale',
    steps: (steps ?? []).map((step) => ({ key: step.key, status: 'pending' as const })),
  });
  throw refuse(refusal.code, refusal.reason);
}

/**
 * Approves (claims and runs) or resumes a proposal. Throws a catalogued refusal before anything runs or after the claim
 * finished the proposal `stale`; otherwise answers the structured result, whatever the steps did.
 */
export async function executeProposal(deps: ExecutorDeps, input: ExecuteInput): Promise<ProposalResult> {
  const startedAt = deps.now().getTime();
  const { store } = deps;

  // 1. The proposal is this admin's (another admin's is 404), then the live checks, before anything is claimed.
  let proposal = await store.proposals.getProposalOrThrow(input.adminId, input.proposalId);
  const preSteps = stepsOf(proposal);
  await assertEligible(deps, input, proposal, preSteps);

  // 2. The reaper (this admin's overdue executions), then the atomic claim: the single statement that makes a replay impossible.
  if (input.mode === 'approve') {
    await reapOverdueProposals({ proposals: deps.store.proposals, recordEvent: deps.recordEvent, now: deps.now }, input.adminId);
    proposal = await store.proposals.claimProposal(input.adminId, proposal.id, {
      tokenHash: approvalTokenHash(input.approval.token),
      ipHash: input.approval.ipHash ?? null,
      userAgent: input.approval.userAgent ?? null,
    });
    try {
      deps.audit({
        actor_id: input.adminId,
        actor_name: input.adminName,
        action: 'agent.approve',
        resource_type: 'agent_proposal',
        resource_id: proposal.id,
        metadata: { via: 'agent', agent_conversation_id: proposal.conversation_id, agent_proposal_id: proposal.id, plan_code: planCode(proposal.proposal_hash), class: proposal.class },
      });
    } catch (error) {
      console.error(`${logTag}: audit event not written`, error);
    }
  }

  // 3. The recheck after the claim: a failed check consumes the proposal.
  const steps = stepsOf(proposal);
  const refusal = await recheck(deps, input, proposal, steps).catch((error: unknown): Refusal => {
    console.error(`${logTag}: the recheck could not run`, error);
    return { code: 'proposal_stale', reason: 'recheck_failed' };
  });
  if (refusal !== null || steps === null) return refuseClaimed(deps, input, proposal, steps, refusal ?? { code: 'proposal_stale', reason: 'steps_unreadable' });

  // The blast-radius counters count claims; a resume is the same claim.
  if (input.mode === 'approve') {
    const claims = blastClaims(proposal, steps, deps.config().caps);
    if (claims.length > 0) {
      const claimed = await store.conversations.claimBudget(input.adminId, proposal.conversation_id, claims);
      if (!claimed.ok) {
        console.error(`${logTag}: blast-radius counter ${claimed.counter} is at its cap`);
        await store.proposals.finishProposal(input.adminId, proposal.id, 'failed').catch((error: unknown) => console.error(`${logTag}: could not finish the proposal`, error));
        await announce(deps, input.adminId, proposal, {
          kind: 'proposal_result',
          proposal_id: proposal.id,
          plan_code: planCode(proposal.proposal_hash),
          status: 'failed',
          steps: steps.map((step) => ({ key: step.key, status: 'pending' as const, code: 'agent_cap_reached' })),
        });
        throw new AdminAgentStoreError('agent_cap_reached', { limit: claimed.cap });
      }
    }
  }

  // 4. The steps.
  const ledger = new Map<string, ActionRecord>();
  for (const row of await store.actions.listProposalActions(input.adminId, proposal.id)) if (row.step_key !== null) ledger.set(row.step_key, row);
  const ctx: RunContext = { deps, input, proposal, steps, runs: new Map(), ledger, startedAt };

  let stop: StopReason | null = null;
  for (const step of steps) {
    if (stop !== null) {
      // After a failure or a stale precondition nothing else will run: the rest is recorded. After an unknown outcome or the
      // deadline a Build keeps them pending for the Resume; a Go-live proposal never resumes.
      if (stop === 'reaped') ctx.runs.set(step.key, { status: 'pending' });
      else if (stop === 'failed' || stop === 'stale' || proposal.class === 'G') ctx.runs.set(step.key, await recordSkipped(ctx, step));
      continue;
    }
    const { run, stop: reason } = await runStep(ctx, step);
    ctx.runs.set(step.key, run);
    if (reason !== undefined) stop = reason;
  }

  // 5. The end of the proposal and the event the model learns it from.
  const summaries = summarize(steps, ctx.runs);
  if (proposal.kind === 'undo') await markUndone(ctx, summaries);
  const status = finalStatusOf(proposal, summaries, stop);
  // A reaped proposal was already ended by the reaper (and the conversation told); finishing it again would only fail.
  if (status !== 'executing' && stop !== 'reaped') {
    try {
      await store.proposals.finishProposal(input.adminId, proposal.id, status);
    } catch (error) {
      // The reaper got there first; the ledger holds the truth either way.
      console.error(`${logTag}: could not finish the proposal`, error);
    }
  }
  const result: ProposalResult = { kind: 'proposal_result', proposal_id: proposal.id, plan_code: planCode(proposal.proposal_hash), status, steps: summaries };
  await announce(deps, input.adminId, proposal, result);
  return result;
}
