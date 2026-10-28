/**
 * Test harness for the executor: a REAL staged Build (the plan 4.10 worked example through the real stager, so the hashes,
 * the token and the stored steps are exactly what staging writes), an in-memory store with the semantics the executor
 * relies on (the atomic claim, the executing-proposal index, the unique ledger key), fake route bindings whose handlers
 * record what they were called with, and recorders for events, audit entries and the settle wait. Nothing reaches a
 * database or the network.
 *
 * A test file that imports this must `vi.mock('@/auth', ...)` first (the staging code comes through the guard module).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { vi, type Mock } from 'vitest';
import { z } from 'zod';
import { auth } from '@/auth';
import { getAgentAuditContext, type AgentAuditContext } from '@/lib/audit/agent-context';
import { authAndRecord } from '@/lib/auth/session-override';
import type { AuditLogEntry } from '@/lib/audit/log';
import { createBindingRegistry } from '../../dispatch';
import type { BindingPhase, RouteBinding, VerifyResult } from '../../dispatch';
import { parseAdminAgentEnv } from '../../env';
import { uid } from '../../plans/__tests__/fixtures';
import { computePreviewHash, computeProposalHash } from '../../plans/hash';
import type { JsonValue } from '@/lib/studio-core/json';
import { AdminAgentStoreError } from '../../store/errors';
import type { ActionRecord, ConversationRecord, Json, NewAction, ProposalRecord } from '../../store/types';
import { BUILD_OP_ROUTES } from '../build';
import { proposalCardSchema } from '../card';
import { preconditionsHash } from '../fingerprints';
import { executeProposal, type ExecuteInput, type ExecutorDeps, type ExecutorStore, type ProposalResult } from '../executor';
import { approvalTokenHash, deriveApprovalToken } from '../token';
import { sealStep, type StoredStep } from '../steps';
import type { StageStaged } from '../types';
import { ADMIN, CONVERSATION_ID, NOW, TOKEN_SECRET, makeHarness, seeWorkedExample, type MemoryProposal } from './helpers';

export const LEAGUE_ID = uid(7001);
export const RULESET_ID = uid(7002);
export const PHASE_IDS = { regular_season: uid(7101), playoffs: uid(7102) } as const;

// ─── The store ───────────────────────────────────────────────────────────────

export class ExecStore {
  actions: ActionRecord[] = [];
  /** Every call that changed state, in order: `claim`, `insert:<key>`, `complete:<key>:<status>`, `finish:<status>`, `reap`. */
  log: string[] = [];
  budgetClaims: Array<ReadonlyArray<{ counter: string; amount: number; cap: number }>> = [];
  budgetExceeded: { counter: string; value: number; cap: number } | null = null;
  /** Make the ledger insert of this step key (or of every step, `'*'`) fail with a database error. */
  failInsert: string | null = null;
  failComplete = false;
  conversation: ConversationRecord = {
    id: CONVERSATION_ID,
    admin_id: ADMIN,
    admin_name: 'Test Admin',
    tool_set: 'site',
    tool_registry_version: 'abcdef0123456789',
    ui_locale: 'en',
  } as unknown as ConversationRecord;
  private next = 0;

  constructor(
    readonly rows: MemoryProposal[],
    readonly now: () => Date,
  ) {}

  /** The stored proposal row (the live one, not a copy), for tests that tamper with it. */
  row(id: string): MemoryProposal {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error('no such proposal row');
    return row;
  }

  private static view(row: MemoryProposal): ProposalRecord {
    const { token_hash: _hidden, ...record } = row;
    return structuredClone(record) as ProposalRecord;
  }

  proposals: ExecutorStore['proposals'] = {
    getProposalOrThrow: async (adminId, proposalId) => {
      const row = this.rows.find((candidate) => candidate.id === proposalId && candidate.admin_id === adminId);
      if (row === undefined) throw new AdminAgentStoreError('proposal_not_found');
      return ExecStore.view(row);
    },
    getProposal: async (adminId, proposalId) => {
      const row = this.rows.find((candidate) => candidate.id === proposalId && candidate.admin_id === adminId);
      return row === undefined ? null : ExecStore.view(row);
    },
    claimProposal: async (adminId, proposalId, claim) => {
      const row = this.rows.find((candidate) => candidate.id === proposalId && candidate.admin_id === adminId);
      if (row === undefined) throw new AdminAgentStoreError('proposal_not_found');
      if (row.status !== 'proposed') throw new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: row.status } });
      if (row.token_hash !== claim.tokenHash) throw new AdminAgentStoreError('proposal_token_invalid');
      if (new Date(row.expires_at).getTime() <= this.now().getTime()) throw new AdminAgentStoreError('proposal_expired');
      if (this.rows.some((other) => other.conversation_id === row.conversation_id && other.status === 'executing')) throw new AdminAgentStoreError('proposal_conflict_executing');
      row.status = 'executing';
      row.approved_by = adminId;
      row.approved_at = this.now().toISOString();
      row.executing_started_at = this.now().toISOString();
      this.log.push('claim');
      return ExecStore.view(row);
    },
    finishProposal: async (adminId, proposalId, status) => {
      const row = this.rows.find((candidate) => candidate.id === proposalId && candidate.admin_id === adminId);
      if (row === undefined) throw new AdminAgentStoreError('proposal_not_found');
      if (row.status !== 'executing') throw new AdminAgentStoreError('proposal_not_pending', undefined, { detail: { status: row.status } });
      row.status = status;
      row.finished_at = this.now().toISOString();
      this.log.push(`finish:${status}`);
      return ExecStore.view(row);
    },
    reapExecutingProposals: async (adminId, olderThan) => {
      const reaped = this.rows.filter(
        (row) => row.admin_id === adminId && row.status === 'executing' && row.executing_started_at !== null && new Date(row.executing_started_at) < olderThan,
      );
      for (const row of reaped) {
        row.status = 'unknown';
        row.finished_at = this.now().toISOString();
      }
      if (reaped.length > 0) this.log.push('reap');
      return reaped.map((row) => row.id);
    },
  };

  actionsApi: ExecutorStore['actions'] = {
    insertAction: async (adminId, input: NewAction) => {
      const key = input.stepKey ?? '';
      if (this.failInsert === '*' || this.failInsert === key) throw new Error('insert failed: connection reset (secret detail)');
      if (this.actions.some((row) => row.proposal_id === input.proposalId && row.step_key === input.stepKey)) return { inserted: false };
      const action = {
        id: uid(60000 + this.next++),
        conversation_id: input.conversationId,
        admin_id: adminId,
        admin_name: 'Test Admin',
        created_at: this.now().toISOString(),
        tool_use_id: null,
        tool_name: input.toolName,
        class: input.class,
        proposal_id: input.proposalId ?? null,
        step_key: input.stepKey ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        args: input.args,
        args_hash: input.argsHash,
        status: 'executing',
        http_status: null,
        outcome_kind: null,
        error_code: null,
        result: null,
        before: null,
        after: null,
        after_fingerprint: null,
        undo: null,
        reversibility: null,
        verify: null,
        entity_type: null,
        entity_id: null,
      } as ActionRecord;
      this.actions.push(action);
      this.log.push(`insert:${key}`);
      return { inserted: true, action: structuredClone(action) };
    },
    completeAction: async (_adminId, actionId, outcome) => {
      if (this.failComplete) throw new Error('update failed (secret detail)');
      const row = this.actions.find((candidate) => candidate.id === actionId);
      if (row === undefined) throw new Error('no such ledger row');
      if (outcome.status !== undefined) row.status = outcome.status;
      if (outcome.httpStatus !== undefined) row.http_status = outcome.httpStatus;
      if (outcome.outcomeKind !== undefined) row.outcome_kind = outcome.outcomeKind;
      if (outcome.errorCode !== undefined) row.error_code = outcome.errorCode;
      if (outcome.result !== undefined) row.result = outcome.result;
      if (outcome.afterFingerprint !== undefined) row.after_fingerprint = outcome.afterFingerprint;
      if (outcome.reversibility !== undefined) row.reversibility = outcome.reversibility;
      if (outcome.verify !== undefined) row.verify = outcome.verify;
      if (outcome.entityType !== undefined) row.entity_type = outcome.entityType;
      if (outcome.entityId !== undefined) row.entity_id = outcome.entityId;
      this.log.push(`complete:${row.step_key}:${row.status}`);
      return structuredClone(row);
    },
    listProposalActions: async (_adminId, proposalId) => this.actions.filter((row) => row.proposal_id === proposalId).map((row) => structuredClone(row)),
  };

  conversations: ExecutorStore['conversations'] = {
    getConversation: async (_adminId, conversationId) => (conversationId === this.conversation.id ? structuredClone(this.conversation) : null),
    claimBudget: async (_adminId, _conversationId, claims) => {
      this.budgetClaims.push(claims.map((claim) => ({ counter: claim.counter, amount: claim.amount, cap: claim.cap })));
      return this.budgetExceeded === null ? { ok: true } : { ok: false, ...this.budgetExceeded };
    },
  };

  /** The `ExecutorStore` shape. */
  asStore(): ExecutorStore {
    return { proposals: this.proposals, actions: this.actionsApi, conversations: this.conversations };
  }

  /** The ledger row of a step. */
  action(stepKey: string): ActionRecord | undefined {
    return this.actions.find((row) => row.step_key === stepKey);
  }
}

