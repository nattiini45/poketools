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

function uid2(): string {
  return 'ffffffff-ffff-4fff-8fff-ffffffffffff';
}
