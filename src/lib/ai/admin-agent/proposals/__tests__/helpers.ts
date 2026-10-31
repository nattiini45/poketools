/**
 * Test harness for the staging code: an in-memory store with the semantics staging relies on (the pending cap, superseding
 * by key, ownership by admin), scripted live reads, recording guards and a fixed clock. Nothing here reaches a database.
 *
 * A test file that imports this must `vi.mock('@/auth', ...)` first, like the registry tests: the real tool definitions
 * (`STAGED_TOOLS`) come through the guard module.
 */
import { vi } from 'vitest';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { parseAdminAgentEnv } from '../../env';
import { okFacts, PLAYERS, RULESET_VERSION, uid, workedExample } from '../../plans/__tests__/fixtures';
import type { PlanDocument } from '../../plans/schema';
import { STAGED_TOOLS } from '../../registry/staged';
import { AdminAgentStoreError } from '../../store/errors';
import { adminIdOf } from '../../store/ids';
import type { ActionRecord, PlanRecord, ProposalRecord } from '../../store/types';
import { createProposalStager } from '../stage';
import { newTurnStaging } from '../turn';
import type { FingerprintSource } from '../fingerprints';
import type { PhaseStartFact, PinTargetFact, RulesetDraftFact, StageInput, StagerDeps, StagingAdmin, StagingConversation, StagingSource } from '../types';

export const NOW = new Date('2026-10-27T12:00:00.000Z');
export const ADMIN = adminIdOf(uid(1));
export const OTHER_ADMIN = adminIdOf(uid(2));
export const CONVERSATION_ID = uid(500);
export const PLAN_ID = uid(600);
export const DEFINITION_ID = uid(700);
export const TOURNAMENT_ID = uid(710);
export const SEASON_ID = uid(720);
export const TOKEN_SECRET = 'test-secret-with-enough-length-0123456789';

interface StageArgs {
  id?: string;
  conversationId: string;
  kind: string;
  class: string;
  planId?: string | null;
  planRevision?: number | null;
  toolRegistryVersion: string;
  steps: unknown;
  proposalHash: string;
  preview: unknown;
  previewHash: string;
  tokenHash: string;
  acksRequired?: unknown;
  expiresAt: Date;
  supersedeKey?: string | null;
  locale: string;
  maxPending?: number;
}

export interface MemoryProposal extends ProposalRecord {
  token_hash: string;
}

/** The slice of the store `StagerDeps` uses, in memory. */
export class MemoryStore {
  proposals: MemoryProposal[] = [];
  known = new Map<string, Set<string>>();
  actions: ActionRecord[] = [];
  plan: PlanRecord | null = null;
  recorded: Array<{ kind: string; id: string }> = [];
  /** The previous drafts kept for the draft-save undo, by ledger row id. */
  snapshots = new Map<string, { document: unknown; doc_hash: string }>();

  /** Ids this conversation has seen (provenance). */
  see(conversationId: string, ...ids: string[]): void {
    const set = this.known.get(conversationId) ?? new Set<string>();
    for (const id of ids) set.add(id.toLowerCase());
    this.known.set(conversationId, set);
  }

  setPlan(doc: PlanDocument, overrides: Partial<PlanRecord> = {}): void {
    this.plan = {
      id: PLAN_ID,
      conversation_id: CONVERSATION_ID,
      admin_id: ADMIN,
      mode: 'create',
      status: 'ready',
      revision: 1,
      doc: doc as unknown as PlanRecord['doc'],
      doc_hash: 'a'.repeat(64),
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      ...overrides,
    } as PlanRecord;
  }

