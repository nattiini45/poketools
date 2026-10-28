import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { PLAYERS } from '../../plans/__tests__/fixtures';
import { hashJson } from '../../plans/hash';
import { UNDO_MAX_STEPS } from '../../plans/undo';
import { draftLifeState, pinTargetsState, rosterMembersState, sortedIds } from '../after-state';
import { proposalCardSchema } from '../card';
import { storedStepSchema } from '../steps';
import type { StageRefused, StageStaged } from '../types';
import { ADMIN, CONVERSATION_ID, DEFINITION_ID, OTHER_ADMIN, SEASON_ID, TOURNAMENT_ID, forbidden, makeHarness } from './helpers';
import {
  DOC_HASH,
  LEAGUE,
  LiveReads,
  PIN_TARGETS,
  V1,
  V2,
  V3,
  draftWrites,
  executedBuild,
  executedPinMove,
  leagueState,
  ledgerRow,
  rosterTargetOf,
  scriptLiveReads,
} from './undo-helpers';

const staged = (result: unknown): StageStaged => {
  expect(result).toMatchObject({ status: 'staged' });
  return result as StageStaged;
};
const refused = (result: unknown): StageRefused => {
  expect(result).toMatchObject({ status: 'refused' });
  return result as StageRefused;
};

const lastRow = (h: ReturnType<typeof makeHarness>) => {
  const row = h.store.proposals[h.store.proposals.length - 1];
  return { row, steps: storedStepSchema.array().parse(row.steps), card: proposalCardSchema.parse(row.preview) };
};

async function builtWorld(options: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness(options);
  const live = new LiveReads();
  const forward = await executedBuild(h, live);
  scriptLiveReads(h, live);
  return { h, live, forward };
}

