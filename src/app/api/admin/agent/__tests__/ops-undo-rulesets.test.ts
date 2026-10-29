/**
 * The undo of the ruleset writes through the REAL routes (spec §18.8): a pin move moved back (`POST .../pins`, one call per
 * previous version, a target moved meanwhile is the route's 409 `ruleset_pin_moved`), a draft save restored from its snapshot
 * (`PUT .../draft`, a human save in between is the route's 409 `ruleset_stale_revision`), and a draft the chat created and nobody
 * published deleted (`DELETE /api/ruleset-definitions/[id]`; once published it is not offered; the route's `ruleset_in_use`
 * is a failed step). The forward writes are ledger rows (`undo-helpers.ts`); staging is the real stager over the real live reads,
 * the data layer is an in-memory world.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEF = '00000000-0000-4000-8000-000000000700';
const V1 = '00000000-0000-4000-8000-000000009101';
const V2 = '00000000-0000-4000-8000-000000009102';
const V3 = '00000000-0000-4000-8000-000000009103';

const db = vi.hoisted(() => ({
  audit: [] as Array<Record<string, unknown>>,
  /** `kind:id` -> the version id the target pins. */
  pins: {} as Record<string, string>,
  versions: [] as Array<{ id: string; version_no: number; definition_id: string }>,
  draft: { rev: 2, document: { schema: 1, rev: 1 } as Record<string, unknown>, published: false },
  exists: true,
  pinned: false,
  /** The pin move stops at target `at` with the route's 409. */
  pinMovedAt: null as number | null,
  saves: [] as Array<{ rev: number; document: unknown }>,
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        db.audit.push(row);
        return { error: null };
      },
    }),
  },
}));
vi.mock('@/lib/auth/helpers', () => {
  const live = { playerId: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
  return {
    requireAnyAdmin: vi.fn(async () => live),
    requireResourceAdmin: vi.fn(async () => live),
    AuthError: class AuthError extends Error {},
  };
});
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 })),
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({
  requireRulesetViewer: vi.fn(async (id: string) => ({
    player: { playerId: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', isAdmin: true },
    definition: { id, slug: 'spring-ou' },
    actor: { playerId: '00000000-0000-4000-8000-000000000001', isAdmin: true },
  })),
}));
vi.mock('@/lib/ruleset-studio/library', async () => {
  const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
  return {
    assertCanEditDraft: vi.fn(),
    saveDraft: vi.fn(async (_meta: unknown, input: { draftRev: number; document: Record<string, unknown> }) => {
      // The compare-and-set: a stale revision is the route's own 409 carrying the current one.
      if (input.draftRev !== db.draft.rev) throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: db.draft.rev });
      db.draft.rev += 1;
      db.draft.document = input.document;
      db.saves.push({ rev: db.draft.rev, document: input.document });
      return { draft_rev: db.draft.rev, updated_at: '2026-10-27T12:00:04.000Z', name: { base: 'en' }, check: { diagnostics: [] } };
    }),
    removeDefinition: vi.fn(async () => {
      if (db.pinned) throw new RulesetStudioError('ruleset_in_use', { count: 1 });
      db.exists = false;
    }),
  };
});
vi.mock('@/lib/ruleset-studio/pins', async () => {
  const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
  return {
    movePins: vi.fn(
      async (input: { definition: { id: string }; toVersionNo: number; targets: Array<{ kind: string; id: string }>; confirmStarted: string[]; onMoved?: (moved: Record<string, unknown>, to: { version_id: string; version_no: number }) => void }) => {
        const version = db.versions.find((candidate) => candidate.definition_id === input.definition.id && candidate.version_no === input.toVersionNo);
        if (version === undefined) throw new RulesetStudioError('ruleset_not_found');
        const to = { version_id: version.id, version_no: version.version_no };
        const moved: Array<Record<string, unknown>> = [];
        for (const [index, target] of input.targets.entries()) {
          if (db.pinMovedAt === index) throw new RulesetStudioError('ruleset_pin_moved', { target: 'the league' });
          const key = `${target.kind}:${target.id}`;
          const entry = { kind: target.kind, id: target.id, name: key, season_id: null, from_version_id: db.pins[key] ?? null, started: input.confirmStarted.includes(target.id), difference: null };
          db.pins[key] = to.version_id;
          moved.push(entry);
          input.onMoved?.(entry, to);
        }
        return { ...to, moved };
      },
    ),
  };
});
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  listRulesetVersions: vi.fn(async (definitionId: string) => db.versions.filter((version) => version.definition_id === definitionId).sort((a, b) => b.version_no - a.version_no)),
  getPinTargetStates: vi.fn(async (seasonIds: string[], tournamentIds: string[]) => [
    ...seasonIds.map((id) => ({ kind: 'season', id, name: `season ${id}`, status: 'active', season_id: null, ruleset_id: db.pins[`season:${id}`] ?? null })),
    ...tournamentIds.map((id) => ({ kind: 'tournament', id, name: `tournament ${id}`, status: 'active', season_id: null, ruleset_id: db.pins[`tournament:${id}`] ?? null })),
  ]),
  getRulesetDefinitionDraft: vi.fn(async () => (db.exists ? { document: db.draft.document, draft_rev: db.draft.rev } : null)),
  getRulesetDefinitionMeta: vi.fn(async (id: string) => (db.exists ? { id, slug: 'spring-ou', current_version_id: db.draft.published ? V1 : null } : null)),
}));