  asStore(): StagerDeps['store'] {
    return {
      plans: {
        getActivePlan: async (adminId: string) => (this.plan !== null && this.plan.admin_id === adminId ? this.plan : null),
      },
      refs: {
        knownRefIds: async (_admin: string, conversationId: string, ids: readonly string[]) => {
          const seen = this.known.get(conversationId) ?? new Set<string>();
          return new Set(ids.map((id) => id.toLowerCase()).filter((id) => seen.has(id)));
        },
        recordRefs: async (_admin: string, _conversation: string, refs: ReadonlyArray<{ kind: string; id: string }>) => {
          this.recorded.push(...refs.map((ref) => ({ kind: ref.kind, id: ref.id })));
          return refs.length;
        },
      },
      snapshots: {
        getSnapshot: async (_admin: string, actionId: string) => this.snapshots.get(actionId) ?? null,
      },
      actions: {
        // Honours the filters the real store applies, so a call that drops one is caught by the tests that use it.
        listActions: async (admin: string, conversationId: string, limit = 200) =>
          this.actions.filter((action) => action.admin_id === admin && action.conversation_id === conversationId).slice(0, Math.min(limit, 500)),
        listProposalActions: async (admin: string, proposalId: string) => this.actions.filter((action) => action.admin_id === admin && action.proposal_id === proposalId),
      },
      proposals: {
        stageProposal: async (adminId: string, input: StageArgs) => {
          const pending = this.proposals.filter(
            (row) => row.admin_id === adminId && row.conversation_id === input.conversationId && row.status === 'proposed' && new Date(row.expires_at) > NOW,
          );
          if (input.maxPending !== undefined && pending.length >= input.maxPending) throw new AdminAgentStoreError('agent_cap_reached', { limit: input.maxPending });
          const row: MemoryProposal = {
            id: input.id ?? uid(9000 + this.proposals.length),
            conversation_id: input.conversationId,
            admin_id: adminId,
            admin_name: 'Test Admin',
            kind: input.kind,
            class: input.class,
            plan_id: input.planId ?? null,
            plan_revision: input.planRevision ?? null,
            status: 'proposed',
            tool_registry_version: input.toolRegistryVersion,
            steps: input.steps,
            proposal_hash: input.proposalHash,
            preview: input.preview,
            preview_hash: input.previewHash,
            token_hash: input.tokenHash,
            acks_required: input.acksRequired ?? [],
            expires_at: input.expiresAt.toISOString(),
            executing_started_at: null,
            finished_at: null,
            approved_by: null,
            approved_at: null,
            supersede_key: input.supersedeKey ?? null,
            locale: input.locale,
            created_at: NOW.toISOString(),
          } as MemoryProposal;
          if (input.supersedeKey) {
            for (const older of this.proposals) {
              if (older.admin_id === adminId && older.supersede_key === input.supersedeKey && older.status === 'proposed') older.status = 'superseded';
            }
          }
          this.proposals.push(row);
          const { token_hash: _hidden, ...record } = row;
          return record as ProposalRecord;
        },
        getProposal: async (adminId: string, proposalId: string) => {
          const row = this.proposals.find((entry) => entry.id === proposalId && entry.admin_id === adminId);
          if (row === undefined) return null;
          const { token_hash: _hidden, ...record } = row;
          return record as ProposalRecord;
        },
        getProposalOrThrow: async (adminId: string, proposalId: string) => {
          const row = this.proposals.find((entry) => entry.id === proposalId && entry.admin_id === adminId);
          if (row === undefined) throw new AdminAgentStoreError('proposal_not_found');
          const { token_hash: _hidden, ...record } = row;
          return record as ProposalRecord;
        },
      },
    } as unknown as StagerDeps['store'];
  }
}

export function ledgerAction(overrides: Partial<ActionRecord>): ActionRecord {
  return {
    id: uid(8000),
    conversation_id: CONVERSATION_ID,
    admin_id: ADMIN,
    status: 'ok',
    entity_id: null,
    entity_type: null,
    step_key: null,
    proposal_id: null,
    error_code: null,
    http_status: null,
    ...overrides,
  } as ActionRecord;
}

export interface SourceScript {
  facts?: (plan: PlanDocument) => ReturnType<typeof okFacts>;
  phaseNames?: string[];
  epbHead?: Awaited<ReturnType<StagingSource['epbBattleRulesetHead']>>;
  draft?: Partial<RulesetDraftFact> | null;
  versionExists?: boolean;
  targets?: (targets: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }>) => PinTargetFact[];
  impact?: { checked: number; wouldBreak: number; truncated: boolean };
  phase?: Partial<PhaseStartFact> | null;
  recipients?: StagingSource['recipients'];
  startup?: Awaited<ReturnType<StagingSource['startupChecklist']>>;
  undo?: Awaited<ReturnType<StagingSource['undoFacts']>>;
}

/** A mutable world the fingerprint reads look at: change `world.value` between staging and recheck to simulate drift. */
export class FingerprintWorld implements FingerprintSource {
  value: Record<string, unknown> = {};
  unavailable = new Set<string>();
  reads: Array<{ read: string; target: unknown }> = [];
  async read(read: Parameters<FingerprintSource['read']>[0], target: Parameters<FingerprintSource['read']>[1]) {
    this.reads.push({ read, target });
    if (this.unavailable.has(read)) {
      const { ReadUnavailable } = await import('../fingerprints');
      throw new ReadUnavailable(read);
    }
    return { read, target, state: (this.value[read] ?? null) as never } as never;
  }
}