// ─── Fake routes ─────────────────────────────────────────────────────────────

export interface RouteCall {
  readonly op: string;
  readonly params: Record<string, string>;
  readonly body: unknown;
  readonly query: string;
  readonly forwardedFor: string | null;
  readonly cookie: string | null;
  /** The agent audit context the handler ran inside. */
  readonly audit: AgentAuditContext | undefined;
}

type Reply = Response | Promise<Response>;
export type RouteScript = (call: RouteCall, index: number) => Reply;

const json = (status: number, body: unknown): Response => NextResponse.json(body, { status });

/** The happy-path answer of each Build op. */
export function okReply(op: string, call: RouteCall): Response {
  switch (op) {
    case 'league_create':
      return json(201, { success: true, data: { id: LEAGUE_ID, name: 'Gen 9 OU League', ruleset_id: RULESET_ID } });
    case 'roster_add':
      return json(201, { success: true, data: null });
    default: {
      const key = typeof call.body === 'object' && call.body !== null && 'name' in call.body && (call.body as { name: string }).name === 'Playoffs' ? 'playoffs' : 'regular_season';
      return json(201, { success: true, data: { id: PHASE_IDS[key] } });
    }
  }
}

export interface World {
  readonly store: ExecStore;
  readonly calls: RouteCall[];
  readonly events: Array<{ conversationId: string; event: string; data: Record<string, Json | undefined> }>;
  readonly audits: AuditLogEntry[];
  readonly sleeps: number[];
  readonly verifies: Array<{ op: string; outcomeKind: string }>;
  readonly deps: ExecutorDeps;
  readonly proposalId: string;
  readonly token: string;
  readonly row: MemoryProposal;
  readonly steps: StoredStep[];
  readonly harness: ReturnType<typeof makeHarness>;
  /** The fake clock; advance it to move past an expiry, the deadline or the resume window. */
  clock: { ms: number };
  rateLimit: Mock<ExecutorDeps['rateLimit']>;
  /** Replace the answer of an op (a number of times or for ever). */
  script: Partial<Record<string, RouteScript>>;
  /** What each op's `verify` answers (default: confirmed, with the ids the happy path creates). */
  verify: Partial<Record<string, (call: unknown, outcomeKind: string) => VerifyResult | Promise<VerifyResult>>>;
  /** Binding overrides per op (class, phase, timeoutMs, ...). */
  bindingOverrides: Partial<Record<string, Partial<RouteBinding>>>;
  /** Ops left out of the registry. */
  omit: Set<string>;
  configEnv: Record<string, string>;
  registryVersion: string;
  input(overrides?: Partial<Extract<ExecuteInput, { mode: 'approve' }>>): Promise<Extract<ExecuteInput, { mode: 'approve' }>>;
  resumeInput(overrides?: Partial<Extract<ExecuteInput, { mode: 'resume' }>>): Promise<Extract<ExecuteInput, { mode: 'resume' }>>;
  /** Builds the deps from the current scripts and runs it. */
  run(input: ExecuteInput): Promise<ProposalResult>;
  approve(overrides?: Partial<Extract<ExecuteInput, { mode: 'approve' }>>): Promise<ProposalResult>;
  resume(overrides?: Partial<Extract<ExecuteInput, { mode: 'resume' }>>): Promise<ProposalResult>;
  calledOps(): string[];
}