import { executeProposal, type ExecuteInput, type ProposalResult } from '@/lib/ai/admin-agent/proposals/executor';
import { liveFingerprints } from '@/lib/ai/admin-agent/proposals/live';
import { deriveApprovalToken } from '@/lib/ai/admin-agent/proposals/token';
import type { StageStaged } from '@/lib/ai/admin-agent/proposals/types';
import { makeWorld, recordedSession, type World } from '@/lib/ai/admin-agent/proposals/__tests__/executor-helpers';
import { ADMIN, CONVERSATION_ID, SEASON_ID, TOKEN_SECRET, TOURNAMENT_ID } from '@/lib/ai/admin-agent/proposals/__tests__/helpers';
import { LiveReads, draftWrites, executedPinMove, V1 as HV1 } from '@/lib/ai/admin-agent/proposals/__tests__/undo-helpers';
import { hashJson } from '@/lib/ai/admin-agent/plans/hash';
import { draftDocState } from '@/lib/ai/admin-agent/proposals/after-state';
import { getBindingRegistry } from '../_ops/g';

let world: World;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(db, {
    audit: [],
    pins: { [`season:${SEASON_ID}`]: V3, [`tournament:${TOURNAMENT_ID}`]: V3 },
    versions: [
      { id: V1, version_no: 1, definition_id: DEF },
      { id: V2, version_no: 2, definition_id: DEF },
      { id: V3, version_no: 3, definition_id: DEF },
    ],
    draft: { rev: 2, document: { schema: 1, rev: 2 }, published: false },
    exists: true,
    pinned: false,
    pinMovedAt: null,
    saves: [],
  });
  world = await makeWorld();
  // One ledger for the stager and the executor; the real live reads over the mocked data layer.
  world.harness.store.actions = world.store.actions;
  (world.harness.deps.source as { fingerprints: unknown }).fingerprints = liveFingerprints;
});

async function stageUndo(args: Record<string, unknown>) {
  const h = world.harness;
  h.turn.goLive = 0;
  h.turn.stagings = 0;
  return h.stage('propose_undo', args);
}

async function approve(proposalId: string): Promise<ProposalResult> {
  const row = world.store.row(proposalId);
  const input: ExecuteInput = {
    mode: 'approve',
    adminId: ADMIN,
    adminName: 'Test Admin',
    isSiteAdmin: true,
    session: await recordedSession(),
    inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) },
    proposalId,
    approval: { token: deriveApprovalToken(TOKEN_SECRET, proposalId, ADMIN), proposalHash: row.proposal_hash, previewHash: row.preview_hash, acks: ['compensating_changes'] },
  };
  return executeProposal({ ...world.deps, bindings: getBindingRegistry(), fingerprints: liveFingerprints }, input);
}

