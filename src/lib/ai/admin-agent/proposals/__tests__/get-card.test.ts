import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ADMIN, OTHER_ADMIN, ledgerAction, makeHarness, seeWorkedExample } from './helpers';
import type { StageStaged } from '../types';

async function stagedBuild() {
  const h = makeHarness();
  seeWorkedExample(h);
  const result = (await h.stage('propose_build', { plan_revision: 1 })) as StageStaged;
  expect(result.status).toBe('staged');
  return { h, id: result.proposal_id };
}

describe('getCard: the frozen preview plus live status', () => {
  it('returns the stored card, hashes, plan code and the exact technical details', async () => {
    const { h, id } = await stagedBuild();
    const view = await h.stager.getCard(id, ADMIN);
    const row = h.store.proposals[0];

    expect(view).toMatchObject({
      id,
      kind: 'build',
      class: 'B',
      status: 'proposed',
      effectiveStatus: 'proposed',
      actionable: true,
      locale: 'en',
      proposalHash: row.proposal_hash,
      previewHash: row.preview_hash,
      planId: row.plan_id,
      planRevision: 1,
      toolRegistryVersion: 'abcdef0123456789',
      acksRequired: ['visible_publicly'],
    });
    expect(view.planCode).toBe(row.proposal_hash.slice(0, 8));
    expect(view.card.planCode).toBe(view.planCode);
    expect(view.secondsLeft).toBe(60 * 60);
    expect(view.steps.map((s) => [s.key, s.status])).toEqual([
      ['league', 'pending'],
      ['roster.1', 'pending'],
      ['phase.regular_season', 'pending'],
      ['phase.playoffs', 'pending'],
    ]);
    // Method, template and filled-in path; a symbolic reference shows as itself.
    expect(view.details[0]).toMatchObject({ method: 'POST', routeTemplate: '/api/seasons', path: '/api/seasons' });
    expect(view.details[1]).toMatchObject({ routeTemplate: '/api/seasons/[id]/participants', path: '/api/seasons/{league.id}/participants' });
    expect(view.details[1].body).toMatchObject({ player_ids: expect.any(Array) });
  });

  it('shows the live ledger state of each step next to the frozen preview', async () => {
    const { h, id } = await stagedBuild();
    h.store.actions.push(
      ledgerAction({ id: 'a1', proposal_id: id, step_key: 'league', status: 'ok', http_status: 201 }),
      ledgerAction({ id: 'a2', proposal_id: id, step_key: 'roster.1', status: 'failed', error_code: 'participant_already_enrolled', http_status: 409 }),
      ledgerAction({ id: 'a3', proposal_id: uid2(), step_key: 'phase.playoffs', status: 'ok' }),
    );
    const view = await h.stager.getCard(id, ADMIN);
    expect(view.steps.map((s) => [s.key, s.status, s.errorCode, s.httpStatus])).toEqual([
      ['league', 'ok', null, 201],
      ['roster.1', 'failed', 'participant_already_enrolled', 409],
      ['phase.regular_season', 'pending', null, null],
      ['phase.playoffs', 'pending', null, null],
    ]);
  });

  it('is expired for display as soon as the TTL passes, before any sweep writes the status', async () => {
    const { h, id } = await stagedBuild();
    h.advance(60 * 60_000 - 1000);
    expect(await h.stager.getCard(id, ADMIN)).toMatchObject({ effectiveStatus: 'proposed', actionable: true, secondsLeft: 1 });
    h.advance(1000);
    const view = await h.stager.getCard(id, ADMIN);
    expect(view).toMatchObject({ status: 'proposed', effectiveStatus: 'expired', actionable: false, secondsLeft: 0 });
    expect(await h.stager.getApprovalToken(id, ADMIN)).toBeNull();
  });

  it('is not actionable once handled, and offers no countdown', async () => {
    const { h, id } = await stagedBuild();
    h.store.proposals[0].status = 'completed';
    expect(await h.stager.getCard(id, ADMIN)).toMatchObject({ status: 'completed', effectiveStatus: 'completed', actionable: false, secondsLeft: null });
    expect(await h.stager.getApprovalToken(id, ADMIN)).toBeNull();
  });

  it("another admin's proposal does not exist (404), for the card and for the token", async () => {
    const { h, id } = await stagedBuild();
    await expect(h.stager.getCard(id, OTHER_ADMIN)).rejects.toMatchObject({ code: 'proposal_not_found' });
    await expect(h.stager.getApprovalToken(id, OTHER_ADMIN)).rejects.toMatchObject({ code: 'proposal_not_found' });
  });

  it('refuses to render a stored card that no longer matches its schema (stored JSON is data)', async () => {
    const { h, id } = await stagedBuild();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (h.store.proposals[0].preview as Record<string, unknown>).smuggled = '<script>';
    await expect(h.stager.getCard(id, ADMIN)).rejects.toMatchObject({ code: 'agent_harness_error' });
    error.mockRestore();
  });

  it('hands the owning admin the same token whose hash was stored, and nobody else', async () => {
    const { h, id } = await stagedBuild();
    const token = (await h.stager.getApprovalToken(id, ADMIN)) as string;
    const { approvalTokenHash } = await import('../token');
    expect(approvalTokenHash(token)).toBe(h.store.proposals[0].token_hash);
    expect(await h.stager.getApprovalToken(id, ADMIN)).toBe(token);
  });
});