const GOOD_VERIFY = (op: string): VerifyResult => {
  switch (op) {
    case 'league_create':
      return { status: 'confirmed', detail: { id: LEAGUE_ID, ruleset_id: RULESET_ID } };
    case 'phase_create':
      return { status: 'confirmed', detail: { id: PHASE_IDS.regular_season } };
    default:
      return { status: 'confirmed' };
  }
};

/** A session the way the approve route gets one (recorded by the wrapped `auth()`). */
export async function recordedSession(): Promise<Session> {
  vi.mocked(auth as unknown as () => Promise<Session | null>).mockResolvedValueOnce({
    user: { id: ADMIN, name: 'Test Admin', email: 'admin@example.com', image: null },
    player: null,
    expires: '2099-01-01T00:00:00.000Z',
  } as Session);
  const session = await authAndRecord();
  if (session === null) throw new Error('expected a session');
  return session;
}

/**
 * Stages the worked example through the real stager and wraps it for the executor. `phase` is the ADMIN_AGENT_MAX_PHASE the
 * executor runs under (the fake bindings are phase 1).
 */
export async function makeWorld(options: { phase?: number } = {}): Promise<World> {
  const harness = makeHarness();
  seeWorkedExample(harness);
  const staged = (await harness.stage('propose_build', { plan_revision: 1 })) as StageStaged;
  if (staged.status !== 'staged') throw new Error(`staging refused: ${JSON.stringify(staged)}`);

  const clock = { ms: NOW.getTime() };
  const now = () => new Date(clock.ms);
  const rows = harness.store.proposals;
  const row = rows.find((candidate) => candidate.id === staged.proposal_id) as MemoryProposal;
  const store = new ExecStore(rows, now);
  const token = deriveApprovalToken(TOKEN_SECRET, staged.proposal_id, ADMIN);
  if (approvalTokenHash(token) !== row.token_hash) throw new Error('the staged token hash does not match the derived token');

  const calls: RouteCall[] = [];
  const events: World['events'] = [];
  const audits: AuditLogEntry[] = [];
  const sleeps: number[] = [];
  const verifies: World['verifies'] = [];
  const counters = new Map<string, number>();

  const world: World = {
    store,
    calls,
    events,
    audits,
    sleeps,
    verifies,
    proposalId: staged.proposal_id,
    token,
    row,
    steps: row.steps as unknown as StoredStep[],
    harness,
    clock,
    rateLimit: vi.fn<ExecutorDeps['rateLimit']>(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    script: {},
    verify: {},
    bindingOverrides: {},
    omit: new Set(),
    configEnv: { ADMIN_AGENT_ENABLED: '1', ADMIN_AGENT_GOLIVE: '1', ADMIN_AGENT_MAX_PHASE: String(options.phase ?? 1) },
    registryVersion: 'abcdef0123456789',
    get deps(): ExecutorDeps {
      const bindings = (Object.keys(BUILD_OP_ROUTES) as Array<keyof typeof BUILD_OP_ROUTES>)
        .filter((op) => !world.omit.has(op) && world.steps.some((step) => step.op === op))
        .map((op): RouteBinding => {
          const route = BUILD_OP_ROUTES[op];
          const handler = async (request: NextRequest, context: { params: Promise<Record<string, string>> }): Promise<Response> => {
            const index = counters.get(op) ?? 0;
            counters.set(op, index + 1);
            const text = await request.text();
            const call: RouteCall = {
              op,
              params: await context.params,
              body: text === '' ? undefined : (JSON.parse(text) as unknown),
              query: new URL(request.url).search,
              forwardedFor: request.headers.get('x-forwarded-for'),
              cookie: request.headers.get('cookie'),
              audit: getAgentAuditContext(),
            };
            calls.push(call);
            store.log.push(`dispatch:${op}`);
            const scripted = world.script[op];
            return scripted ? scripted(call, index) : okReply(op, call);
          };
          return {
            operation: op,
            method: route.method,
            path: route.routeTemplate,
            class: 'B',
            phase: 1 as BindingPhase,
            load: async () => ({ [route.method]: handler }),
            reversal: { kind: 'none' },
            // Loose on purpose: the executor's own checks are tested here; the real strict schemas are the bindings' tests.
            bodySchema: z.looseObject({}),
            ...(route.routeTemplate.includes('[') ? { paramsSchema: z.looseObject({}) } : {}),
            verify: async (call, outcome) => {
              verifies.push({ op, outcomeKind: outcome.kind });
              const custom = world.verify[op];
              return custom ? custom(call, outcome.kind) : GOOD_VERIFY(op);
            },
            ...(world.bindingOverrides[op] ?? {}),
          } as RouteBinding;
        });
      return {
        store: store.asStore(),
        bindings: createBindingRegistry(bindings),
        fingerprints: harness.world,
        config: () => parseAdminAgentEnv(world.configEnv),
        registryVersion: () => world.registryVersion,
        rateLimit: world.rateLimit,
        recordEvent: async (_adminId, conversationId, event, data) => {
          events.push({ conversationId, event, data: { ...data } });
        },
        audit: (entry) => {
          audits.push(entry);
        },
        now,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      };
    },
    async input(overrides = {}) {
      return {
        mode: 'approve',
        adminId: ADMIN,
        adminName: 'Test Admin',
        isSiteAdmin: true,
        session: await recordedSession(),
        inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '203.0.113.7', cookie: 'authjs.session-token=must-not-travel' }) },
        proposalId: staged.proposal_id,
        approval: { token, proposalHash: row.proposal_hash, previewHash: row.preview_hash, acks: ['visible_publicly'] },
        ...overrides,
      };
    },
    async resumeInput(overrides = {}) {
      return {
        mode: 'resume',
        adminId: ADMIN,
        adminName: 'Test Admin',
        isSiteAdmin: true,
        session: await recordedSession(),
        inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) },
        proposalId: staged.proposal_id,
        ...overrides,
      };
    },
    run: (input) => executeProposal(world.deps, input),
    approve: async (overrides) => world.run(await world.input(overrides)),
    resume: async (overrides) => world.run(await world.resumeInput(overrides)),
    calledOps: () => calls.map((call) => call.op),
  };
  return world;
}