/** The ledger row of the draft save, with the fingerprint of the draft as it is now (revision 2, document as saved). */
function seedDraft(options: { patches?: number } = {}) {
  const live = new LiveReads();
  const written = draftWrites(world.harness, live, options);
  const last = written.patches.at(-1)!;
  // The real read of the stored draft must hash to what the ledger stored: the chat left revision `rev` with this document.
  db.draft = { rev: (options.patches ?? 1) + 1, document: { schema: 1, rev: db.draft.rev }, published: false };
  const docHash = hashJson(db.draft.document);
  for (const patch of written.patches) {
    patch.after = { ruleset_id: DEF, draft_rev: (patch.after as { draft_rev: number }).draft_rev, doc_hash: docHash } as never;
    patch.after_fingerprint = hashJson(draftDocState((patch.after as { draft_rev: number }).draft_rev, docHash));
  }
  world.harness.store.see(CONVERSATION_ID, DEF);
  return { ...written, last };
}

describe('moving a pin back through POST /api/ruleset-definitions/[id]/pins', () => {
  const seed = () => {
    const { proposalId } = executedPinMove(world.harness, new LiveReads());
    world.harness.store.see(CONVERSATION_ID, DEF, SEASON_ID, TOURNAMENT_ID);
    return proposalId;
  };

  it('moves each target back to the version it pinned and records the ledger rows undone', async () => {
    const staged = (await stageUndo({ proposal_id: seed() })) as StageStaged;
    expect(staged).toMatchObject({ status: 'staged', kind: 'undo' });
    const result = await approve(staged.proposal_id);

    expect(result.status).toBe('completed');
    expect(db.pins).toEqual({ [`season:${SEASON_ID}`]: V1, [`tournament:${TOURNAMENT_ID}`]: V2 });
    expect(world.store.actions.find((row) => row.tool_name === 'move_pin' && row.proposal_id !== staged.proposal_id)?.status).toBe('undone');
    expect(db.audit.filter((entry) => entry.action === 'ruleset.pin')).toHaveLength(2);
    // The pin targets are claimed besides the Go-live execution.
    expect(world.store.budgetClaims.at(-1)?.map((claim) => [claim.counter, claim.amount])).toEqual([['pin_targets', 2], ['golive_executions', 1]]);
  });

  it('lands the route\'s ruleset_pin_moved as a failed step and leaves the later group, and the ledger row, alone', async () => {
    const staged = (await stageUndo({ proposal_id: seed() })) as StageStaged;
    db.pinMovedAt = 0;
    const result = await approve(staged.proposal_id);

    expect(result.status).toBe('failed');
    expect(result.steps.map((step) => [step.status, step.code])).toEqual([['failed', 'ruleset_pin_moved'], ['skipped', undefined]]);
    expect(db.pins[`season:${SEASON_ID}`]).toBe(V3);
    expect(world.store.actions.find((row) => row.tool_name === 'move_pin' && row.proposal_id !== staged.proposal_id)?.status).toBe('ok');
  });

  it('leaves the move alone when a target was moved before staging', async () => {
    const proposalId = seed();
    db.pins[`season:${SEASON_ID}`] = V2;
    expect(await stageUndo({ proposal_id: proposalId })).toMatchObject({ status: 'refused', code: 'nothing_to_undo', findings: [{ section: 'move_pin', code: 'edited_outside' }] });
  });
});

describe('restoring a draft save through PUT /api/ruleset-definitions/[id]/draft', () => {
  it('writes the snapshot back at the revision the save left, and marks the row undone', async () => {
    const { last } = seedDraft();
    const staged = (await stageUndo({ ruleset_id: DEF, draft_rev: 2 })) as StageStaged;
    expect(staged).toMatchObject({ status: 'staged', kind: 'undo' });

    const result = await approve(staged.proposal_id);
    expect(result.status).toBe('completed');
    expect(db.saves).toEqual([{ rev: 3, document: { schema: 1, rev: 1 } }]);
    expect(world.store.actions.find((row) => row.id === last.id)?.status).toBe('undone');
    expect(world.store.action(`undo.${last.id}`)).toMatchObject({ tool_name: 'ruleset_restore_draft', class: 'D', entity_type: 'ruleset', entity_id: DEF, status: 'ok', verify: { status: 'confirmed' } });
  });

  it('lands the route\'s ruleset_stale_revision as failed when a human saved between the staging and the click (the precondition is the same revision)', async () => {
    seedDraft();
    const staged = (await stageUndo({ ruleset_id: DEF, draft_rev: 2 })) as StageStaged;
    // A human save that the fingerprint cannot see (same document hash is impossible, so simulate the race inside the route): the
    // revision moves after the precondition read.
    const { saveDraft } = await import('@/lib/ruleset-studio/library');
    vi.mocked(saveDraft).mockImplementationOnce(async () => {
      db.draft.rev = 3;
      const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
      throw new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: 3 });
    });
    const result = await approve(staged.proposal_id);
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({ status: 'failed', code: 'ruleset_stale_revision' });
    expect(db.saves).toEqual([]);
  });

  it('leaves it alone when a human saved before the undo was staged', async () => {
    seedDraft();
    db.draft.rev = 3;
    expect(await stageUndo({ ruleset_id: DEF, draft_rev: 2 })).toMatchObject({ status: 'refused', code: 'nothing_to_undo', findings: [{ section: 'ruleset_patch_draft', code: 'edited_outside' }] });
  });
});

