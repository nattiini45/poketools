/**
 * Preparing `propose_undo` (plan 4.5 and 4.7, spec §18.8): the one multi-step Go-live card. The model names WHAT to undo (an
 * executed proposal of this conversation, or a ruleset draft the chat wrote); everything else is derived by code from the
 * ledger and from live state:
 *
 *  1. the subject's ledger rows (this admin's, this conversation's, finished `ok`);
 *  2. the live guard of every entity an undo would touch (before any live read, so a guard cannot be used to probe ids);
 *  3. the live fingerprint of each entity, compared with the `after_fingerprint` the ledger stored: a changed one is "left
 *     alone: edited outside chat" and gets no step;
 *  4. `deriveUndoPlan` (plans/undo.ts: the 4.7 table, the locks, the 20-step cap) on those entries;
 *  5. each reversal built from the recipes (plans/undo-recipes.ts, the same functions the bindings' `reversal.buildInput` use),
 *     one stored step per roster player and per pin-back group, newest first, each with its OWN precondition: the state the
 *     chat's write left, taken from the ledger and not read again.
 *
 * Nothing the ledger did not create is touched. Nothing is hard-deleted except a ruleset draft the chat created that has never
 * been published (the second carve-out, spec §18.8). Phases, pools and the like are listed on the card as residue.
 */
import { hashJson } from '../plans/hash';
import { deriveUndoPlan, hasReversal, UNDO_MAX_STEPS, type LedgerEntryView, type UndoEntryNote, type UndoPlan, type UndoReason, type UndoStep } from '../plans/undo';
import { deleteDraftCall, idOfLedgerResult, leagueArchiveCall, pinBackCall, restoreDraftCall, rosterRemoveCalls, tournamentArchiveCall, tournamentParticipantRemoveCall, UNDO_ROUTES, uuidOf, type UndoOperation } from '../plans/undo-recipes';
import type { JsonValue } from '@/lib/studio-core/json';
import type { ActionRecord } from '../store/types';
import { draftLifeState, pinTargetsState, rosterMembersState, sortedIds, stateHash } from './after-state';
import { line, text, type CardEntity, type CardLine, type CardStep, type CardTarget, type ProposalCard, type UndoNote, CARD_VERSION } from './card';
import type { PreconditionEntry, ReadName, ReadTarget } from './fingerprints';
import { StageRefusal, type PrepareContext, type Prepared, type PreparedStep } from './prepare';
import { storedStepSchema, type StepDraft, type StoredStep } from './steps';

export const UNDO_TOOL = 'propose_undo';
const EFFECT = 'compensating_changes';
/** A stored step's request body must fit the ledger row's `args` column (64 KiB with the rest of the row): a bigger snapshot is not restored. */
const RESTORE_MAX_BYTES = 48 * 1024;
/** Stands in for a stored fingerprint the ledger lacks: it never matches, so the entry reads `fingerprint_unavailable`. */
const UNRECORDED = 'unrecorded';

