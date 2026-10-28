/**
 * Staging (plan 4.5; spec §18.6): the only path from a model's `propose_*` call to a proposal row.
 *
 * `stageProposal` does, in this order, and refuses with a catalogued code at the first failure:
 *   1. the tool is a registered B or G tool offered to this conversation (role, phase, the Go-live switch);
 *   2. the per-turn limits (4 stagings, one Go-live card);
 *   3. the arguments parse against the tool's schema;
 *   4. model-authored strings are plain (`text_not_allowed`);
 *   5. provenance: every uuid was seen in this conversation (`unknown_reference`) (Go-live; Build checks the ids of its
 *      derived steps), before any guard runs, so a guard's 403 versus 404 cannot be used to probe ids;
 *   6. the kind-specific preparer (`build.ts`, `golive.ts`): the live guards for every resource named, the preflight
 *      checks, the steps as data, the reads that guard them, the acknowledgements and the card;
 *   7. ids and hashes: `args_hash` per step, `proposal_hash`, `preview_hash`, the approval token's hash;
 *   8. one immutable row through the store (at most 2 pending per conversation; the same tool and target supersedes the
 *      older card).
 * No domain table is touched. The result for the model is `{status: 'staged', proposal_id, ...}` or a refusal; it never
 * carries the token, the hashes or any text the model could mistake for an approval.
 *
 * `getCard` is the read side: the frozen preview plus the live status and the ledger state of each step. `getApprovalToken`
 * hands the token to the route that serves the owning admin's `GET /proposals/[id]`; it is not part of anything the loop
 * calls.
 *
 * Everything the staging needs from outside is a `StagerDeps` entry, so the pure parts are tested without a database.
 */
import type { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Json } from '@/types/database';
import type { JsonValue } from '@/lib/studio-core/json';
import { computePreviewHash, computeProposalHash, planCode } from '../plans/hash';
import { toolErrorFromThrown } from '../registry/errors';
import type { AdminId } from '../store/ids';
import type { ProposalStatus } from '../store/types';
import { prepareBuild } from './build';
import { proposalCardSchema, type ProposalCard } from './card';
import { escalateClass } from './class';
import { buildPreconditions, preconditionsHash, ReadUnavailable } from './fingerprints';
import { isStageableGoLive, prepareGoLive } from './golive';
import { prepareUndo, UNDO_TOOL } from './undo';
import { StageRefusal, type PrepareContext } from './prepare';
import { collectUuids, unknownReferences } from './provenance';
import { sealStep, storedStepSchema, type StoredStep } from './steps';
import { scanStagedText } from './text';
import { approvalTokenHash, deriveApprovalToken } from './token';
import { checkTurnStaging, recordTurnStaging } from './turn';
import { STAGED_NOTE, type StageInput, type StageRefused, type StageResult, type StagerDeps } from './types';

/**
 * The ledger tools whose entity the conversation CREATED. "Created in this chat" (plan 3.5 rule 4) counts only these: a row that
 * merely changed or started something (a pin move, a start, a draft patch) files the entity under its id too, and must not make
 * an existing league or ruleset look like one this chat made.
 */
const CREATING_TOOLS: ReadonlySet<string> = new Set(['league_create', 'tournament_create', 'phase_create', 'draft_pool_create', 'ruleset_create_draft', 'format_create', 'format_fork', 'format_fork_preset']);

/** At most this many proposals wait for the admin in one conversation (plan 4.5). */
export const MAX_PENDING_PROPOSALS = 2;

/** The statuses a card shows, as the UI keys them (`status.*` of the cards catalog). */
export interface StepStatusView {
  key: string;
  status: 'pending' | 'executing' | 'ok' | 'failed' | 'unknown' | 'skipped' | 'undone';
  errorCode: string | null;
  httpStatus: number | null;
  actionId: string | null;
}

export interface StepDetail {
  key: string;
  method: StoredStep['method'];
  routeTemplate: string;
  /** The route with literal path parameters filled in; a `$ref` shows as `{league.id}`. */
  path: string;
  query: StoredStep['query'];
  body: StoredStep['body_template'];
}