describe('propose_undo of an executed Build: the worked example', () => {
  it('stages the roster removes (one per player) and the league archive, newest first, and lists the phases as residue', async () => {
    const { h, forward } = await builtWorld();
    const result = staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(result).toMatchObject({ kind: 'undo', class: 'G' });

    const { row, steps, card } = lastRow(h);
    expect(row).toMatchObject({ kind: 'undo', class: 'G', plan_id: null, supersede_key: `propose_undo:${forward.proposalId}` });
    expect(steps.map((step) => step.op)).toEqual([...PLAYERS.map(() => 'roster_remove'), 'league_archive']);
    expect(steps.length).toBeLessThanOrEqual(UNDO_MAX_STEPS);

    // One remove per player, in the roster's order, each filed under the roster row's step key.
    const rosterRow = forward.rows['roster.1'];
    const players = sortedIds(PLAYERS);
    expect(steps.slice(0, 12).map((step) => step.key)).toEqual(players.map((_, index) => `undo.${rosterRow.id}.${index + 1}`));
    expect(steps[0]).toMatchObject({ class: 'B', method: 'DELETE', route_template: '/api/seasons/[id]/participants', path_params: { id: LEAGUE }, body_template: { player_id: players[0] }, blocked_by: [] });
    expect(steps[12]).toMatchObject({
      key: `undo.${forward.rows.league.id}`,
      class: 'B',
      method: 'PATCH',
      route_template: '/api/seasons/[id]',
      path_params: { id: LEAGUE },
      body_template: { archived: true },
    });

    // Each step carries its OWN precondition: the state the chat's write left, not read again.
    expect(steps[0].preconditions).toEqual([{ read: 'roster_members', target: { kind: 'params', params: { season_id: LEAGUE, player_ids: [players[0]] } }, fingerprint: hashJson(rosterMembersState([players[0]])) }]);
    expect(steps[12].preconditions).toEqual([{ read: 'league_after', target: { kind: 'id', id: LEAGUE }, fingerprint: forward.rows.league.after_fingerprint }]);

    expect(card).toMatchObject({ kind: 'undo', class: 'G', tool: 'propose_undo', plan: null, existingEntity: false, reversibility: { kind: 'irreversible', reason: 'compensating' } });
    expect(card.steps.map((step) => [step.action, step.target.entity])).toEqual([...PLAYERS.map(() => ['remove', 'roster']), ['archive', 'league']]);
    expect(card.steps[12].lines).toEqual([{ kind: 'archived_stays_reachable' }]);
    expect(card.undo).toEqual({
      leftAlone: [],
      residue: [
        { op: 'phase_create', entity: 'phase', id: expect.any(String), name: { text: 'Playoffs', hidden: 0 }, reason: 'residue' },
        { op: 'phase_create', entity: 'phase', id: expect.any(String), name: { text: 'Regular season', hidden: 0 }, reason: 'residue' },
      ],
      notUndoable: [],
      truncated: false,
    });
    expect(row.acks_required).toEqual(['compensating_changes']);
    expect(card.acks).toEqual([{ id: 'compensating_changes', kind: 'checkbox', effect: 'compensating_changes' }]);
  });

  it('reads the live fingerprints once per entity and runs the guards before any read', async () => {
    const { h, live } = await builtWorld();
    live.reads.length = 0;
    h.guards.length = 0;
    const proposalId = h.store.proposals[0].id;
    staged(await h.stage('propose_undo', { proposal_id: proposalId }));
    expect(h.guards.map((guard) => guard.kind)).toEqual(['season']);
    expect(live.reads.sort()).toEqual(['league_after', 'roster_members']);
  });

  it('leaves the league alone when it was edited outside the chat, and still removes the roster', async () => {
    const { h, live, forward } = await builtWorld();
    live.set('league_after', { kind: 'id', id: LEAGUE }, leagueState('Renamed by a human'));
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));

    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.op)).toEqual(PLAYERS.map(() => 'roster_remove'));
    expect(card.undo?.leftAlone).toEqual([{ op: 'league_create', entity: 'league', id: LEAGUE, name: { text: 'Renamed by a human', hidden: 0 }, reason: 'edited_outside' }]);
  });

  it('refuses a roster undo when a player left or joined in between, with the reason on the card', async () => {
    const { h, live, forward } = await builtWorld();
    live.set('roster_members', rosterTargetOf(), rosterMembersState(PLAYERS.slice(1)));
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.op)).toEqual(['league_archive']);
    expect(card.undo?.leftAlone.map((note) => [note.op, note.reason])).toEqual([['roster_add', 'edited_outside']]);
  });

  it('does not offer the roster removes once a round exists (the reason is listed), and still offers the archive', async () => {
    const { h, forward } = await builtWorld({ source: { undo: { locks: { roundsExist: true }, playerNames: {} } } });
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.op)).toEqual(['league_archive']);
    expect(card.undo?.notUndoable).toEqual([{ op: 'roster_add', entity: 'roster', id: LEAGUE, name: null, reason: 'locked_rounds' }]);
  });

  it('names the players on the roster steps', async () => {
    const names = Object.fromEntries(sortedIds(PLAYERS).map((id, index) => [id, `Player ${index + 1}`]));
    const { h, forward } = await builtWorld({ source: { undo: { locks: {}, playerNames: names } } });
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(lastRow(h).card.steps.slice(0, 3).map((step) => step.target.name?.text)).toEqual(['Player 1', 'Player 2', 'Player 3']);
  });

  it('caps one proposal at 20 steps: a roster that alone needs more is not undoable here, with its reason', async () => {
    const h = makeHarness();
    const live = new LiveReads();
    const forward = await executedBuild(h, live);
    scriptLiveReads(h, live);
    // The same roster entry, but with 25 players.
    const many = Array.from({ length: 25 }, (_, index) => `00000000-0000-4000-8000-0000000${String(100 + index).padStart(5, '0')}`);
    const rosterRow = forward.rows['roster.1'];
    (rosterRow.args as { body_template: { player_ids: string[] } }).body_template.player_ids = many;
    live.set('roster_members', rosterTargetOf(many), rosterMembersState(many));
    rosterRow.after_fingerprint = hashJson(rosterMembersState(many));
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => step.op)).toEqual(['league_archive']);
    expect(card.undo?.notUndoable.map((note) => note.reason)).toEqual(['too_many_steps']);
  });

  it('refuses another conversation\'s and another admin\'s proposal, and one that has not run, as not found or nothing to undo', async () => {
    const { h, forward } = await builtWorld();
    const mine = forward.row;
    mine.conversation_id = '00000000-0000-4000-8000-0000000fffff';
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId })).code).toBe('proposal_not_found');
    mine.conversation_id = CONVERSATION_ID;
    mine.admin_id = OTHER_ADMIN;
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId })).code).toBe('proposal_not_found');
    mine.admin_id = ADMIN;
    mine.status = 'proposed';
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId })).code).toBe('nothing_to_undo');
    expect(h.store.proposals.filter((row) => row.kind === 'undo')).toHaveLength(0);
  });

  it('checks provenance before any guard: an id the conversation never saw is unknown_reference', async () => {
    const { h, forward } = await builtWorld();
    h.store.known.clear();
    h.guards.length = 0;
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId })).code).toBe('unknown_reference');
    expect(h.guards).toEqual([]);
  });

  it('says nothing is left to undo the second time: the rows are undone', async () => {
    const { h, forward } = await builtWorld();
    for (const row of h.store.actions) row.status = 'undone';
    const result = refused(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(result.code).toBe('nothing_to_undo');
  });

  it('refuses with the per-entry reasons as findings when everything was edited outside', async () => {
    const { h, live, forward } = await builtWorld();
    live.set('league_after', { kind: 'id', id: LEAGUE }, leagueState('x'));
    live.set('roster_members', rosterTargetOf(), []);
    const result = refused(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(result.code).toBe('nothing_to_undo');
    expect(result.findings?.map((finding) => [finding.section, finding.code])).toEqual([
      ['roster_add', 'edited_outside'],
      ['league_create', 'edited_outside'],
      ['phase_create', 'residue'],
      ['phase_create', 'residue'],
    ]);
  });

  it('passes a guard refusal through (the admin no longer administers the league)', async () => {
    const { h, forward } = await builtWorld({ refuseGuard: { season: forbidden('forbidden') } });
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId })).code).toBe('forbidden');
  });

  it('fails closed on a ledger row without an after-fingerprint (an old row): the entry is not undoable', async () => {
    const { h, forward } = await builtWorld();
    forward.rows.league.after_fingerprint = null;
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(lastRow(h).card.undo?.notUndoable).toEqual([expect.objectContaining({ op: 'league_create', reason: 'fingerprint_unavailable' })]);
  });

  it('stages at most 2 pending cards and supersedes the older undo of the same proposal', async () => {
    const { h, forward } = await builtWorld();
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    h.turn.goLive = 0;
    h.turn.stagings = 0;
    staged(await h.stage('propose_undo', { proposal_id: forward.proposalId }));
    expect(h.store.proposals.filter((row) => row.kind === 'undo').map((row) => row.status)).toEqual(['superseded', 'proposed']);
  });

  it('validates its arguments: one subject, and draft_rev only with a ruleset', async () => {
    const { h, forward } = await builtWorld();
    expect(refused(await h.stage('propose_undo', {})).code).toBe('validation_failed');
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId, ruleset_id: DEFINITION_ID })).code).toBe('validation_failed');
    expect(refused(await h.stage('propose_undo', { proposal_id: forward.proposalId, draft_rev: 2 })).code).toBe('validation_failed');
  });
});