describe('getCard: the progress card additions', () => {
  const LEAGUE = '55555555-5555-4555-8555-555555555555';

  it('serves the ledger entity (ids only) and the roster read-back counts, never args or results', async () => {
    const { h, id } = await stagedBuild();
    h.store.actions.push(
      ledgerAction({ id: 'a1', proposal_id: id, step_key: 'league', status: 'ok', entity_type: 'season', entity_id: LEAGUE, args: { body_template: { name: 'SECRET' } } as never, result: { id: LEAGUE } as never }),
      ledgerAction({ id: 'a2', proposal_id: id, step_key: 'roster.1', status: 'unknown', error_code: 'unknown_outcome', verify: { status: 'unknown', present: 5, expected: 12, junk: 'x' } as never }),
      ledgerAction({ id: 'a3', proposal_id: id, step_key: 'phase.playoffs', status: 'ok', verify: { status: 'confirmed', present: -1, expected: 'many' } as never }),
    );
    const view = await h.stager.getCard(id, ADMIN);
    expect(view.steps[0]).toEqual({ key: 'league', status: 'ok', errorCode: null, httpStatus: null, actionId: 'a1', entityType: 'season', entityId: LEAGUE, verify: null });
    expect(view.steps[1]).toMatchObject({ key: 'roster.1', status: 'unknown', errorCode: 'unknown_outcome', verify: { present: 5, expected: 12 } });
    expect(Object.keys(view.steps[1].verify ?? {}).sort()).toEqual(['expected', 'present']);
    expect(view.steps[3].verify).toBeNull();
    expect(JSON.stringify(view)).not.toContain('SECRET');
  });

  describe('resume: the server decides, from its own clock', () => {
    const WINDOW = 10 * 60_000;
    async function executing(startedAgoMs: number, overrides: Record<string, unknown> = {}) {
      const { h, id } = await stagedBuild();
      Object.assign(h.store.proposals[0], { status: 'executing', approved_by: ADMIN, executing_started_at: new Date(h.deps.now().getTime() - startedAgoMs).toISOString(), ...overrides });
      return { h, id };
    }

    it('is null for everything that is not an executing Build', async () => {
      const { h, id } = await stagedBuild();
      expect((await h.stager.getCard(id, ADMIN)).resume).toBeNull();
      h.store.proposals[0].status = 'completed';
      expect((await h.stager.getCard(id, ADMIN)).resume).toBeNull();
    });

    it('is eligible inside the window with its deadline, and not one millisecond after', async () => {
      const { h, id } = await executing(2 * 60_000);
      const inside = (await h.stager.getCard(id, ADMIN)).resume;
      expect(inside?.eligible).toBe(true);
      expect(Date.parse(inside?.deadline ?? '') - h.deps.now().getTime()).toBe(WINDOW - 2 * 60_000);
      h.advance(WINDOW - 2 * 60_000);
      expect((await h.stager.getCard(id, ADMIN)).resume?.eligible).toBe(true);
      h.advance(1);
      expect((await h.stager.getCard(id, ADMIN)).resume).toMatchObject({ eligible: false });
    });

    it('is not eligible after the window, but is still reported so the card can say so', async () => {
      const { h, id } = await executing(WINDOW + 1);
      expect((await h.stager.getCard(id, ADMIN)).resume).toMatchObject({ eligible: false });
    });

    it('is null when somebody else approved it, and never offered for a Go-live proposal', async () => {
      const { h, id } = await executing(1000, { approved_by: OTHER_ADMIN });
      expect((await h.stager.getCard(id, ADMIN)).resume).toBeNull();
      Object.assign(h.store.proposals[0], { approved_by: ADMIN, class: 'G', kind: 'action' });
      expect((await h.stager.getCard(id, ADMIN)).resume).toBeNull();
    });
  });

  describe('undoable: the ledger holds something the table can reverse', () => {
    it('is true for a completed or partial proposal with a finished league row', async () => {
      const { h, id } = await stagedBuild();
      h.store.proposals[0].status = 'completed';
      h.store.actions.push(ledgerAction({ id: 'a1', proposal_id: id, step_key: 'league', tool_name: 'league_create', status: 'ok' } as never));
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(true);
      h.store.proposals[0].status = 'partial';
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(true);
    });

    it('is false before it ran, after it was undone, for failed ones, and when only posts or residue ran', async () => {
      const { h, id } = await stagedBuild();
      h.store.actions.push(ledgerAction({ id: 'a1', proposal_id: id, step_key: 'league', tool_name: 'league_create', status: 'ok' } as never));
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(false);
      h.store.proposals[0].status = 'failed';
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(false);
      h.store.proposals[0].status = 'completed';
      h.store.actions[0].status = 'undone';
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(false);
      h.store.actions.push(
        ledgerAction({ id: 'a2', proposal_id: id, step_key: 'start', tool_name: 'start_phase', status: 'ok' } as never),
        ledgerAction({ id: 'a3', proposal_id: id, step_key: 'phase.playoffs', tool_name: 'phase_create', status: 'ok' } as never),
      );
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(false);
    });

    it('counts the two Go-live ops filed under their step name (a pin move)', async () => {
      const { h, id } = await stagedBuild();
      h.store.proposals[0].status = 'completed';
      h.store.actions.push(ledgerAction({ id: 'a1', proposal_id: id, step_key: 'move', tool_name: 'move_pin', status: 'ok' } as never));
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(true);
    });

    it('is never true for an undo proposal', async () => {
      const { h, id } = await stagedBuild();
      Object.assign(h.store.proposals[0], { kind: 'undo', status: 'completed' });
      h.store.actions.push(ledgerAction({ id: 'a1', proposal_id: id, step_key: 'u', tool_name: 'league_archive', status: 'ok' } as never));
      expect((await h.stager.getCard(id, ADMIN)).undoable).toBe(false);
    });
  });
});

function uid2(): string {
  return 'ffffffff-ffff-4fff-8fff-ffffffffffff';
}
