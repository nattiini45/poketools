import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { PLAYERS, RULESET_VERSION, parseOrThrow, uid } from '../../plans/__tests__/fixtures';
import { hashJson } from '../../plans/hash';
import type { ActionRecord } from '../../store/types';
import { rosterMembersState, tournamentAfterState } from '../after-state';
import { proposalCardSchema } from '../card';
import { storedStepSchema, type StoredStep } from '../steps';
import type { StageRefused, StageStaged } from '../types';
import { CONVERSATION_ID, makeHarness, type MemoryProposal } from './helpers';
import { LiveReads, ledgerRow, scriptLiveReads } from './undo-helpers';

const CUP = uid(7800);
const COUNT = 3;
const cupState = () => tournamentAfterState({ name: 'Friday Cup', description: null, season_id: null, bracket_type: 'single_elim', best_of_default: 3, archived: false, stage_order: null });

const staged = (result: unknown): StageStaged => {
  expect(result).toMatchObject({ status: 'staged' });
  return result as StageStaged;
};
const refused = (result: unknown): StageRefused => {
  expect(result).toMatchObject({ status: 'refused' });
  return result as StageRefused;
};

/** The Build of a standalone tournament with three players, staged for real and "executed" in the ledger. */
async function executedCup(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  const live = new LiveReads();
  h.store.setPlan(
    parseOrThrow({
      v: 1, title: 'Cup', intent: 'tournament', contentLocale: 'en', assumptions: [], refs: {},
      slots: {
        ruleset: { mode: 'existing', version_id: RULESET_VERSION },
        tournament: { name: 'Friday Cup', bracket_type: 'single_elim', best_of: 3, is_doubles: false, team_visibility: 'hidden_until_match', ruleset: 'plan' },
        roster: { entries: PLAYERS.slice(0, COUNT).map((player_id, i) => ({ input: `P${i}`, state: 'resolved' as const, player_id })), target_count: COUNT },
      },
    }),
  );
  h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
  const result = await h.stage('propose_build', { plan_revision: 1 });
  if (result.status !== 'staged') throw new Error(`staging refused: ${JSON.stringify(result)}`);
  const row = h.store.proposals.find((candidate) => candidate.id === result.proposal_id) as MemoryProposal;
  row.status = 'completed';
  const steps = row.steps as unknown as StoredStep[];

  const rows: Record<string, ActionRecord> = {};
  for (const step of steps) {
    const base = { proposal_id: row.id, step_key: step.key, tool_name: step.op, class: step.class, args: { path_params: step.path_params, query: step.query, body_template: step.body_template } as never, entity_type: step.entity_type };
    if (step.op === 'tournament_create') {
      live.set('tournament_after', { kind: 'id', id: CUP }, cupState());
      rows[step.key] = ledgerRow({ ...base, result: { id: CUP } as never, entity_id: CUP, after_fingerprint: hashJson(cupState()) });
    } else {
      const player = (step.body_template as { player_id: string }).player_id;
      live.set('tournament_members', { kind: 'params', params: { tournament_id: CUP, player_ids: [player] } }, rosterMembersState([player]));
      rows[step.key] = ledgerRow({ ...base, entity_id: null, after_fingerprint: hashJson(rosterMembersState([player])) });
    }
    h.store.actions.push(rows[step.key]);
  }
  h.store.see(CONVERSATION_ID, row.id);
  scriptLiveReads(h, live);
  return { h, live, row, rows };
}

const lastRow = (h: ReturnType<typeof makeHarness>) => {
  const row = h.store.proposals[h.store.proposals.length - 1];
  return { row, steps: storedStepSchema.array().parse(row.steps), card: proposalCardSchema.parse(row.preview) };
};