describe('propose_undo of a pin move', () => {
  const setup = async (before?: Parameters<typeof executedPinMove>[2], source: Parameters<typeof makeHarness>[0] = {}) => {
    const h = makeHarness(source);
    const live = new LiveReads();
    const { proposalId } = executedPinMove(h, live, before);
    scriptLiveReads(h, live);
    h.store.see(CONVERSATION_ID, DEFINITION_ID, SEASON_ID, TOURNAMENT_ID);
    return { h, live, proposalId };
  };

  it('moves every target back to the version it pinned, one step per previous version, each with its own precondition', async () => {
    const { h, proposalId } = await setup();
    staged(await h.stage('propose_undo', { proposal_id: proposalId }));
    const { steps, card } = lastRow(h);
    expect(steps.map((step) => [step.op, step.class, step.body_template])).toEqual([
      ['move_pin', 'G', { to_version_no: 1, targets: [{ kind: 'season', id: SEASON_ID }] }],
      ['move_pin', 'G', { to_version_no: 2, targets: [{ kind: 'tournament', id: TOURNAMENT_ID }] }],
    ]);
    expect(steps[0]).toMatchObject({ method: 'POST', route_template: '/api/ruleset-definitions/[id]/pins', path_params: { id: DEFINITION_ID } });
    expect(steps[0].preconditions).toEqual([
      { read: 'pin_targets', target: { kind: 'params', params: { targets: [{ kind: 'season', id: SEASON_ID }] } }, fingerprint: hashJson(pinTargetsState([{ kind: 'season', id: SEASON_ID, ruleset_id: V3 }])) },
    ]);
    expect(card.steps.map((step) => [step.action, step.target.version_no, step.items.length])).toEqual([
      ['move_pin', 1, 1],
      ['move_pin', 2, 1],
    ]);
    expect(card.steps[0].lines.map((line) => line.kind)).toEqual(['ruleset_changes_live_rules', 'pin_impact']);
  });

  it('passes confirm_started for a started target', async () => {
    const targets = (list: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }>) =>
      list.map((target) => ({ kind: target.kind, id: target.id, name: 'x', started: target.kind === 'season', completed: false, pinnedVersionId: V3, pinnedDefinitionId: DEFINITION_ID }));
    const { h, proposalId } = await setup(undefined, { source: { targets } });
    staged(await h.stage('propose_undo', { proposal_id: proposalId }));
    const { steps, card } = lastRow(h);
    expect(steps[0].body_template).toEqual({ to_version_no: 1, targets: [{ kind: 'season', id: SEASON_ID }], confirm_started: [SEASON_ID] });
    expect(steps[1].body_template).not.toHaveProperty('confirm_started');
    expect(card.steps[0].lines.map((line) => line.kind)).toContain('pin_started_targets');
  });

  it('is refused for a completed target (ruleset_pin_locked) and says why', async () => {
    const targets = (list: ReadonlyArray<{ kind: 'season' | 'tournament'; id: string }>) =>
      list.map((target) => ({ kind: target.kind, id: target.id, name: 'x', started: true, completed: target.kind === 'tournament', pinnedVersionId: V3, pinnedDefinitionId: DEFINITION_ID }));
    const { h, proposalId } = await setup(undefined, { source: { targets } });
    const result = refused(await h.stage('propose_undo', { proposal_id: proposalId }));
    expect(result.code).toBe('nothing_to_undo');
    expect(result.findings).toEqual([{ section: 'move_pin', code: 'pin_locked' }]);
  });

  it('leaves the move alone when a target was moved by someone else', async () => {
    const { h, live, proposalId } = await setup();
    live.set('pin_targets', { kind: 'params', params: { targets: PIN_TARGETS } }, pinTargetsState([{ ...PIN_TARGETS[0], ruleset_id: V3 }, { ...PIN_TARGETS[1], ruleset_id: V1 }]));
    expect(refused(await h.stage('propose_undo', { proposal_id: proposalId })).findings).toEqual([{ section: 'move_pin', code: 'edited_outside' }]);
  });

  it('is not undoable when the ledger did not record the previous version (before_missing)', async () => {
    const { h, proposalId } = await setup([
      { kind: 'season', id: SEASON_ID, version_id: V1, version_no: 1 },
      { kind: 'tournament', id: TOURNAMENT_ID, version_id: null, version_no: null },
    ]);
    expect(refused(await h.stage('propose_undo', { proposal_id: proposalId })).findings).toEqual([{ section: 'move_pin', code: 'before_missing' }]);
  });

  it('lists a publish, a start and a bracket as not undoable with their reasons', async () => {
    const { h, proposalId } = await setup();
    for (const tool of ['publish_ruleset', 'start_phase', 'generate_bracket']) {
      h.store.actions.push(ledgerRow({ proposal_id: proposalId, step_key: tool, tool_name: tool, class: 'G', entity_id: TOURNAMENT_ID, entity_type: 'tournament' }));
    }
    staged(await h.stage('propose_undo', { proposal_id: proposalId }));
    expect(lastRow(h).card.undo?.notUndoable.map((note) => [note.op, note.reason])).toEqual([
      ['generate_bracket', 'outward_effect'],
      ['start_phase', 'outward_effect'],
      ['publish_ruleset', 'immutable'],
    ]);
  });
});