export interface CardView {
  id: string;
  kind: 'build' | 'action' | 'undo';
  class: 'B' | 'G';
  /** The stored status. */
  status: ProposalStatus;
  /** `expired` once a `proposed` card is past its expiry, before the next sweep writes it. */
  effectiveStatus: ProposalStatus;
  /** Approve and Decline are offered. */
  actionable: boolean;
  createdAt: string;
  expiresAt: string;
  secondsLeft: number | null;
  locale: 'en' | 'de';
  planCode: string;
  proposalHash: string;
  previewHash: string;
  planId: string | null;
  planRevision: number | null;
  toolRegistryVersion: string;
  acksRequired: string[];
  /** The frozen preview: structured data, rendered by the UI in the viewer's locale. */
  card: ProposalCard;
  steps: StepStatusView[];
  /** The collapsible "technical details": exactly what would be sent. */
  details: StepDetail[];
}

/** `path: message` for each issue, at most 300 characters: paths and our own messages, never values. */
function describeIssues(error: z.ZodError): string {
  const text = error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(arguments)'}: ${issue.message}`)
    .join('; ');
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

const toLocale = (value: string): 'en' | 'de' => (value === 'de' ? 'de' : 'en');

function fillPath(template: string, params: StoredStep['path_params']): string {
  return template.replace(/\[(\w+)\]/g, (whole, name: string) => {
    const value = params[name];
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof value.$ref === 'string') return `{${value.$ref}}`;
    return whole;
  });
}

function refusedFrom(err: unknown): StageRefused {
  if (err instanceof StageRefusal) {
    return {
      status: 'refused',
      code: err.code,
      ...(err.params === undefined ? {} : { params: err.params }),
      ...(err.findings === undefined ? {} : { findings: err.findings }),
    };
  }
  if (err instanceof ReadUnavailable) {
    // The app cannot say (for example the startup checklist before PR5): fail closed, never guess a fingerprint.
    console.error(`[admin-agent] stageProposal: ${err.message}`);
    return { status: 'refused', code: 'tool_not_available' };
  }
  const mapped = toolErrorFromThrown(err, 'stageProposal');
  return { status: 'refused', code: mapped.code, ...(mapped.params === undefined ? {} : { params: mapped.params }) };
}

