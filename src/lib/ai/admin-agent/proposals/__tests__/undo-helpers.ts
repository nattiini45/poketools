/**
 * Fixtures for the undo tests: a forward Build "executed" in the ledger (the plan 4.10 worked example, with the ids, results,
 * after-fingerprints and entity ids the executor records), scripted live reads that a test changes to simulate a human edit,
 * and ledger rows for the Go-live and draft writes an undo reverses. Nothing reaches a database or a route.
 */
import { uid, PLAYERS } from '../../plans/__tests__/fixtures';
import { hashJson } from '../../plans/hash';
import type { ActionRecord } from '../../store/types';
import { draftDocState, draftLifeState, pinTargetsState, rosterMembersState, sortedIds } from '../after-state';
import type { FingerprintSource, ReadName, ReadTarget } from '../fingerprints';
import type { StoredStep } from '../steps';
import { ADMIN, CONVERSATION_ID, DEFINITION_ID, SEASON_ID, TOURNAMENT_ID, makeHarness, seeWorkedExample, type MemoryProposal } from './helpers';

export const LEAGUE = uid(7001);
export const PHASES = { regular_season: uid(7101), playoffs: uid(7102) } as const;
export const V1 = uid(9101);
export const V2 = uid(9102);
export const V3 = uid(9103);

/** The scripted live state of every read, keyed by read and target. A test changes it to simulate someone else's edit. */
export class LiveReads implements FingerprintSource {
  state = new Map<string, unknown>();
  reads: string[] = [];
  private key(read: ReadName, target: ReadTarget): string {
    return `${read}|${hashJson(target)}`;
  }
  set(read: ReadName, target: ReadTarget, value: unknown): void {
    this.state.set(this.key(read, target), value);
  }
  async read(read: ReadName, target: ReadTarget): Promise<never> {
    this.reads.push(read);
    // A read nobody scripted is "gone" (null), like a missing row.
    return (this.state.get(this.key(read, target)) ?? null) as never;
  }
}

export const leagueState = (name = 'Gen 9 OU League') => ({
  name,
  description: '',
  format_type: 'singles',
  status: 'upcoming',
  archived: false,
  start_date: null,
  end_date: null,
  ruleset_id: uid(9001),
  language: 'de',
});

type Harness = ReturnType<typeof makeHarness>;
let counter = 0;

/** One ledger row, as the executor leaves it. */
export function ledgerRow(overrides: Partial<ActionRecord>): ActionRecord {
  counter += 1;
  return {
    id: uid(60000 + counter),
    conversation_id: CONVERSATION_ID,
    admin_id: ADMIN,
    status: 'ok',
    tool_use_id: null,
    class: 'B',
    args: {},
    result: null,
    before: null,
    after: null,
    after_fingerprint: null,
    entity_id: null,
    entity_type: null,
    step_key: null,
    proposal_id: null,
    error_code: null,
    http_status: null,
    ...overrides,
  } as ActionRecord;
}

export interface ForwardBuild {
  proposalId: string;
  row: MemoryProposal;
  steps: StoredStep[];
  rows: Record<string, ActionRecord>;
}

/**
 * Stages the worked example through the real stager, then writes the ledger the executor would have written for it and marks
 * the proposal `completed`. The scripted live state is the state right after the Build.
 */
export async function executedBuild(h: Harness, live: LiveReads): Promise<ForwardBuild> {
  seeWorkedExample(h);
  const staged = await h.stage('propose_build', { plan_revision: 1 });
  if (staged.status !== 'staged') throw new Error(`staging refused: ${JSON.stringify(staged)}`);
  const row = h.store.proposals.find((candidate) => candidate.id === staged.proposal_id) as MemoryProposal;
  const steps = row.steps as unknown as StoredStep[];
  row.status = 'completed';

  const rows: Record<string, ActionRecord> = {};
  const ledger = (step: StoredStep, extra: Partial<ActionRecord>) => {
    const record = ledgerRow({
      proposal_id: row.id,
      step_key: step.key,
      tool_name: step.op,
      class: step.class,
      args: { path_params: step.path_params, query: step.query, body_template: step.body_template } as never,
      entity_type: step.entity_type,
      ...extra,
    });
    rows[step.key] = record;
    h.store.actions.push(record);
  };
  const rosterTarget = { kind: 'params', params: { season_id: LEAGUE, player_ids: sortedIds(PLAYERS) } } as const;
  for (const step of steps) {
    if (step.op === 'league_create') {
      live.set('league_after', { kind: 'id', id: LEAGUE }, leagueState());
      ledger(step, { result: { id: LEAGUE, ruleset_id: uid(9001) } as never, entity_id: LEAGUE, after_fingerprint: hashJson(leagueState()) });
    } else if (step.op === 'roster_add') {
      live.set('roster_members', rosterTarget, rosterMembersState(PLAYERS));
      // Each removal step is guarded by its own player.
      for (const player of sortedIds(PLAYERS)) live.set('roster_members', { kind: 'params', params: { season_id: LEAGUE, player_ids: [player] } }, rosterMembersState([player]));
      ledger(step, { entity_id: null, after_fingerprint: hashJson(rosterMembersState(PLAYERS)) });
    } else {
      const id = step.key === 'phase.playoffs' ? PHASES.playoffs : PHASES.regular_season;
      ledger(step, { result: { id } as never, entity_id: id });
    }
  }
  h.store.see(CONVERSATION_ID, row.id);
  return { proposalId: row.id, row, steps, rows };
}