describe('propose_undo of the ruleset drafts the chat wrote', () => {
  it('restores the snapshot of one save, at the revision that save left', async () => {
    const h = makeHarness();
    const live = new LiveReads();
    const { patches } = draftWrites(h, live);
    scriptLiveReads(h, live);

    staged(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID, draft_rev: 2 }));
    const { steps, card } = lastRow(h);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      key: `undo.${patches[0].id}`,
      op: 'ruleset_restore_draft',
      class: 'D',
      method: 'PUT',
      route_template: '/api/ruleset-definitions/[id]/draft',
      path_params: { id: DEFINITION_ID },
      body_template: { draft_rev: 2, document: { schema: 1, rev: 1 } },
      preconditions: [{ read: 'ruleset_draft_doc', target: { kind: 'id', id: DEFINITION_ID }, fingerprint: patches[0].after_fingerprint }],
    });
    expect(card.steps[0]).toMatchObject({ action: 'restore_draft', target: { entity: 'ruleset', id: DEFINITION_ID } });
  });

  it('leaves it alone when a human saved since (the revision and hash differ)', async () => {
    const h = makeHarness();
    const live = new LiveReads();
    draftWrites(h, live);
    scriptLiveReads(h, live);
    live.set('ruleset_draft_doc', { kind: 'id', id: DEFINITION_ID }, { draft_rev: 3, doc_hash: 'e'.repeat(64) });
    const result = refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID, draft_rev: 2 }));
    expect(result.findings).toEqual([{ section: 'ruleset_patch_draft', code: 'edited_outside' }]);
  });

  it('says the previous version is gone when the snapshot expired, and never restores a snapshot that does not fit the ledger row', async () => {
    const h = makeHarness();
    const live = new LiveReads();
    const { patches } = draftWrites(h, live);
    scriptLiveReads(h, live);
    h.store.snapshots.delete(patches[0].id);
    expect(refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID, draft_rev: 2 })).findings).toEqual([{ section: 'ruleset_patch_draft', code: 'snapshot_unavailable' }]);
    h.store.snapshots.set(patches[0].id, { document: { big: 'x'.repeat(60 * 1024) }, doc_hash: 'b'.repeat(64) });
    expect(refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID, draft_rev: 2 })).findings).toEqual([{ section: 'ruleset_patch_draft', code: 'snapshot_unavailable' }]);
  });

  it('knows no save at a revision the chat never left', async () => {
    const h = makeHarness();
    const live = new LiveReads();
    draftWrites(h, live);
    scriptLiveReads(h, live);
    expect(refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID, draft_rev: 9 })).code).toBe('nothing_to_undo');
  });

  describe('the second carve-out: a draft created here and never published is deleted', () => {
    it('stages the delete, with the state the chat\'s last write left as its precondition, and no restores', async () => {
      const h = makeHarness();
      const live = new LiveReads();
      const { create } = draftWrites(h, live, { patches: 2 });
      scriptLiveReads(h, live);

      staged(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID }));
      const { steps, card } = lastRow(h);
      expect(steps.map((step) => step.op)).toEqual(['ruleset_delete_draft']);
      expect(steps[0]).toMatchObject({
        key: `undo.${create.id}`,
        class: 'G',
        method: 'DELETE',
        route_template: '/api/ruleset-definitions/[id]',
        path_params: { id: DEFINITION_ID },
        body_template: null,
        preconditions: [{ read: 'ruleset_draft_state', target: { kind: 'id', id: DEFINITION_ID }, fingerprint: hashJson(draftLifeState(3, false)) }],
      });
      expect(card.steps[0]).toMatchObject({ action: 'delete_draft', target: { entity: 'ruleset', id: DEFINITION_ID } });
      // The saves are replaced by the delete: listed, never staged as restores next to it.
      expect(card.undo?.residue.map((note) => [note.op, note.reason])).toEqual([['ruleset_patch_draft', 'superseded'], ['ruleset_patch_draft', 'superseded']]);
    });

    it('is residue once any version exists, and nothing is staged', async () => {
      const h = makeHarness({ source: { draft: { currentVersionId: V1 } } });
      const live = new LiveReads();
      draftWrites(h, live);
      scriptLiveReads(h, live);
      const result = refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID }));
      expect(result.code).toBe('nothing_to_undo');
      expect(result.findings).toEqual(expect.arrayContaining([{ section: 'ruleset_create_draft', code: 'ruleset_published' }]));
      expect(h.store.proposals.filter((row) => row.kind === 'undo')).toHaveLength(0);
    });

    it('reads a version in the live draft as residue, not as an edit outside the chat', async () => {
      const h = makeHarness();
      const live = new LiveReads();
      draftWrites(h, live);
      scriptLiveReads(h, live);
      live.set('ruleset_draft_state', { kind: 'id', id: DEFINITION_ID }, draftLifeState(2, true));
      const result = refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID }));
      expect(result.findings).toEqual(expect.arrayContaining([{ section: 'ruleset_create_draft', code: 'ruleset_published' }]));
    });

    it('leaves it alone when a human saved the draft after the last chat write', async () => {
      const h = makeHarness();
      const live = new LiveReads();
      draftWrites(h, live);
      scriptLiveReads(h, live);
      live.set('ruleset_draft_state', { kind: 'id', id: DEFINITION_ID }, draftLifeState(3, false));
      const result = refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID }));
      expect(result.findings).toEqual(expect.arrayContaining([{ section: 'ruleset_create_draft', code: 'edited_outside' }]));
    });

    it('needs a draft this conversation created', async () => {
      const h = makeHarness();
      const live = new LiveReads();
      const { create } = draftWrites(h, live);
      scriptLiveReads(h, live);
      create.status = 'undone';
      expect(refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID })).code).toBe('nothing_to_undo');
      create.status = 'ok';
      create.tool_name = 'ruleset_patch_draft';
      expect(refused(await h.stage('propose_undo', { ruleset_id: DEFINITION_ID })).code).toBe('nothing_to_undo');
    });
  });
});

describe('the DOC hash helper', () => {
  it('is a 64-hex value, so the ledger column accepts it', () => {
    expect(DOC_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(V2).toMatch(/^[0-9a-f-]{36}$/);
  });
});