export function createProposalStager(deps: StagerDeps) {
  async function run(input: StageInput): Promise<StageResult> {
    const { admin, conversation } = input;
    const cfg = deps.config();

    // 1. The tool: a staged B or G tool, offered to this conversation's registry.
    const tool = deps.tools.find((entry) => entry.name === input.toolName);
    if (tool === undefined || (tool.class !== 'B' && tool.class !== 'G')) throw new StageRefusal('tool_not_available');
    const role = conversation.tool_set;
    if (role !== 'site' && role !== 'scoped') throw new StageRefusal('agent_harness_error');
    if (tool.phase > cfg.maxPhase) throw new StageRefusal('phase_disabled');
    if (role === 'scoped' && tool.audience === 'site') throw new StageRefusal('tool_not_available');
    // A tier change away from the conversation's registry makes it read-only (plan 4.6); the live tier decides, not the token.
    if ((role === 'site' || tool.audience === 'site') && !admin.isSiteAdmin) throw new StageRefusal('forbidden');
    const cls = tool.class;
    if (cls === 'G' && !cfg.golive) throw new StageRefusal('agent_golive_disabled');
    if (cls === 'G' && !isStageableGoLive(tool.name) && tool.name !== UNDO_TOOL) throw new StageRefusal('phase_disabled');
    if (cls === 'B' && tool.name !== 'propose_build') throw new StageRefusal('tool_not_available');

    // 2. Per-turn limits.
    const turn = checkTurnStaging(input.turn, cls, cfg.limits.maxStagingsPerTurn);
    if (turn !== null) throw new StageRefusal(turn.code, turn.params);

    // 3. Arguments against the tool's own schema.
    const parsed = tool.args.safeParse(input.args);
    if (!parsed.success) throw new StageRefusal('validation_failed', { issues: describeIssues(parsed.error) });
    const args: unknown = parsed.data;

    // 4. Model-authored strings.
    const textFindings = scanStagedText(args);
    if (textFindings.length > 0) throw new StageRefusal('text_not_allowed', { path: textFindings[0].path, reason: textFindings[0].reason });

    // 5. Provenance of the ids the model named, before any guard answers a 403 or a 404 for them.
    if (cls === 'G') {
      const unknown = await unknownReferences(collectUuids(args), new Set(), (ids) => deps.store.refs.knownRefIds(admin.id, conversation.id, ids));
      if (unknown.length > 0) throw new StageRefusal('unknown_reference', { count: unknown.length, id: unknown[0] });
    }

    // 6. The kind-specific preparer.
    let createdIds: Promise<Set<string>> | null = null;
    const ctx: PrepareContext = {
      deps,
      input,
      tool,
      cfg,
      createdInChat: async (ids) => {
        createdIds ??= deps.store.actions.listActions(admin.id, conversation.id).then(
          (actions) => new Set(actions.filter((action) => action.status === 'ok' && action.entity_id !== null && CREATING_TOOLS.has(action.tool_name)).map((action) => (action.entity_id as string).toLowerCase())),
        );
        const created = await createdIds;
        return ids.length > 0 && ids.every((id) => created.has(id.toLowerCase()));
      },
    };
    const prepared =
      tool.name === 'propose_build'
        ? await prepareBuild(ctx, args as { plan_revision: number })
        : tool.name === UNDO_TOOL
          ? await prepareUndo(ctx, args as Parameters<typeof prepareUndo>[1])
          : await prepareGoLive(ctx, args);

    // 7. Ids, hashes, token, expiry.
    const proposalId = deps.newId();
    const ids = { adminId: admin.id, conversationId: conversation.id, proposalId };
    const evaluated = await buildPreconditions(
      deps.source.fingerprints,
      prepared.steps.map((entry) => ({ specs: entry.fixed === undefined ? entry.specs : [], touches: entry.touches })),
      prepared.scopeOf,
    );
    const entries = evaluated.map((list, index) => prepared.steps[index].fixed ?? list);
    const steps: StoredStep[] = prepared.steps.map((entry, index) => sealStep({ ...entry.step, preconditions: entries[index] }, ids));
    for (const step of steps) {
      const checked = storedStepSchema.safeParse(step);
      if (!checked.success) {
        console.error('[admin-agent] stageProposal: a derived step does not match its schema', step.op, describeIssues(checked.error));
        throw new StageRefusal('agent_harness_error');
      }
    }
    const declared = escalateClass(prepared.class, []);
    const proposalHash = computeProposalHash({
      stepArgsHashes: steps.map((step) => step.args_hash),
      preconditionsHash: preconditionsHash(entries),
      acksRequired: prepared.acks,
    });
    const built = proposalCardSchema.safeParse(prepared.card(planCode(proposalHash)));
    if (!built.success) {
      console.error('[admin-agent] stageProposal: the derived card does not match its schema', tool.name, describeIssues(built.error));
      throw new StageRefusal('agent_harness_error');
    }
    const card = built.data;
    const locale = toLocale(conversation.ui_locale);
    const previewHash = computePreviewHash({
      preview: card as unknown as JsonValue,
      outwardEffects: card.outwardEffects as unknown as JsonValue,
      targets: card.steps.map((step) => ({ target: step.target, items: step.items })) as unknown as JsonValue,
      locale,
    });
    const token = deriveApprovalToken(deps.tokenKey(), proposalId, admin.id);
    const ttlMinutes = prepared.ttl === 'build' ? cfg.proposalTtlMinutes.build : cfg.proposalTtlMinutes.golive;

    // 8. One immutable row. The store refuses a third pending proposal (`agent_cap_reached`) and supersedes the older card
    // of the same tool and target.
    const row = await deps.store.proposals.stageProposal(admin.id, {
      id: proposalId,
      conversationId: conversation.id,
      kind: prepared.kind,
      class: declared,
      planId: prepared.planId,
      planRevision: prepared.planRevision,
      toolRegistryVersion: conversation.tool_registry_version,
      steps: steps as unknown as Json,
      proposalHash,
      preview: card as unknown as Json,
      previewHash,
      tokenHash: approvalTokenHash(token),
      acksRequired: prepared.acks,
      expiresAt: new Date(deps.now().getTime() + ttlMinutes * 60_000),
      supersedeKey: prepared.supersedeKey,
      locale,
      maxPending: MAX_PENDING_PROPOSALS,
    });
    recordTurnStaging(input.turn, declared);

    // The proposal id is something this conversation has now seen (a later `propose_undo` names it). Best effort: a failed
    // record must not undo a staged card.
    try {
      await deps.store.refs.recordRefs(admin.id, conversation.id, [{ kind: 'proposal', id: row.id, label: null, source: 'tool_result' }]);
    } catch (err) {
      console.error('[admin-agent] stageProposal: could not record the proposal ref', err);
    }

    return {
      status: 'staged',
      proposal_id: row.id,
      kind: prepared.kind,
      class: declared,
      plan_code: card.planCode,
      expires_at: row.expires_at,
      note: STAGED_NOTE,
    };
  }

  /**
   * Stages one `propose_*` call. Never throws: every failure is a catalogued refusal (anything unexpected is
   * `agent_harness_error` and goes to the server log under `[admin-agent]`).
   */
  async function stageProposal(input: StageInput): Promise<StageResult> {
    try {
      return await run(input);
    } catch (err) {
      return refusedFrom(err);
    }
  }

  /** The card of one of the admin's own proposals: the frozen preview plus the live status. Another admin's is `proposal_not_found`. */
  async function getCard(proposalId: string, adminId: AdminId): Promise<CardView> {
    const proposal = await deps.store.proposals.getProposalOrThrow(adminId, proposalId);
    const actions = await deps.store.actions.listProposalActions(adminId, proposal.id);
    const card = proposalCardSchema.safeParse(proposal.preview);
    const steps = storedStepSchema.array().safeParse(proposal.steps);
    if (!card.success || !steps.success) {
      console.error('[admin-agent] getCard: a stored proposal no longer matches its schema', proposal.id);
      throw new UserFacingError('Proposal unreadable', { code: 'agent_harness_error', status: 500 });
    }

    const now = deps.now().getTime();
    const expiresMs = new Date(proposal.expires_at).getTime();
    const status = proposal.status as ProposalStatus;
    const expired = status === 'proposed' && expiresMs <= now;
    const effectiveStatus: ProposalStatus = expired ? 'expired' : status;
    const byStep = new Map(actions.map((action) => [action.step_key ?? '', action]));

    return {
      id: proposal.id,
      kind: proposal.kind as CardView['kind'],
      class: proposal.class as 'B' | 'G',
      status,
      effectiveStatus,
      actionable: effectiveStatus === 'proposed',
      createdAt: proposal.created_at,
      expiresAt: proposal.expires_at,
      secondsLeft: status === 'proposed' ? Math.max(0, Math.ceil((expiresMs - now) / 1000)) : null,
      locale: toLocale(proposal.locale),
      planCode: card.data.planCode,
      proposalHash: proposal.proposal_hash,
      previewHash: proposal.preview_hash,
      planId: proposal.plan_id,
      planRevision: proposal.plan_revision,
      toolRegistryVersion: proposal.tool_registry_version,
      acksRequired: Array.isArray(proposal.acks_required) ? proposal.acks_required.filter((ack): ack is string => typeof ack === 'string') : [],
      card: card.data,
      steps: steps.data.map((step): StepStatusView => {
        const action = byStep.get(step.key);
        return {
          key: step.key,
          status: action === undefined ? 'pending' : (action.status as StepStatusView['status']),
          errorCode: action?.error_code ?? null,
          httpStatus: action?.http_status ?? null,
          actionId: action?.id ?? null,
        };
      }),
      details: steps.data.map((step) => ({
        key: step.key,
        method: step.method,
        routeTemplate: step.route_template,
        path: fillPath(step.route_template, step.path_params),
        query: step.query,
        body: step.body_template,
      })),
    };
  }

  /**
   * The approval token of a proposal that is still waiting, for the admin who staged it; `null` for anything else (another
   * admin's proposal throws `proposal_not_found`). Called by the route behind `GET /proposals/[id]` only.
   */
  async function getApprovalToken(proposalId: string, adminId: AdminId): Promise<string | null> {
    const proposal = await deps.store.proposals.getProposalOrThrow(adminId, proposalId);
    if (proposal.status !== 'proposed' || new Date(proposal.expires_at).getTime() <= deps.now().getTime()) return null;
    return deriveApprovalToken(deps.tokenKey(), proposal.id, adminId);
  }

  return { stageProposal, getCard, getApprovalToken };
}

export type ProposalStager = ReturnType<typeof createProposalStager>;