export interface UndoArgs {
  proposal_id?: string;
  ruleset_id?: string;
  draft_rev?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const rec = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** The ledger op as `plans/undo.ts` names it (two Go-live ops are filed under their step name). */
const UNDO_OP_NAME: Readonly<Record<string, string>> = { move_pin: 'ruleset_move_pin', publish_ruleset: 'ruleset_publish' };
/**
 * Whether an executed proposal's ledger holds a finished row that has a reversal in the 4.7 table. A pure, static answer for the
 * card's Undo button and the request's pre-check: the live checks (an outside edit, a lock) are `propose_undo`'s, at click time.
 */
export function hasUndoableRows(actions: ReadonlyArray<Pick<ActionRecord, 'tool_name' | 'status'>>): boolean {
  return actions.some((record) => record.status === 'ok' && hasReversal(UNDO_OP_NAME[record.tool_name] ?? record.tool_name));
}

const ENTITY_OF_OP: Readonly<Record<string, CardEntity>> = {
  league_create: 'league',
  roster_add: 'roster',
  tournament_participant_add: 'player',
  phase_create: 'phase',
  tournament_create: 'tournament',
  start_phase: 'tournament',
  generate_bracket: 'tournament',
  move_pin: 'ruleset',
  publish_ruleset: 'ruleset',
  ruleset_create_draft: 'ruleset',
  ruleset_patch_draft: 'ruleset',
};

interface Row {
  readonly record: ActionRecord;
  /** The op as the ledger recorded it (`move_pin`). */
  readonly tool: string;
  /** The op as `plans/undo.ts` names it (`ruleset_move_pin`). */
  readonly op: string;
  readonly seq: number;
}

interface Subject {
  readonly key: string;
  readonly rows: Row[];
  /** The proposal's stored steps (to resolve a `$ref` path param), when the subject is a proposal. */
  readonly steps: StoredStep[] | null;
  /** `delete`: the draft the chat created, deleted while unpublished (its saves are replaced by the delete). */
  readonly mode: 'proposal' | 'save' | 'delete';
}

// ─── Subject ─────────────────────────────────────────────────────────────────

async function loadSubject(ctx: PrepareContext, args: UndoArgs): Promise<Subject> {
  const { deps, input } = ctx;
  const { admin, conversation } = input;
  const named = [args.proposal_id !== undefined, args.ruleset_id !== undefined].filter(Boolean).length;
  if (named !== 1 || (args.proposal_id !== undefined && args.draft_rev !== undefined) || (args.ruleset_id === undefined && args.draft_rev !== undefined)) {
    throw new StageRefusal('validation_failed', { issues: 'name either proposal_id, or ruleset_id with an optional draft_rev' });
  }

  if (args.proposal_id !== undefined) {
    const proposal = await deps.store.proposals.getProposal(admin.id, args.proposal_id);
    // Another admin's, another conversation's and an unknown id all read the same: not found.
    if (proposal === null || proposal.conversation_id !== conversation.id) throw new StageRefusal('proposal_not_found');
    // Only a proposal that ran has anything to undo; an undo is not undone by the assistant.
    if (proposal.kind === 'undo' || !['completed', 'partial', 'failed', 'unknown', 'stale'].includes(proposal.status)) throw new StageRefusal('nothing_to_undo');
    const parsed = storedStepSchema.array().safeParse(proposal.steps);
    const actions = await deps.store.actions.listProposalActions(admin.id, proposal.id);
    return {
      key: proposal.id,
      mode: 'proposal',
      steps: parsed.success ? parsed.data : null,
      rows: actions.map((record, seq) => ({ record, tool: record.tool_name, op: UNDO_OP_NAME[record.tool_name] ?? record.tool_name, seq })),
    };
  }

  const rulesetId = (args.ruleset_id as string).toLowerCase();
  const written = (await deps.store.actions.listActions(admin.id, conversation.id, 500)).filter(
    (record) => record.entity_id?.toLowerCase() === rulesetId && (record.tool_name === 'ruleset_create_draft' || record.tool_name === 'ruleset_patch_draft'),
  );
  const rows = written.map((record, seq): Row => ({ record, tool: record.tool_name, op: record.tool_name, seq }));
  if (args.draft_rev !== undefined) {
    // The one save that left the draft at this revision.
    const save = rows.filter((row) => row.tool === 'ruleset_patch_draft' && rec(row.record.after).draft_rev === args.draft_rev && row.record.status === 'ok').at(-1);
    if (save === undefined) throw new StageRefusal('nothing_to_undo');
    return { key: `draft:${rulesetId}:${args.draft_rev}`, mode: 'save', steps: null, rows: [save] };
  }
  if (!rows.some((row) => row.tool === 'ruleset_create_draft' && row.record.status === 'ok')) throw new StageRefusal('nothing_to_undo');
  return { key: `draft:${rulesetId}`, mode: 'delete', steps: null, rows };
}

// ─── What a row says about its entity ────────────────────────────────────────

interface Facts {
  /** The entity the reversal acts on. */
  readonly entityId: string | null;
  /** The league a roster add went to. */
  readonly leagueId: string | null;
  /** The standalone tournament a participant add went to. */
  readonly tournamentId: string | null;
  readonly players: string[];
  readonly targets: Array<{ kind: 'season' | 'tournament'; id: string }>;
  readonly name: string | null;
}

/** Resolves a `$ref` path of a stored step ("league.id") from the proposal's other ledger rows. */
function resolveRef(subject: Subject, path: string): string | null {
  const [root, ...rest] = path.split('.');
  const producer = subject.steps?.find((step) => step.ref_key === root);
  const row = producer === undefined ? undefined : subject.rows.find((candidate) => candidate.record.step_key === producer.key);
  let node: unknown = row?.record.result ?? null;
  for (const segment of rest) node = isRecord(node) ? node[segment] : undefined;
  return uuidOf(node);
}

function factsOf(subject: Subject, row: Row): Facts {
  const args = rec(row.record.args);
  const body = rec(args.body_template);
  const params = rec(args.path_params);
  const idParam = params.id;
  const paramId = typeof idParam === 'string' ? uuidOf(idParam) : isRecord(idParam) && typeof idParam.$ref === 'string' ? resolveRef(subject, idParam.$ref) : null;
  const players = Array.isArray(body.player_ids)
    ? sortedIds(body.player_ids.filter((id): id is string => typeof id === 'string'))
    : typeof body.player_id === 'string'
      ? sortedIds([body.player_id])
      : [];
  const targets = Array.isArray(body.targets)
    ? body.targets.flatMap((target): Array<{ kind: 'season' | 'tournament'; id: string }> => {
        const t = rec(target);
        const id = uuidOf(t.id);
        return id !== null && (t.kind === 'season' || t.kind === 'tournament') ? [{ kind: t.kind, id }] : [];
      })
    : [];
  return {
    entityId: uuidOf(row.record.entity_id) ?? idOfLedgerResult(row.record.result) ?? paramId,
    leagueId: row.tool === 'roster_add' ? paramId : null,
    tournamentId: row.tool === 'tournament_participant_add' ? paramId : null,
    players,
    targets,
    name: typeof body.name === 'string' ? body.name : null,
  };
}

// ─── The preparer ────────────────────────────────────────────────────────────

interface Expanded {
  steps: PreparedStep[];
  cards: CardStep[];
}

export async function prepareUndo(ctx: PrepareContext, args: UndoArgs): Promise<Prepared> {
  const { deps } = ctx;
  const source = deps.source;

  // 1. The ledger rows of the subject.
  const subject = await loadSubject(ctx, args);
  const facts = new Map(subject.rows.map((row) => [row.record.id, factsOf(subject, row)]));
  const fact = (row: Row): Facts => facts.get(row.record.id) as Facts;

  // 2. The live guards for everything an undo would touch, before any live read.
  const guarded = new Set<string>();
  const once = async (key: string, run: () => Promise<unknown>): Promise<void> => {
    if (guarded.has(key)) return;
    guarded.add(key);
    await run();
  };
  for (const row of subject.rows) {
    if (row.record.status !== 'ok') continue;
    const f = fact(row);
    if (row.tool === 'league_create' && f.entityId !== null) await once(`season:${f.entityId}`, () => deps.guard({ kind: 'season', id: f.entityId as string }));
    if (row.tool === 'roster_add' && f.leagueId !== null) await once(`season:${f.leagueId}`, () => deps.guard({ kind: 'season', id: f.leagueId as string }));
    if (row.tool === 'tournament_create' && f.entityId !== null) await once(`tournament:${f.entityId}`, () => deps.guard({ kind: 'tournament', id: f.entityId as string }));
    if (row.tool === 'tournament_participant_add' && f.tournamentId !== null) await once(`tournament:${f.tournamentId}`, () => deps.guard({ kind: 'tournament', id: f.tournamentId as string }));
    if (row.tool === 'move_pin' && f.entityId !== null) {
      await once(`rulesetViewer:${f.entityId}`, () => deps.guard({ kind: 'rulesetViewer', id: f.entityId as string }));
      for (const target of f.targets) await once(`${target.kind}:${target.id}`, () => deps.guard({ kind: target.kind, id: target.id }));
    }
    if ((row.tool === 'ruleset_patch_draft' || row.tool === 'ruleset_create_draft') && f.entityId !== null) await once(`rulesetOwner:${f.entityId}`, () => deps.guard({ kind: 'rulesetOwner', id: f.entityId as string }));
  }

  // 3. Live state: the fingerprint of each entity as it is now, and the facts the locks need.
  const nameOf = new Map<string, string>();
  const fingerprints: Record<string, string | null> = {};
  const readLive = async (row: Row, read: ReadName, target: ReadTarget): Promise<void> => {
    const state = await source.fingerprints.read(read, target);
    fingerprints[row.record.id] = state === null ? null : hashJson(state);
    if (isRecord(state) && typeof state.name === 'string') nameOf.set(row.record.id, state.name);
  };
  const draftRevOf = (row: Row): number | null => {
    const rev = rec(row.record.after).draft_rev ?? rec(row.record.result).draft_rev;
    return typeof rev === 'number' ? rev : null;
  };
  /** In delete mode the draft must be as the chat's LAST write to it left it. */
  const lastChatRev = Math.max(0, ...subject.rows.filter((row) => row.record.status === 'ok').map((row) => draftRevOf(row) ?? 0));

  const entries: LedgerEntryView[] = [];
  let publishedLive = false;
  for (const row of subject.rows) {
    // Delete mode: only the creation matters; the saves are replaced by the delete and are listed, not evaluated.
    if (subject.mode === 'delete' && row.tool !== 'ruleset_create_draft') continue;
    const f = fact(row);
    const record = row.record;
    let stored = record.after_fingerprint;
    // A row without a stored fingerprint (an old row) is not read at all: it stays absent from the live state, which fails closed.
    if (record.status === 'ok' && (stored !== null || row.tool === 'ruleset_create_draft')) {
      if (row.tool === 'league_create' && f.entityId !== null) await readLive(row, 'league_after', { kind: 'id', id: f.entityId });
      else if (row.tool === 'tournament_create' && f.entityId !== null) await readLive(row, 'tournament_after', { kind: 'id', id: f.entityId });
      else if (row.tool === 'roster_add' && f.leagueId !== null && f.players.length > 0) await readLive(row, 'roster_members', { kind: 'params', params: { season_id: f.leagueId, player_ids: f.players } });
      else if (row.tool === 'tournament_participant_add' && f.tournamentId !== null && f.players.length > 0) await readLive(row, 'tournament_members', { kind: 'params', params: { tournament_id: f.tournamentId, player_ids: f.players } });
      else if (row.tool === 'move_pin' && f.targets.length > 0) await readLive(row, 'pin_targets', { kind: 'params', params: { targets: f.targets } });
      else if (row.tool === 'ruleset_patch_draft' && f.entityId !== null) await readLive(row, 'ruleset_draft_doc', { kind: 'id', id: f.entityId });
      else if (row.tool === 'ruleset_create_draft' && f.entityId !== null) {
        // "Published" is a lock of its own (residue, not "edited outside"): the fingerprint compares the revision, and the
        // published flag is read apart. The step's precondition at execution compares both.
        const state = await source.fingerprints.read('ruleset_draft_state', { kind: 'id', id: f.entityId });
        if (isRecord(state)) {
          publishedLive = state.published === true;
          fingerprints[record.id] = hashJson({ ...state, published: false });
        } else {
          fingerprints[record.id] = null;
        }
        stored = stateHash(draftLifeState(lastChatRev, false));
      }
    }
    const needsFingerprint = ['league_create', 'tournament_create', 'roster_add', 'tournament_participant_add', 'move_pin', 'ruleset_patch_draft', 'ruleset_create_draft'].includes(row.tool);
    entries.push({
      actionId: record.id,
      seq: row.seq,
      op: row.op,
      status: record.status as LedgerEntryView['status'],
      entityType: record.entity_type,
      entityId: record.entity_id,
      afterFingerprint: needsFingerprint ? (stored ?? UNRECORDED) : stored,
    });
  }

  const leagueIds = [...new Set(subject.rows.flatMap((row) => [fact(row).leagueId, row.tool === 'league_create' ? fact(row).entityId : null]).filter((id): id is string => id !== null))];
  const tournamentIds = [...new Set(subject.rows.flatMap((row) => (row.tool === 'tournament_participant_add' ? [fact(row).tournamentId] : [])).filter((id): id is string => id !== null))];
  const playerIds = [...new Set(subject.rows.flatMap((row) => (row.tool === 'roster_add' || row.tool === 'tournament_participant_add' ? fact(row).players : [])))];
  const undoFacts = await source.undoFacts({ leagueIds, playerIds, ...(tournamentIds.length > 0 ? { tournamentIds } : {}) });
  const pinRows = subject.rows.filter((row) => row.tool === 'move_pin' && row.record.status === 'ok');
  const pinTargets = pinRows.length === 0 ? [] : await source.pinTargets(pinRows.flatMap((row) => fact(row).targets));
  const created = subject.rows.find((row) => row.tool === 'ruleset_create_draft');
  const draft = created === undefined || fact(created).entityId === null ? null : await source.rulesetDraft(fact(created).entityId as string);

  // 4. The plan, from the 4.7 table.
  const plan = deriveUndoPlan(entries, {
    fingerprints,
    locks: { ...undoFacts.locks, pinLocked: pinTargets.some((target) => target.completed), rulesetPublished: publishedLive || (draft !== null && draft.currentVersionId !== null) },
  });

  // 5. The steps.
  const rowOf = new Map(subject.rows.map((row) => [row.record.id, row]));
  const notes: { leftAlone: UndoNote[]; residue: UndoNote[]; notUndoable: UndoNote[] } = { leftAlone: [], residue: [], notUndoable: [] };
  const note = (bucket: keyof typeof notes, row: Row, reason: UndoReason): void => {
    const f = fact(row);
    const name = nameOf.get(row.record.id) ?? f.name;
    notes[bucket].push({
      op: row.tool,
      entity: ENTITY_OF_OP[row.tool] ?? null,
      id: f.entityId ?? f.leagueId,
      name: name === null ? null : text(name, 120),
      reason,
    });
  };
  const noteOf = (bucket: keyof typeof notes, entry: UndoEntryNote): void => note(bucket, rowOf.get(entry.actionId) as Row, entry.reason);
  plan.leftAlone.forEach((entry) => noteOf('leftAlone', entry));
  plan.residue.forEach((entry) => noteOf('residue', entry));
  plan.notUndoable.forEach((entry) => noteOf('notUndoable', entry));

  const planSteps = subject.mode === 'delete' ? supersede(plan, subject, (row, reason) => note('residue', row, reason)) : plan.steps;
  const expanded: Expanded[] = [];
  let total = 0;
  let truncated = plan.truncated;
  for (const planStep of planSteps) {
    const row = rowOf.get(planStep.actionId) as Row;
    const result = await expand(ctx, subject, row, planStep, { fact: fact(row), nameOf, playerNames: undoFacts.playerNames, pinTargets, draft, lastChatRev });
    if ('reason' in result) {
      note('notUndoable', row, result.reason);
      continue;
    }
    if (result.steps.length > UNDO_MAX_STEPS) {
      note('notUndoable', row, 'too_many_steps');
      continue;
    }
    if (total + result.steps.length > UNDO_MAX_STEPS) {
      truncated = true;
      break;
    }
    total += result.steps.length;
    expanded.push(result);
  }

  if (expanded.length === 0) {
    const findings = [...notes.leftAlone, ...notes.notUndoable, ...notes.residue].slice(0, 12).map((n) => ({ code: n.reason as string, section: n.op }));
    throw new StageRefusal('nothing_to_undo', undefined, findings);
  }

  const steps = expanded.flatMap((entry) => entry.steps);
  const cards = expanded.flatMap((entry) => entry.cards);
  const card: Omit<ProposalCard, 'planCode'> = {
    v: CARD_VERSION,
    kind: 'undo',
    class: 'G',
    tool: UNDO_TOOL,
    plan: null,
    summary: { steps: steps.length, creates: 0 },
    steps: cards,
    lines: [],
    warnings: [],
    assumptions: [],
    acks: [{ id: EFFECT, kind: 'checkbox', effect: EFFECT }],
    outwardEffects: [{ key: EFFECT, channels: { kind: 'none' } }],
    reversibility: { kind: 'irreversible', reason: 'compensating' },
    existingEntity: false,
    undo: { ...notes, truncated },
  };
  return {
    kind: 'undo',
    class: 'G',
    planId: null,
    planRevision: null,
    steps,
    scopeOf: () => null,
    acks: [EFFECT],
    supersedeKey: `${UNDO_TOOL}:${subject.key}`,
    ttl: 'golive',
    card: (planCode) => ({ ...card, planCode }),
  };
}

/**
 * Delete mode: the delete of a never-published draft replaces every restore of its saves. If the delete is available it is the
 * only step and the saves are listed as residue (`superseded`); if it is not, nothing is staged (the model asked for the delete).
 */
function supersede(plan: UndoPlan, subject: Subject, residue: (row: Row, reason: UndoReason) => void): UndoStep[] {
  const del = plan.steps.find((step) => step.action === 'delete_ruleset_draft');
  if (del === undefined) return [];
  for (const row of subject.rows) if (row.tool === 'ruleset_patch_draft' && row.record.status === 'ok') residue(row, 'superseded');
  return [del];
}

// ─── One entry to its stored steps and card lines ────────────────────────────

interface ExpandEnv {
  fact: Facts;
  nameOf: Map<string, string>;
  playerNames: Readonly<Record<string, string>>;
  pinTargets: Awaited<ReturnType<PrepareContext['deps']['source']['pinTargets']>>;
  draft: Awaited<ReturnType<PrepareContext['deps']['source']['rulesetDraft']>>;
  lastChatRev: number;
}

type Draft = Pick<StepDraft, 'key' | 'op' | 'entity_type' | 'path_params' | 'body_template' | 'targets'>;

function prepared(op: UndoOperation, draft: Draft, precondition: PreconditionEntry): PreparedStep {
  const route = UNDO_ROUTES[op];
  const step: StepDraft = {
    ...draft,
    class: route.class,
    method: route.method,
    route_template: route.routeTemplate,
    query: {},
    min_role: 'any',
    blocked_by: [],
    creates: false,
    ref_key: null,
    verify: 'undo_read_back',
    reversal: 'none',
    outward_effects: [EFFECT],
    preconditions: [],
  };
  return { step, specs: [], touches: [], fixed: [precondition] };
}

const idTarget = (id: string): PreconditionEntry['target'] => ({ kind: 'id', id });
const cardName = (name: string | null | undefined): CardTarget['name'] => (name === undefined || name === null || name === '' ? null : text(name, 120));

async function expand(ctx: PrepareContext, subject: Subject, row: Row, planStep: UndoStep, env: ExpandEnv): Promise<Expanded | { reason: UndoReason }> {
  const { deps, input } = ctx;
  const { fact } = env;
  const record = row.record;
  const stored = record.after_fingerprint ?? UNRECORDED;
  const key = planStep.key;
  switch (planStep.action) {
    case 'archive_league':
    case 'archive_tournament': {
      const league = planStep.action === 'archive_league';
      const id = idOfLedgerResult(record.result) ?? fact.entityId;
      if (id === null) return { reason: 'before_missing' };
      const call = league ? leagueArchiveCall({ id }) : tournamentArchiveCall({ id });
      const op: UndoOperation = league ? 'league_archive' : 'tournament_archive';
      const read = league ? 'league_after' : 'tournament_after';
      return {
        steps: [
          prepared(op, { key, op, entity_type: league ? 'season' : 'tournament', path_params: call.params, body_template: call.body, targets: [{ kind: league ? 'season' : 'tournament', id }] }, { read, target: idTarget(id), fingerprint: stored }),
        ],
        cards: [{ key, op, action: 'archive', target: { entity: league ? 'league' : 'tournament', id, name: cardName(env.nameOf.get(record.id) ?? fact.name) }, items: [], lines: [line('archived_stays_reachable')] }],
      };
    }

    case 'remove_roster': {
      if (fact.leagueId === null || fact.players.length === 0) return { reason: 'before_missing' };
      const calls = rosterRemoveCalls(fact.leagueId, fact.players);
      const steps: PreparedStep[] = [];
      const cards: CardStep[] = [];
      calls.forEach((call, index) => {
        const stepKey = `${key}.${index + 1}`;
        const player = fact.players[index];
        steps.push(
          prepared(
            'roster_remove',
            { key: stepKey, op: 'roster_remove', entity_type: 'season_roster', path_params: call.params, body_template: call.body, targets: [{ kind: 'season', id: fact.leagueId as string }] },
            { read: 'roster_members', target: { kind: 'params', params: { season_id: fact.leagueId, player_ids: [player] } }, fingerprint: stateHash(rosterMembersState([player])) },
          ),
        );
        cards.push({ key: stepKey, op: 'roster_remove', action: 'remove', target: { entity: 'roster', id: fact.leagueId, name: cardName(env.playerNames[player]) }, items: [], lines: [] });
      });
      return { steps, cards };
    }

    case 'remove_tournament_participant': {
      // One add step is one player, so one row is one removal.
      if (fact.tournamentId === null || fact.players.length !== 1) return { reason: 'before_missing' };
      const player = fact.players[0];
      const call = tournamentParticipantRemoveCall(fact.tournamentId, player);
      return {
        steps: [
          prepared(
            'tournament_participant_remove',
            { key, op: 'tournament_participant_remove', entity_type: 'tournament_roster', path_params: call.params, body_template: call.body, targets: [{ kind: 'tournament', id: fact.tournamentId }] },
            { read: 'tournament_members', target: { kind: 'params', params: { tournament_id: fact.tournamentId, player_ids: [player] } }, fingerprint: stateHash(rosterMembersState([player])) },
          ),
        ],
        cards: [{ key, op: 'tournament_participant_remove', action: 'remove', target: { entity: 'player', id: player, name: cardName(env.playerNames[player]) }, items: [], lines: [] }],
      };
    }

    case 'pin_back': {
      const definitionId = fact.entityId;
      const versionId = idOfLedgerResult(record.result);
      const pins = Array.isArray(rec(record.before).pins) ? (rec(record.before).pins as unknown[]).map(rec) : [];
      if (definitionId === null || versionId === null || fact.targets.length === 0) return { reason: 'before_missing' };
      // The version each target pinned before the move, by target.
      const groups = new Map<number, Array<{ kind: 'season' | 'tournament'; id: string }>>();
      for (const target of fact.targets) {
        const before = pins.find((pin) => pin.kind === target.kind && uuidOf(pin.id) === target.id);
        const versionNo = before?.version_no;
        if (typeof versionNo !== 'number' || !Number.isInteger(versionNo) || versionNo < 1) return { reason: 'before_missing' };
        groups.set(versionNo, [...(groups.get(versionNo) ?? []), target]);
      }
      const steps: PreparedStep[] = [];
      const cards: CardStep[] = [];
      let index = 0;
      for (const [versionNo, targets] of [...groups].sort((a, b) => a[0] - b[0])) {
        index += 1;
        const stepKey = `${key}.${index}`;
        const started = targets.filter((target) => env.pinTargets.find((fact2) => fact2.id.toLowerCase() === target.id)?.started === true).map((target) => target.id);
        const call = pinBackCall(definitionId, versionNo, targets, started);
        const impact = await deps.source.pinImpact({ definitionId, toVersionNo: versionNo, targets });
        const items: CardTarget[] = targets.map((target) => ({
          entity: target.kind === 'season' ? 'league' : 'phase',
          id: target.id,
          name: cardName(env.pinTargets.find((fact2) => fact2.id.toLowerCase() === target.id)?.name),
        }));
        const lines: CardLine[] = [
          line('ruleset_changes_live_rules'),
          line('pin_impact', { would_break: impact.wouldBreak, checked: impact.checked, truncated: impact.truncated }),
          ...(started.length > 0 ? [line('pin_started_targets', { count: started.length })] : []),
        ];
        steps.push(
          prepared(
            'move_pin',
            { key: stepKey, op: 'move_pin', entity_type: 'ruleset', path_params: call.params, body_template: call.body, targets: [{ kind: 'ruleset', id: definitionId }, ...targets] },
            {
              read: 'pin_targets',
              target: { kind: 'params', params: { targets: targets.map((target) => ({ kind: target.kind, id: target.id })) } },
              fingerprint: stateHash(pinTargetsState(targets.map((target) => ({ ...target, ruleset_id: versionId })))),
            },
          ),
        );
        cards.push({ key: stepKey, op: 'move_pin', action: 'move_pin', target: { entity: 'ruleset', id: definitionId, name: null, count: targets.length, version_no: versionNo }, items, lines });
      }
      return { steps, cards };
    }

    case 'ruleset_draft_restore': {
      const definitionId = fact.entityId;
      const rev = rec(record.after).draft_rev;
      if (definitionId === null || typeof rev !== 'number') return { reason: 'before_missing' };
      const snapshot = await deps.store.snapshots.getSnapshot(input.admin.id, record.id);
      if (snapshot === null || JSON.stringify(snapshot.document).length > RESTORE_MAX_BYTES) return { reason: 'snapshot_unavailable' };
      const call = restoreDraftCall(definitionId, rev, snapshot.document as JsonValue);
      return {
        steps: [prepared('ruleset_restore_draft', { key, op: 'ruleset_restore_draft', entity_type: 'ruleset', path_params: call.params, body_template: call.body, targets: [{ kind: 'ruleset', id: definitionId }] }, { read: 'ruleset_draft_doc', target: idTarget(definitionId), fingerprint: stored })],
        cards: [{ key, op: 'ruleset_restore_draft', action: 'restore_draft', target: { entity: 'ruleset', id: definitionId, name: cardName(env.draft?.slug) }, items: [], lines: [] }],
      };
    }

    case 'delete_ruleset_draft': {
      const definitionId = fact.entityId;
      if (definitionId === null) return { reason: 'before_missing' };
      const call = deleteDraftCall(definitionId);
      return {
        steps: [
          prepared(
            'ruleset_delete_draft',
            { key, op: 'ruleset_delete_draft', entity_type: 'ruleset', path_params: call.params, body_template: call.body, targets: [{ kind: 'ruleset', id: definitionId }] },
            // The state the chat's last write left (zero versions, that revision), checked again at the step.
            { read: 'ruleset_draft_state', target: idTarget(definitionId), fingerprint: stateHash(draftLifeState(env.lastChatRev, false)) },
          ),
        ],
        cards: [{ key, op: 'ruleset_delete_draft', action: 'delete_draft', target: { entity: 'ruleset', id: definitionId, name: cardName(env.draft?.slug) }, items: [], lines: [] }],
      };
    }

    default:
      // An undo the table offers that this slice does not build (settings, status, groups, formats): never staged, always said.
      return { reason: 'not_offered' };
  }
}