export function makeSource(script: SourceScript = {}, world = new FingerprintWorld()): StagingSource {
  return {
    loadPlanFacts: async ({ plan }) => (script.facts ?? okFacts)(plan),
    existingPhaseNames: async () => script.phaseNames ?? [],
    epbBattleRulesetHead: async () => script.epbHead ?? null,
    rulesetDraft: async () =>
      script.draft === null
        ? null
        : { draftRev: 3, errorDiagnostics: 0, diagnosticsHash: 'd'.repeat(64), currentVersionId: null, visibility: 'private', slug: 'gen9ou-custom', ...script.draft },
    rulesetVersionExists: async () => script.versionExists ?? true,
    pinTargets: async (targets) =>
      script.targets
        ? script.targets(targets)
        : targets.map((target) => ({
            kind: target.kind,
            id: target.id,
            name: target.kind === 'season' ? 'Gen 9 OU League' : 'Regular season',
            started: false,
            completed: false,
            pinnedVersionId: uid(9100),
            pinnedDefinitionId: DEFINITION_ID,
          })),
    pinImpact: async () => script.impact ?? { checked: 12, wouldBreak: 2, truncated: false },
    phaseStart: async (tournamentId) =>
      script.phase === null
        ? null
        : {
            tournamentId,
            tournamentName: 'Regular season',
            seasonId: SEASON_ID,
            seasonName: 'Gen 9 OU League',
            seasonFormatType: 'singles',
            formatAttached: false,
            bracketType: 'round_robin',
            roundCount: 0,
            participantCount: 12,
            ...script.phase,
          },
    startupChecklist: async () => (script.startup === undefined ? { items: [], blocked: false, roundRobin: null } : script.startup),
    undoFacts: async () => script.undo ?? { locks: {}, playerNames: {} },
    ...(script.recipients === undefined ? {} : { recipients: script.recipients }),
    fingerprints: world,
  };
}

export type GuardCall = { kind: string; id?: string; versionId?: string };

export interface HarnessOptions {
  admin?: Partial<StagingAdmin>;
  conversation?: Partial<StagingConversation>;
  env?: Record<string, string>;
  source?: SourceScript;
  /** Throw this from the guard of `kind`. */
  refuseGuard?: Partial<Record<string, unknown>>;
  /** Visibility of every ruleset version the live guard finds. */
  visibility?: 'private' | 'league' | 'gallery';
  nowMs?: number;
}

export function makeHarness(options: HarnessOptions = {}) {
  const store = new MemoryStore();
  const world = new FingerprintWorld();
  const source = makeSource(options.source, world);
  const guards: GuardCall[] = [];
  let clock = options.nowMs ?? NOW.getTime();
  let counter = 0;
  const config = parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: '1', ADMIN_AGENT_GOLIVE: '1', ADMIN_AGENT_MAX_PHASE: '5', ...(options.env ?? {}) } as Record<string, string>);

  const guard = vi.fn(async (spec: { kind: string; id?: string; versionId?: string }) => {
    guards.push({ kind: spec.kind, id: spec.id, versionId: spec.versionId });
    const refusal = options.refuseGuard?.[spec.kind];
    if (refusal !== undefined) throw refusal;
    const definition = { id: DEFINITION_ID, slug: 'gen9ou-custom', visibility: options.visibility ?? 'league' };
    switch (spec.kind) {
      case 'rulesetUsable':
        return { kind: spec.kind, usable: { definition, version_no: 2 } };
      case 'rulesetOwner':
      case 'rulesetViewer':
        return { kind: spec.kind, ruleset: { definition, actor: {}, player: {} } };
      default:
        return { kind: spec.kind };
    }
  });

  const deps: StagerDeps = {
    store: store.asStore(),
    config: () => config,
    tools: STAGED_TOOLS,
    guard: guard as unknown as StagerDeps['guard'],
    source,
    tokenKey: () => TOKEN_SECRET,
    now: () => new Date(clock),
    newId: () => uid(4000 + counter++),
  };
  const stager = createProposalStager(deps);
  const conversation: StagingConversation = {
    id: CONVERSATION_ID,
    tool_set: 'site',
    tool_registry_version: 'abcdef0123456789',
    ui_locale: 'en',
    ...(options.conversation ?? {}),
  } as StagingConversation;
  const admin: StagingAdmin = { id: ADMIN, isSiteAdmin: true, ...(options.admin ?? {}) };
  const turn = newTurnStaging();

  const input = (toolName: string, args: unknown, extra: Partial<StageInput> = {}): StageInput => ({ conversation, admin, toolName, args, turn, ...extra });
  const stage = (toolName: string, args: unknown, extra: Partial<StageInput> = {}) => stager.stageProposal(input(toolName, args, extra));

  return {
    store,
    world,
    deps,
    stager,
    conversation,
    admin,
    turn,
    guards,
    guard,
    config,
    input,
    stage,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Everything the 4.10 example needs known: the roster, the ruleset version. */
export function seeWorkedExample(h: ReturnType<typeof makeHarness>): PlanDocument {
  const plan = workedExample();
  h.store.setPlan(plan);
  h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
  return plan;
}

export const forbidden = (code: string, status = 403): UserFacingError =>
  new UserFacingError('refused', { code: code as never, status });