describe('propose_undo of a standalone tournament Build', () => {
  it('removes each player (newest first) and archives the tournament, each step guarded by its own state', async () => {
    const { h, row, rows } = await executedCup({ source: { undo: { locks: { tournamentStarted: false }, playerNames: { [PLAYERS[0]]: 'Real Player 1' } } } });
    staged(await h.stage('propose_undo', { proposal_id: row.id }));
    const { steps, card } = lastRow(h);

    expect(steps.map((step) => step.op)).toEqual(['tournament_participant_remove', 'tournament_participant_remove', 'tournament_participant_remove', 'tournament_archive']);
    expect(steps[0]).toMatchObject({
      key: `undo.${rows['roster.3'].id}`,
      class: 'B',
      method: 'DELETE',
      route_template: '/api/tournaments/[id]/participants',
      path_params: { id: CUP },
      body_template: { player_id: PLAYERS[2] },
      blocked_by: [],
      targets: [{ kind: 'tournament', id: CUP }],
    });
    expect(steps[0].preconditions).toEqual([{ read: 'tournament_members', target: { kind: 'params', params: { tournament_id: CUP, player_ids: [PLAYERS[2]] } }, fingerprint: hashJson(rosterMembersState([PLAYERS[2]])) }]);
    expect(steps[3]).toMatchObject({ method: 'PATCH', route_template: '/api/tournaments/[id]', path_params: { id: CUP }, body_template: { archived: true } });

    expect(card.steps.map((step) => [step.action, step.target.entity])).toEqual([['remove', 'player'], ['remove', 'player'], ['remove', 'player'], ['archive', 'tournament']]);
    expect(card.steps[2].target).toMatchObject({ id: PLAYERS[0], name: { text: 'Real Player 1', hidden: 0 } });
    expect(card.undo?.notUndoable).toEqual([]);
  });

  it('keeps the players on a tournament that has started, with the reason on the card; the archive stays offered', async () => {
    const { h, row } = await executedCup({ source: { undo: { locks: { tournamentStarted: true }, playerNames: {} } } });
    staged(await h.stage('propose_undo', { proposal_id: row.id }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.op)).toEqual(['tournament_archive']);
    expect(card.undo?.notUndoable.map((note) => [note.op, note.reason])).toEqual([
      ['tournament_participant_add', 'locked_tournament'],
      ['tournament_participant_add', 'locked_tournament'],
      ['tournament_participant_add', 'locked_tournament'],
    ]);
  });

  it('leaves a player alone when he was removed by hand since, and runs the tournament guard before any read', async () => {
    const { h, live, row, rows } = await executedCup();
    live.set('tournament_members', { kind: 'params', params: { tournament_id: CUP, player_ids: [PLAYERS[1]] } }, rosterMembersState([]));
    h.guards.length = 0;
    staged(await h.stage('propose_undo', { proposal_id: row.id }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.key)).toEqual([`undo.${rows['roster.3'].id}`, `undo.${rows['roster.1'].id}`, `undo.${rows.tournament.id}`]);
    expect(card.undo?.leftAlone.map((note) => [note.op, note.reason])).toEqual([['tournament_participant_add', 'edited_outside']]);
    expect(h.guards.map((guard) => guard.kind)).toEqual(['tournament']);
  });

  it('asks the source about the tournaments and the players only once each', async () => {
    const { h, row } = await executedCup();
    const seen: unknown[] = [];
    const original = h.deps.source.undoFacts;
    h.deps.source.undoFacts = async (input) => {
      seen.push(input);
      return original(input);
    };
    staged(await h.stage('propose_undo', { proposal_id: row.id }));
    expect(seen).toEqual([{ leagueIds: [], playerIds: expect.arrayContaining(PLAYERS.slice(0, COUNT)), tournamentIds: [CUP] }]);
  });

  it('refuses when nothing can be undone any more', async () => {
    const { h, live, row } = await executedCup({ source: { undo: { locks: { tournamentStarted: true }, playerNames: {} } } });
    live.set('tournament_after', { kind: 'id', id: CUP }, tournamentAfterState({ name: 'Renamed', description: null, season_id: null, bracket_type: 'single_elim', best_of_default: 3, archived: false, stage_order: null }));
    expect(refused(await h.stage('propose_undo', { proposal_id: row.id })).code).toBe('nothing_to_undo');
  });
});