describe('deleting a draft the chat created through DELETE /api/ruleset-definitions/[id] (the second carve-out)', () => {
  it('deletes a never-published draft, replacing the restores of its saves, and marks the creation undone', async () => {
    const { create } = seedDraft({ patches: 2 });
    // The created-at-revision-1 draft was saved twice by the chat: the delete's precondition is the last write.
    const staged = (await stageUndo({ ruleset_id: DEF })) as StageStaged;
    expect(staged).toMatchObject({ status: 'staged', kind: 'undo' });
    expect(world.store.row(staged.proposal_id).steps).toHaveLength(1);

    const result = await approve(staged.proposal_id);
    expect(result.status).toBe('completed');
    expect(db.exists).toBe(false);
    expect(db.saves).toEqual([]);
    expect(db.audit.find((entry) => entry.action === 'ruleset.delete')).toMatchObject({ resource_id: DEF });
    expect(world.store.actions.find((row) => row.id === create.id)?.status).toBe('undone');
    expect(world.store.action(`undo.${create.id}`)).toMatchObject({ tool_name: 'ruleset_delete_draft', class: 'G', entity_id: DEF, status: 'ok', verify: { status: 'confirmed' } });
  });

  it('is residue once a version exists: nothing is staged and nothing is deleted', async () => {
    seedDraft();
    db.draft.published = true;
    world.harness.deps.source.rulesetDraft = async () => ({ draftRev: 2, errorDiagnostics: 0, diagnosticsHash: '', currentVersionId: V1, visibility: 'private', slug: 'spring-ou' });
    const result = await stageUndo({ ruleset_id: DEF });
    expect(result).toMatchObject({ status: 'refused', code: 'nothing_to_undo' });
    expect((result as unknown as { findings: unknown[] }).findings).toEqual(expect.arrayContaining([{ section: 'ruleset_create_draft', code: 'ruleset_published' }]));
    expect(db.exists).toBe(true);
  });

  it('is left alone when a human saved the draft after the last chat write', async () => {
    seedDraft();
    db.draft.rev = 5;
    const result = await stageUndo({ ruleset_id: DEF });
    expect((result as unknown as { findings: unknown[] }).findings).toEqual(expect.arrayContaining([{ section: 'ruleset_create_draft', code: 'edited_outside' }]));
    expect(db.exists).toBe(true);
  });

  it('stops at the precondition when the draft was published after staging, and the route\'s ruleset_in_use is a failed step', async () => {
    seedDraft();
    const staged = (await stageUndo({ ruleset_id: DEF })) as StageStaged;
    db.draft.published = true;
    expect((await approve(staged.proposal_id)).status).toBe('stale');
    expect(db.exists).toBe(true);

    db.draft.published = false;
    const again = (await (async () => {
      world.harness.turn.goLive = 0;
      world.harness.turn.stagings = 0;
      return world.harness.stage('propose_undo', { ruleset_id: DEF });
    })()) as StageStaged;
    expect(again.status).toBe('staged');
    db.pinned = true;
    const result = await approve(again.proposal_id);
    expect(result.status).toBe('failed');
    expect(result.steps[0]).toMatchObject({ status: 'failed', code: 'ruleset_in_use' });
    expect(db.exists).toBe(true);
  });

  it('keeps the helper ids in line', () => {
    expect(HV1).toBeTruthy();
  });
});