/** The statuses of a result, `key:status`, in step order. */
export const statusesOf = (result: ProposalResult): string[] => result.steps.map((step) => `${step.key}:${step.status}`);

/** The message of every thrown value, for "no err.message reaches a response" checks. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

/**
 * Edits the stored steps and puts the hashes back in line (`args_hash` of each step, `proposal_hash`, the plan code inside
 * the card and `preview_hash`), so a test can change a field the hashes do not cover (a `blocked_by`, a class, a precondition)
 * without tripping the hash check. A test that WANTS the hash check to fire edits `world.steps` without calling this.
 */
export function reseal(world: World, edit: (steps: StoredStep[]) => void, proposalEdit?: (row: MemoryProposal) => void): void {
  const { row } = world;
  edit(world.steps);
  proposalEdit?.(row);
  const ids = { adminId: ADMIN, conversationId: CONVERSATION_ID, proposalId: world.proposalId };
  world.steps.forEach((step, index) => {
    const { args_hash: _old, ...draft } = step;
    world.steps[index] = sealStep(draft, ids);
  });
  const acks = Array.isArray(row.acks_required) ? (row.acks_required as string[]) : [];
  row.proposal_hash = computeProposalHash({
    stepArgsHashes: world.steps.map((step) => step.args_hash),
    preconditionsHash: preconditionsHash(world.steps.map((step) => step.preconditions as never)),
    acksRequired: acks,
  });
  const card = proposalCardSchema.parse(row.preview);
  card.planCode = row.proposal_hash.slice(0, 8);
  row.preview = card as never;
  row.preview_hash = computePreviewHash({
    preview: card as unknown as JsonValue,
    outwardEffects: card.outwardEffects as unknown as JsonValue,
    targets: card.steps.map((step) => ({ target: step.target, items: step.items })) as unknown as JsonValue,
    locale: row.locale,
  });
}
