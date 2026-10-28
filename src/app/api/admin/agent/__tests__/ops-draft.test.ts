/**
 * The D bindings (`_ops/d`) and the draft runner against the REAL ruleset-definitions route modules: the two private draft
 * tools (`ruleset_create_draft` in its three modes, `ruleset_patch_draft`) run through `createStagedRunner`, the real
 * `checkCall` and `invokeRoute`, into the routes' own body readers, zod envelopes, limiter responses and error mapping. Only
 * the guards, the limiter and the data layer are mocked, as the repo's route tests do; the ledger and the snapshots are an
 * in-memory fake that records the ORDER of everything (the ledger row and the snapshot exist before the route runs).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashJson } from '@/lib/ai/admin-agent/plans/hash';
import { draftDocState, draftLifeState } from '@/lib/ai/admin-agent/proposals/after-state';
import type { Session } from 'next-auth';
import { z } from 'zod';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/library', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ruleset-studio/library')>()),
  createFromBody: vi.fn(),
  forkDefinition: vi.fn(),
  forkPreset: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ getRulesetDefinitionDraft: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { auth } from '@/auth';
import { getAgentAuditContext } from '@/lib/audit/agent-context';
import { logAuditEvent } from '@/lib/audit/log';
import { authAndRecord } from '@/lib/auth/session-override';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { createBindingRegistry } from '@/lib/ai/admin-agent/dispatch';
import { STAGED_TOOLS } from '@/lib/ai/admin-agent/registry/staged';
import { createStagedRunner, type StagedRunnerDeps } from '@/lib/ai/admin-agent/staged';
import type { StagedToolContext } from '@/lib/ai/admin-agent/loop/tool-runtime';
import { adminIdOf } from '@/lib/ai/admin-agent/store/ids';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { createFromBody, forkDefinition, forkPreset, saveDraft } from '@/lib/ruleset-studio/library';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import type { RulesetDefinitionMeta } from '@/lib/ruleset-studio/library-types';
import { ltext } from '@/lib/studio-core/ltext';
import { getRulesetDefinitionDraft } from '@/lib/supabase/queries/ruleset-definitions';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { DRAFT_BINDINGS, getDraftBindingRegistry } from '../_ops/d';
import { rulesetPatchDraft } from '../_ops/d/ruleset-patch';

const ME = '11111111-1111-4111-8111-111111111111';
const DEF = '33333333-3333-4333-8333-333333333333';
const NEW_DEF = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const SNAPSHOT = '66666666-6666-4666-8666-666666666666';
const MARKER = 'DOCUMENT-MARKER-NEVER-IN-AUDIT';

const tool = (name: string) => STAGED_TOOLS.find((entry) => entry.name === name)!;
const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ME, name: 'Site Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active', ...overrides,
});
const definition = (overrides: Partial<RulesetDefinitionMeta> = {}): RulesetDefinitionMeta => ({
  id: DEF, slug: 'spring-ou', name: ltext('en', 'Spring OU'), description: null, kind: 'custom', owner_id: ME, visibility: 'private', season_id: null,
  forked_from: null, draft_rev: 3, current_version_id: null, created_at: '', updated_at: '', ...overrides,
});
const access = (overrides: Partial<RulesetDefinitionMeta> = {}, p: SessionPlayer = player()) => ({
  player: p,
  definition: definition(overrides),
  actor: { playerId: p.playerId, isAdmin: p.isAdmin },
});

const PREVIOUS = { name: 'Spring', note: MARKER, rules: { bans: ['a'] } };
const ADD_BAN = JSON.stringify([{ op: 'add', path: '/rules/bans/-', value: 'b' }]);
const created = (id = NEW_DEF) => ({ definition: { id, slug: 'spring-ou', draft_rev: 1 } as never, check: { ok: true } as never });

// ─── The ledger, snapshots and audit as an ordered log ───────────────────────

interface World {
  log: string[];
  rows: Map<string, Record<string, unknown>>;
  completions: Array<Record<string, unknown>>;
  snapshots: Array<{ actionId: string; document: unknown; docHash: string }>;
  audits: Array<{ entry: Record<string, unknown>; context: unknown }>;
  routeAudits: Array<{ entry: Record<string, unknown>; context: unknown }>;
  failInsert: boolean;
}

let world: World;
let maxPhase: 0 | 1 | 2 | 3 | 4 | 5;

function deps(registry = getDraftBindingRegistry()): StagedRunnerDeps {
  const seen = new Set<string>();
  return {
    store: {} as never,
    stage: vi.fn(),
    loadPlanFacts: vi.fn(),
    drafts: {
      bindings: registry,
      store: {
        actions: {
          insertAction: vi.fn(async (_admin: unknown, input: { conversationId: string; toolUseId?: string | null; toolName: string; args: unknown; argsHash: string; method?: string | null; path?: string | null }) => {
            world.log.push('action.insert');
            if (world.failInsert) throw new Error('ledger down');
            const key = `${input.conversationId}:${input.toolUseId}`;
            if (seen.has(key)) return { inserted: false };
            seen.add(key);
            const id = `77777777-7777-4777-8777-${String(world.rows.size + 1).padStart(12, '0')}`;
            const row = { id, status: 'executing', ...input };
            world.rows.set(id, row);
            return { inserted: true, action: row };
          }),
          completeAction: vi.fn(async (_admin: unknown, id: string, outcome: Record<string, unknown>) => {
            world.log.push('action.complete');
            world.completions.push(outcome);
            Object.assign(world.rows.get(id) ?? {}, outcome);
            return world.rows.get(id);
          }),
        },
        snapshots: {
          insertSnapshot: vi.fn(async (_admin: unknown, input: { actionId: string; document: unknown; docHash: string }) => {
            world.log.push('snapshot.insert');
            world.snapshots.push(input);
            return { id: SNAPSHOT, action_id: input.actionId, document: input.document, doc_hash: input.docHash };
          }),
        },
      },
      maxPhase: () => maxPhase,
      audit: (entry: Record<string, unknown>) => {
        world.log.push('audit');
        world.audits.push({ entry, context: getAgentAuditContext() });
      },
    } as never,
  };
}

async function context(options: { withSession?: boolean; expires?: string; toolUseId?: string } = {}): Promise<StagedToolContext> {
  const base = {
    adminId: adminIdOf(ME),
    adminName: 'Site Admin',
    conversationId: CONVERSATION,
    toolUseId: options.toolUseId ?? 'toolu_1',
    step: 1,
    now: () => new Date('2026-10-28T12:00:00.000Z'),
    timeZone: 'Europe/Berlin',
    locale: 'en' as const,
    model: 'claude-opus-5-5',
    effort: 'medium',
    systemPromptVersion: 'sp-v1',
    toolRegistryVersion: 'rv-v1',
    userTextHash: 'abcdef0123456789',
    ops: {} as never,
    toolSet: { role: 'site' } as never,
  };
  if (options.withSession === false) return base as StagedToolContext;
  const session: Session = {
    user: { id: ME, name: 'Admin', email: 'admin@example.com', image: null },
    player: null,
    expires: options.expires ?? '2099-01-01T00:00:00.000Z',
  };
  vi.mocked(auth).mockResolvedValueOnce(session as never);
  const recorded = await authAndRecord();
  if (recorded === null) throw new Error('expected a session');
  return { ...base, dispatch: { session: recorded, inbound: new Request('https://example.com/api/admin/agent/x', { headers: { 'x-forwarded-for': '203.0.113.7' } }) } } as StagedToolContext;
}

const patchArgs = (overrides: Record<string, unknown> = {}) => ({ ruleset_id: DEF, draft_rev: 3, ops_json: ADD_BAN, ...overrides });
const dispatched = () => world.log.includes('route.saveDraft') || vi.mocked(createFromBody).mock.calls.length + vi.mocked(forkPreset).mock.calls.length + vi.mocked(forkDefinition).mock.calls.length > 0;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  maxPhase = 1;
  world = { log: [], rows: new Map(), completions: [], snapshots: [], audits: [], routeAudits: [], failInsert: false };
  vi.mocked(requireAnyAdmin).mockResolvedValue(player());
  vi.mocked(requireRulesetViewer).mockResolvedValue(access());
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 } as never);
  vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: structuredClone(PREVIOUS), draft_rev: 3 });
  vi.mocked(saveDraft).mockImplementation((async () => {
    world.log.push('route.saveDraft');
    return { draft_rev: 4, updated_at: '2026-10-28T12:00:01.000Z', name: ltext('en', 'Spring'), check: { ok: true, diagnostics: [] } };
  }) as never);
  vi.mocked(createFromBody).mockResolvedValue(created());
  vi.mocked(forkPreset).mockResolvedValue(created());
  vi.mocked(forkDefinition).mockResolvedValue(created());
  vi.mocked(logAuditEvent).mockImplementation(((entry: Record<string, unknown>) => {
    world.routeAudits.push({ entry, context: getAgentAuditContext() });
  }) as never);
});

// ─── The registry ────────────────────────────────────────────────────────────

describe('the D binding registry', () => {
  it('holds the four class D bindings of the two tools, in phase 1, on exactly the routes the tools declare', () => {
    const registry = getDraftBindingRegistry();
    expect(registry.all().map((binding) => `${binding.class} ${binding.method} ${binding.path}`).sort()).toEqual(
      [
        'D POST /api/ruleset-definitions',
        'D POST /api/ruleset-definitions/[id]/fork',
        'D POST /api/ruleset-definitions/presets/[presetId]/fork',
        'D PUT /api/ruleset-definitions/[id]/draft',
      ].sort(),
    );
    for (const binding of DRAFT_BINDINGS) expect(binding.phase).toBe(1);
    const declared = [...(tool('ruleset_create_draft').routes ?? []), ...(tool('ruleset_patch_draft').routes ?? [])].map((route) => `${route.method} ${route.path}`).sort();
    expect(declared).toEqual(registry.all().map((binding) => `${binding.method} ${binding.path}`).sort());
  });
});

// ─── ruleset_create_draft ────────────────────────────────────────────────────

describe('ruleset_create_draft', () => {
  it('mode new: creates through POST /api/ruleset-definitions with the name body, answers ids and the revision only', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en', base_preset: 'gen9ou' }, await context());

    expect(createFromBody).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), { name: 'Spring OU', base_locale: 'en', preset: 'gen9ou' });
    expect(result).toEqual({
      ok: true,
      data: { ruleset_id: NEW_DEF, draft_rev: 1, slug: 'spring-ou' },
      // The conversation has seen this definition: a later propose_publish_ruleset passes provenance.
      refs: [{ kind: 'ruleset', id: NEW_DEF, label: 'spring-ou', source: 'tool_result' }],
    });
    expect(world.log).toEqual(['action.insert', 'action.complete', 'audit']);
  });

  it('mode fork_preset: POST /api/ruleset-definitions/presets/[presetId]/fork with the catalog id in the path', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_preset', preset_id: 'gen9ou', slug: 'my-ou' }, await context());

    expect(forkPreset).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), 'gen9ou', { slug: 'my-ou', tourOverlay: undefined });
    expect(result).toMatchObject({ ok: true, data: { ruleset_id: NEW_DEF, draft_rev: 1 } });
  });

  it('mode fork_ruleset: POST /api/ruleset-definitions/[id]/fork, the viewer guard of the route runs for the source', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_ruleset', source_id: DEF }, await context());

    expect(requireRulesetViewer).toHaveBeenCalledWith(DEF);
    expect(forkDefinition).toHaveBeenCalledWith(expect.objectContaining({ playerId: ME }), expect.objectContaining({ id: DEF }), true, undefined);
    expect(result).toMatchObject({ ok: true, data: { ruleset_id: NEW_DEF, draft_rev: 1 } });
  });

  it('records the ledger row before the route, completes it with the ids and an undo recipe, and audits agent.draft.write without a proposal or approver', async () => {
    await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context());

    const [row] = [...world.rows.values()];
    expect(row).toMatchObject({ toolName: 'ruleset_create_draft', class: 'D', toolUseId: 'toolu_1', method: 'POST', path: '/api/ruleset-definitions', args: { mode: 'new', name: 'Spring OU', base_locale: 'en' } });
    expect(world.completions[0]).toMatchObject({
      status: 'ok',
      httpStatus: 201,
      outcomeKind: 'ok',
      entityType: 'ruleset',
      entityId: NEW_DEF,
      result: { ruleset_id: NEW_DEF, draft_rev: 1, slug: 'spring-ou' },
      after: { ruleset_id: NEW_DEF, draft_rev: 1 },
      undo: { kind: 'delete_draft', ruleset_id: NEW_DEF },
      // Spec §18.8: deletable by an undo only while it has never been published (read live at undo time).
      reversibility: 'delete_while_unpublished',
      // The state the write left: revision 1, no version. An undo compares the live draft with it.
      afterFingerprint: hashJson(draftLifeState(1, false)),
    });

    expect(world.audits).toHaveLength(1);
    expect(world.audits[0].entry).toMatchObject({
      action: 'agent.draft.write',
      actor_id: ME,
      resource_type: 'ruleset',
      resource_id: NEW_DEF,
      metadata: { tool: 'ruleset_create_draft', operation: 'ruleset_create_new', outcome: 'ok', draft_rev_before: null, draft_rev_after: 1, snapshot_id: null },
    });
    // The route's own audit event carries the agent context: the conversation and the tool, never a proposal or an approver.
    expect(world.routeAudits[0].entry).toMatchObject({ action: 'ruleset.create', resource_id: NEW_DEF });
    expect(world.routeAudits[0].context).toMatchObject({ agent_conversation_id: CONVERSATION, agent_tool: 'ruleset_create_draft', model: 'claude-opus-5-5', user_text_hash: 'abcdef0123456789' });
    expect(world.routeAudits[0].context).not.toHaveProperty('agent_proposal_id');
    expect(world.routeAudits[0].context).not.toHaveProperty('approved_by');
  });

  it('maps the quota refusal to its code with the limit, writes nothing more, and does not audit a draft write', async () => {
    vi.mocked(createFromBody).mockRejectedValue(new RulesetStudioError('ruleset_owner_quota_exceeded', { max: 200 }));
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context());

    expect(result).toEqual({ ok: false, code: 'ruleset_owner_quota_exceeded', params: { max: 200 } });
    expect(world.completions[0]).toMatchObject({ status: 'failed', outcomeKind: 'conflict', errorCode: 'ruleset_owner_quota_exceeded' });
    expect(world.audits).toEqual([]);
  });

  it('maps ruleset_document_invalid (422) to its own code', async () => {
    vi.mocked(forkDefinition).mockRejectedValue(new RulesetStudioError('ruleset_document_invalid', { count: 2 }));
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_ruleset', source_id: DEF }, await context());
    expect(result).toMatchObject({ ok: false, code: 'ruleset_document_invalid', params: { count: 2 } });
  });

  it('maps the shared create limiter to rate_limited with the wait', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 } as never);
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context());
    expect(result).toEqual({ ok: false, code: 'rate_limited', params: { seconds: 42 } });
    expect(createFromBody).not.toHaveBeenCalled();
  });

  it('refuses a tampered body before it dispatches: an unknown base preset never reaches the route', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en', base_preset: 'not-a-preset' }, await context());

    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(createFromBody).not.toHaveBeenCalled();
    expect(world.completions[0]).toMatchObject({ status: 'skipped', outcomeKind: 'not_dispatched', errorCode: 'validation_failed' });
    expect(world.audits).toEqual([]);
  });

  it('checks the preset id against the catalog (not as a uuid) before it dispatches', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_preset', preset_id: 'nope-nope' }, await context());
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(forkPreset).not.toHaveBeenCalled();
  });

  it('answers a masked 500 as an unknown outcome that tells the model to read again, audits it as unknown, and never retries', async () => {
    vi.mocked(createFromBody).mockRejectedValue(new Error('connection reset by peer 10.0.0.5'));
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context());

    expect(result).toEqual({ ok: false, code: 'unknown_outcome', params: { re_read: 'ruleset_get' } });
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
    expect(createFromBody).toHaveBeenCalledTimes(1);
    expect(world.completions[0]).toMatchObject({ status: 'unknown', outcomeKind: 'masked_server_error', errorCode: 'unknown_outcome' });
    expect(world.audits[0].entry).toMatchObject({ action: 'agent.draft.write', metadata: { outcome: 'unknown' } });
  });

  it('does not dispatch the same tool call twice: a taken tool_use_id is an unknown outcome', async () => {
    const runner = createStagedRunner(deps());
    const args = { mode: 'new', name: 'Spring OU', base_locale: 'en' };
    await runner(tool('ruleset_create_draft'), args, await context());
    const again = await runner(tool('ruleset_create_draft'), args, await context());
    expect(again).toEqual({ ok: false, code: 'unknown_outcome', params: { re_read: 'ruleset_get' } });
    expect(createFromBody).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the ledger is down (no ledger, no write)', async () => {
    world.failInsert = true;
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context());
    expect(result).toEqual({ ok: false, code: 'ledger_unavailable' });
    expect(createFromBody).not.toHaveBeenCalled();
  });
});

// ─── ruleset_patch_draft ─────────────────────────────────────────────────────

describe('ruleset_patch_draft', () => {
  it('applies the operations to the current draft, snapshots the previous document BEFORE the PUT, audits, and answers the new revision', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context());

    expect(result).toEqual({
      ok: true,
      data: { ruleset_id: DEF, draft_rev: 4 },
      refs: [{ kind: 'ruleset', id: DEF, label: null, source: 'tool_result' }],
    });
    // The order that makes an undo possible: ledger row, snapshot, route, ledger completion, audit.
    expect(world.log).toEqual(['action.insert', 'snapshot.insert', 'route.saveDraft', 'action.complete', 'audit']);

    // The route received the full patched document with the compare-and-set revision.
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: DEF }), { draftRev: 3, document: { name: 'Spring', note: MARKER, rules: { bans: ['a', 'b'] } } });
    // The snapshot is the PREVIOUS document, tied to the ledger row.
    const [row] = [...world.rows.values()];
    expect(world.snapshots).toHaveLength(1);
    expect(world.snapshots[0]).toMatchObject({ actionId: row.id, document: PREVIOUS });
    expect(world.snapshots[0].docHash).toMatch(/^[0-9a-f]{64}$/);

    // The ledger row holds ids, revisions and hashes; the undo recipe says how to restore.
    expect(row).toMatchObject({ toolName: 'ruleset_patch_draft', class: 'D', method: 'PUT', path: '/api/ruleset-definitions/[id]/draft', args: { ruleset_id: DEF, draft_rev: 3, ops: 1 } });
    expect(world.completions[0]).toMatchObject({
      status: 'ok',
      entityType: 'ruleset',
      entityId: DEF,
      before: { ruleset_id: DEF, draft_rev: 3, doc_hash: world.snapshots[0].docHash },
      after: { ruleset_id: DEF, draft_rev: 4 },
      undo: { kind: 'restore_draft_snapshot', ruleset_id: DEF, draft_rev_after: 4 },
      reversibility: 'snapshot',
    });
    // The fingerprint of the draft as the save left it: its revision and the hash of the document it sent.
    const savedAfter = world.completions[0].after as { draft_rev: number; doc_hash: string };
    expect(world.completions[0].afterFingerprint).toBe(hashJson(draftDocState(4, savedAfter.doc_hash)));
    expect(world.audits[0].entry).toMatchObject({
      action: 'agent.draft.write',
      resource_id: DEF,
      metadata: { tool: 'ruleset_patch_draft', outcome: 'ok', draft_rev_before: 3, draft_rev_after: 4, snapshot_id: SNAPSHOT, doc_hash_before: world.snapshots[0].docHash },
    });
    expect(world.audits[0].context).toMatchObject({ agent_conversation_id: CONVERSATION, agent_tool: 'ruleset_patch_draft' });
    // Never the document: not in the answer, the ledger row's JSON or the audit event.
    for (const value of [result, world.completions, world.audits[0].entry, [...world.rows.values()].map(({ args }) => args)]) expect(JSON.stringify(value)).not.toContain(MARKER);
  });

  it('refuses a stale revision with the current one, without a ledger row, a snapshot or a write', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs({ draft_rev: 2 }), await context());

    expect(result).toEqual({ ok: false, code: 'ruleset_stale_revision', params: { draft_rev: 3 } });
    expect(world.log).toEqual([]);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('answers a revision that went stale between the read and the save (409 from the route) with the revision it carries', async () => {
    vi.mocked(saveDraft).mockRejectedValue(new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: 5 }));
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context());

    expect(result).toEqual({ ok: false, code: 'ruleset_stale_revision', params: { draft_rev: 5 } });
    expect(world.completions[0]).toMatchObject({ status: 'failed', outcomeKind: 'conflict', errorCode: 'ruleset_stale_revision' });
    // The snapshot stays attached to its (failed) ledger row; no draft write is audited.
    expect(world.audits).toEqual([]);
  });

  it.each([
    ['not JSON', 'not json', /not valid JSON/],
    ['not an array', '{"op":"add"}', /ops_json/],
    ['an unknown operation', JSON.stringify([{ op: 'move', from: '/a', path: '/b' }]), /ops_json/],
    ['an add without a value', JSON.stringify([{ op: 'add', path: '/rules/bans/-' }]), /ops_json/],
    ['an extra key', JSON.stringify([{ op: 'remove', path: '/note', extra: 1 }]), /ops_json/],
    ['the root path', JSON.stringify([{ op: 'replace', path: '', value: {} }]), /root_path_not_allowed/],
    ['a path that does not exist', JSON.stringify([{ op: 'remove', path: '/nope' }]), /op 0: path_not_found/],
    ['a forbidden segment', JSON.stringify([{ op: 'add', path: '/__proto__/x', value: 1 }]), /op 0: forbidden_segment/],
    ['an index out of range', JSON.stringify([{ op: 'add', path: '/rules/bans/9', value: 'x' }]), /op 0: index_out_of_range/],
  ])('refuses %s as validation_failed without a ledger row, a snapshot or a write', async (_name, opsJson, issues) => {
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs({ ops_json: opsJson }), await context());

    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect((result as { params?: { issues?: string } }).params?.issues).toMatch(issues);
    expect(world.log).toEqual([]);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('refuses a draft too large to snapshot (draft_too_large) without a write', async () => {
    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: { name: 'Spring', filler: 'x'.repeat(270_000) }, draft_rev: 3 });
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs({ ops_json: JSON.stringify([{ op: 'replace', path: '/name', value: 'Autumn' }]) }), await context());

    expect(result).toEqual({ ok: false, code: 'draft_too_large' });
    expect(world.log).toEqual([]);
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('measures the snapshot the way the table does: a document whose compact JSON fits but whose jsonb text does not is refused', async () => {
    // 130,000 one-digit items: compact JSON is ~260 kB (under the limit), but jsonb prints a space after every comma (~390 kB).
    const items = Array.from({ length: 130_000 }, () => 1);
    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: { list: items }, draft_rev: 3 });
    expect(JSON.stringify({ list: items }).length).toBeLessThan(262_144);
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs({ ops_json: JSON.stringify([{ op: 'add', path: '/x', value: 1 }]) }), await context());
    expect(result).toEqual({ ok: false, code: 'draft_too_large' });
  });

  it('refuses an admin who may view the ruleset but not edit its draft, before anything is written', async () => {
    vi.mocked(requireRulesetViewer).mockResolvedValue(access({ owner_id: '99999999-9999-4999-8999-999999999999', visibility: 'league' }, player({ isAdmin: false, isResourceAdmin: true })));
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context());
    expect(result).toMatchObject({ ok: false, code: 'forbidden' });
    expect(world.log).toEqual([]);
  });

  it('answers ruleset_not_found for a ruleset the guard does not know', async () => {
    vi.mocked(requireRulesetViewer).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
    expect(await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context())).toEqual({ ok: false, code: 'ruleset_not_found' });
    expect(world.log).toEqual([]);
  });

  it('maps the document limit of the route and the draft limiter to their codes (the ledger row is closed as failed)', async () => {
    vi.mocked(saveDraft).mockRejectedValueOnce(new RulesetStudioError('ruleset_document_too_large'));
    expect(await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context({ toolUseId: 'toolu_a' }))).toMatchObject({ ok: false, code: 'ruleset_document_too_large' });

    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 9 } as never);
    expect(await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context({ toolUseId: 'toolu_b' }))).toEqual({ ok: false, code: 'rate_limited', params: { seconds: 9 } });
  });

  it('answers a masked 500 as an unknown outcome (re-read before retrying), keeps the snapshot, audits as unknown and does not retry', async () => {
    vi.mocked(saveDraft).mockRejectedValue(new Error('deadlock detected 10.0.0.5'));
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), await context());

    expect(result).toEqual({ ok: false, code: 'unknown_outcome', params: { re_read: 'ruleset_get' } });
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(world.snapshots).toHaveLength(1);
    expect(world.completions[0]).toMatchObject({ status: 'unknown', outcomeKind: 'masked_server_error', entityId: DEF, undo: { kind: 'restore_draft_snapshot', draft_rev_after: null } });
    expect(world.audits[0].entry).toMatchObject({ metadata: { outcome: 'unknown', draft_rev_before: 3, draft_rev_after: null } });
  });

  it('refuses a body its binding no longer allows (second lock) after the snapshot, before the route', async () => {
    const strict = createBindingRegistry([{ ...rulesetPatchDraft, bodySchema: z.strictObject({ draft_rev: z.literal(99), document: z.record(z.string(), z.unknown()) }) }]);
    const result = await createStagedRunner(deps(strict))(tool('ruleset_patch_draft'), patchArgs(), await context());

    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(world.log).toEqual(['action.insert', 'snapshot.insert', 'action.complete']);
    expect(world.completions[0]).toMatchObject({ status: 'skipped', outcomeKind: 'not_dispatched' });
  });

  it('answers unauthenticated when the session expired between the read and the call, and writes nothing', async () => {
    const ctx = await context({ expires: new Date(Date.now() + 200).toISOString() });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await createStagedRunner(deps())(tool('ruleset_patch_draft'), patchArgs(), ctx);
    expect(result).toEqual({ ok: false, code: 'unauthenticated' });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(world.completions[0]).toMatchObject({ status: 'failed', outcomeKind: 'unauthenticated' });
  });
});

// ─── Gates before anything is written ────────────────────────────────────────

describe('the gates of both tools', () => {
  it('phase cap 0: both answer phase_disabled and touch nothing', async () => {
    maxPhase = 0;
    const runner = createStagedRunner(deps());
    expect(await runner(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, await context())).toEqual({ ok: false, code: 'phase_disabled' });
    expect(await runner(tool('ruleset_patch_draft'), patchArgs(), await context())).toEqual({ ok: false, code: 'phase_disabled' });
    expect(world.log).toEqual([]);
    expect(dispatched()).toBe(false);
    expect(requireRulesetViewer).not.toHaveBeenCalled();
  });

  it('a turn without a verified session: agent_harness_error, no ledger row, no snapshot, no route', async () => {
    const runner = createStagedRunner(deps());
    const ctx = await context({ withSession: false });
    expect(await runner(tool('ruleset_create_draft'), { mode: 'new', name: 'Spring OU', base_locale: 'en' }, ctx)).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(await runner(tool('ruleset_patch_draft'), patchArgs(), ctx)).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(world.log).toEqual([]);
    expect(dispatched()).toBe(false);
    expect(requireRulesetViewer).not.toHaveBeenCalled();
  });

  it('without the draft dependencies the tools stay tool_not_available', async () => {
    const { drafts: _drafts, ...bare } = deps();
    expect(await createStagedRunner(bare)(tool('ruleset_patch_draft'), patchArgs(), await context())).toEqual({ ok: false, code: 'tool_not_available' });
  });

  it('rejects an argument the tool schema does not allow before it reads anything', async () => {
    const result = await createStagedRunner(deps())(tool('ruleset_create_draft'), { mode: 'fork_preset' }, await context());
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(world.log).toEqual([]);
  });
});