/** Replaces the stager's live reads with the scripted ones (the Build was staged with the harness's own world). */
export function scriptLiveReads(h: Harness, live: LiveReads): void {
  (h.deps.source as { fingerprints: FingerprintSource }).fingerprints = live;
}

export const rosterTargetOf = (players: readonly string[] = PLAYERS) => ({ kind: 'params', params: { season_id: LEAGUE, player_ids: sortedIds(players) } }) as const;

// ─── A pin move in the ledger ────────────────────────────────────────────────

export const PIN_TARGETS = [
  { kind: 'season' as const, id: SEASON_ID },
  { kind: 'tournament' as const, id: TOURNAMENT_ID },
];

/** An executed `move_pin` of two targets to version 3, which pinned versions 1 and 2 before. */
export function executedPinMove(h: Harness, live: LiveReads, before: Array<{ kind: 'season' | 'tournament'; id: string; version_id: string | null; version_no: number | null }> | null = null): { proposalId: string; row: ActionRecord } {
  const proposalId = uid(4900);
  h.store.proposals.push({
    id: proposalId,
    conversation_id: CONVERSATION_ID,
    admin_id: ADMIN,
    kind: 'action',
    class: 'G',
    status: 'completed',
    steps: [],
    preview: {},
    expires_at: '2099-01-01T00:00:00.000Z',
  } as unknown as MemoryProposal);
  const after = pinTargetsState(PIN_TARGETS.map((target) => ({ ...target, ruleset_id: V3 })));
  live.set('pin_targets', { kind: 'params', params: { targets: PIN_TARGETS } }, after);
  // Each pin-back step is guarded by the targets of its own group.
  for (const target of PIN_TARGETS) live.set('pin_targets', { kind: 'params', params: { targets: [target] } }, pinTargetsState([{ ...target, ruleset_id: V3 }]));
  const row = ledgerRow({
    proposal_id: proposalId,
    step_key: 'move_pin',
    tool_name: 'move_pin',
    class: 'G',
    args: { path_params: { id: DEFINITION_ID }, query: {}, body_template: { to_version_no: 3, targets: PIN_TARGETS } } as never,
    result: { id: V3 } as never,
    entity_type: 'ruleset',
    entity_id: DEFINITION_ID,
    before:
      (before === null
        ? {
            pins: [
              { kind: 'season', id: SEASON_ID, version_id: V1, version_no: 1 },
              { kind: 'tournament', id: TOURNAMENT_ID, version_id: V2, version_no: 2 },
            ],
          }
        : { pins: before }) as never,
    after_fingerprint: hashJson(after),
  });
  h.store.actions.push(row);
  h.store.see(CONVERSATION_ID, proposalId);
  return { proposalId, row };
}

// ─── Ruleset drafts written by the chat ──────────────────────────────────────

export const DOC_HASH = 'd'.repeat(64);

/** A `ruleset_create_draft` (revision 1) followed by a `ruleset_patch_draft` that left revision 2. */
export function draftWrites(h: Harness, live: LiveReads, options: { patches?: number } = {}): { create: ActionRecord; patches: ActionRecord[] } {
  const create = ledgerRow({
    tool_use_id: 'tu-create',
    tool_name: 'ruleset_create_draft',
    class: 'D',
    result: { ruleset_id: DEFINITION_ID, draft_rev: 1 } as never,
    entity_type: 'ruleset',
    entity_id: DEFINITION_ID,
    after_fingerprint: hashJson(draftLifeState(1, false)),
  });
  h.store.actions.push(create);
  const patches: ActionRecord[] = [];
  for (let index = 0; index < (options.patches ?? 1); index += 1) {
    const rev = index + 2;
    const patch = ledgerRow({
      tool_use_id: `tu-patch-${rev}`,
      tool_name: 'ruleset_patch_draft',
      class: 'D',
      result: { ruleset_id: DEFINITION_ID, draft_rev: rev } as never,
      before: { ruleset_id: DEFINITION_ID, draft_rev: rev - 1, doc_hash: 'b'.repeat(64) } as never,
      after: { ruleset_id: DEFINITION_ID, draft_rev: rev, doc_hash: DOC_HASH } as never,
      entity_type: 'ruleset',
      entity_id: DEFINITION_ID,
      after_fingerprint: hashJson(draftDocState(rev, DOC_HASH)),
    });
    h.store.actions.push(patch);
    h.store.snapshots.set(patch.id, { document: { schema: 1, rev: rev - 1 }, doc_hash: 'b'.repeat(64) });
    patches.push(patch);
  }
  const last = (options.patches ?? 1) + 1;
  live.set('ruleset_draft_doc', { kind: 'id', id: DEFINITION_ID }, draftDocState(last, DOC_HASH));
  live.set('ruleset_draft_state', { kind: 'id', id: DEFINITION_ID }, draftLifeState(last, false));
  h.store.see(CONVERSATION_ID, DEFINITION_ID);
  return { create, patches };
}
