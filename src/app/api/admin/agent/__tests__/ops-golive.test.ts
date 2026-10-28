/**
 * The Go-live bindings (`_ops/g`) against the REAL route modules and the real executor: each of the four stageable G cards is
 * staged by the real stager, approved, and its ONE call runs through `invokeRoute` into the route's own handler, validation,
 * error mapping and audit calls. Only the guards and the data layer are mocked, as the repo's route tests do: the "database"
 * is a small in-memory world the mocked query functions read and write, so a read-back sees what the route wrote.
 *
 * Also here: a route 409 landing as `failed` with its catalogued code, a masked 500 reconciled by the read-back (adopted when
 * the write is there, `unknown` when it is not), the second lock (a tampered body is refused before dispatch), the agent
 * metadata on the routes' own audit events, and the posts the start routes fire (never suppressed, never duplicated).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const V2 = '00000000-0000-4000-8000-000000009102';
const V3 = '00000000-0000-4000-8000-000000009103';
const ROUND_ID = '00000000-0000-4000-8000-000000007301';
/** After the approval of the fake clock (2026-10-27T12:00:00Z), and a long time before it. */
const WRITTEN_AT = '2026-10-27T12:00:04.000Z';
const OLD = '2026-10-27T10:00:00.000Z';

const db = vi.hoisted(() => ({
  audit: [] as Array<Record<string, unknown>>,
  discord: [] as Array<Record<string, unknown>>,
  social: [] as Array<Record<string, unknown>>,
  versions: [] as Array<Record<string, unknown>>,
  /** `kind:id` -> the version id the target pins. */
  pins: {} as Record<string, string>,
  names: {} as Record<string, string>,
  /** What the pin move does at target `at` (0-based): a catalogued refusal, or a crash that the route masks. */
  pinFailure: null as null | { at: number; error: 'moved' | 'locked' | 'confirm' | 'crash' },
  rounds: [] as Array<Record<string, unknown>>,
  matches: [] as Array<Record<string, unknown>>,
  tournament: null as null | Record<string, unknown>,
  seasonFormat: 'singles' as string,
  season: { id: '00000000-0000-4000-8000-000000000720', status: 'upcoming' } as Record<string, unknown>,
  failStart: false,
  failMatches: false,
  /** The bracket engine dies after it wrote the rounds, before the tournament moved. */
  bracketCrash: false,
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
    AuthError: class AuthError extends Error {
      constructor(
        message: string,
        public statusCode: number,
        public code?: string,
      ) {
        super(message);
      }
    },
  };
});
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 10, retryAfterSeconds: 0 })),
}));

// The ruleset routes: the guard, the library's publish and the pin move are the data layer.
vi.mock('@/lib/ruleset-studio/guards', () => ({
  requireRulesetViewer: vi.fn(async (id: string) => ({
    player: { playerId: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', isAdmin: true },
    definition: { id, slug: 'spring-ou' },
    actor: { playerId: '00000000-0000-4000-8000-000000000001', isAdmin: true },
  })),
}));
vi.mock('@/lib/ruleset-studio/library', () => ({
  assertCanEditDraft: vi.fn(),
  publish: vi.fn(async (actor: { playerId: string }, meta: { id: string }) => {
    const row = { id: '00000000-0000-4000-8000-000000009103', version_no: 3, definition_id: meta.id, created_at: '2026-10-27T12:00:04.000Z', created_by: actor.playerId };
    db.versions.unshift(row);
    return { version: { ...row, content_hash: 'c'.repeat(8), resolved_hash: 'r'.repeat(8) }, definition: { id: meta.id } };
  }),
}));
vi.mock('@/lib/ruleset-studio/pins', async () => {
  const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
  return {
    movePins: vi.fn(
      async (input: {
        definition: { id: string };
        toVersionNo: number;
        targets: Array<{ kind: string; id: string }>;
        confirmStarted: string[];
        onMoved?: (moved: Record<string, unknown>, to: { version_id: string; version_no: number }) => void;
      }) => {
        const version = db.versions.find((candidate) => candidate.definition_id === input.definition.id && candidate.version_no === input.toVersionNo);
        if (version === undefined) throw new RulesetStudioError('ruleset_not_found');
        const to = { version_id: version.id as string, version_no: version.version_no as number };
        const moved: Array<Record<string, unknown>> = [];
        for (const [index, target] of input.targets.entries()) {
          const key = `${target.kind}:${target.id}`;
          if (db.pinFailure?.at === index) {
            if (db.pinFailure.error === 'moved') throw new RulesetStudioError('ruleset_pin_moved', { target: db.names[key] ?? 'target' });
            if (db.pinFailure.error === 'locked') throw new RulesetStudioError('ruleset_pin_locked');
            if (db.pinFailure.error === 'confirm') throw new RulesetStudioError('ruleset_pin_confirm_required', { targets: db.names[key] ?? 'target' });
            throw new Error('connection reset (secret detail)');
          }
          const from = db.pins[key] ?? null;
          db.pins[key] = to.version_id;
          const entry = { kind: target.kind, id: target.id, name: db.names[key] ?? 'target', season_id: null, from_version_id: from, started: input.confirmStarted.includes(target.id), difference: null };
          moved.push(entry);
          input.onMoved?.(entry, to);
        }
        return { ...to, moved };
      },
    ),
  };
});
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  listRulesetVersions: vi.fn(async (definitionId: string) =>
    db.versions.filter((version) => version.definition_id === definitionId).sort((a, b) => (b.version_no as number) - (a.version_no as number)),
  ),
  getPinTargetStates: vi.fn(async (seasonIds: string[], tournamentIds: string[]) => [
    ...seasonIds.map((id) => ({ kind: 'season', id, name: db.names[`season:${id}`], status: 'active', season_id: null, ruleset_id: db.pins[`season:${id}`] ?? null })),
    ...tournamentIds.map((id) => ({ kind: 'tournament', id, name: db.names[`tournament:${id}`], status: 'active', season_id: null, ruleset_id: db.pins[`tournament:${id}`] ?? null })),
  ]),
}));

// The round routes: the tournament, its rounds and matches, the bracket engine and the posts.
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async (id: string) => (db.tournament !== null && db.tournament.id === id ? { ...db.tournament, season_format_type: db.seasonFormat } : null)),
  getParticipants: vi.fn(async () => [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Carol' },
    { id: 'p4', name: 'Dave' },
  ]),
  updateTournament: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    Object.assign(db.tournament ?? {}, patch);
  }),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => db.season),
  updateSeason: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    Object.assign(db.season, patch);
  }),
}));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(async () => [...db.rounds].sort((a, b) => (a.round_number as number) - (b.round_number as number))),
  createRound: vi.fn(async (input: Record<string, unknown>) => {
    const row = {
      id: '00000000-0000-4000-8000-000000007301',
      tournament_id: input.tournament_id,
      name: input.name,
      round_number: input.round_number,
      best_of: input.best_of,
      status: 'pending',
      pairings_generated: false,
      deadline: null,
      bracket_side: null,
      bye_player_ids: input.bye_player_ids ?? [],
      created_at: '2026-10-27T12:00:05.000Z',
      updated_at: '2026-10-27T12:00:05.000Z',
    };
    db.rounds.push(row);
    return row;
  }),
  updateRoundByePlayers: vi.fn(),
  updateRoundStatus: vi.fn(async (id: string, status: string) => {
    if (db.failStart) throw new Error('start failed (secret detail)');
    const row = db.rounds.find((round) => round.id === id);
    if (row !== undefined) row.status = status;
    return { ...row, status };
  }),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(async (inputs: Array<Record<string, unknown>>) => {
    if (db.failMatches) throw new Error('connection reset (secret detail)');
    db.matches.push(...inputs);
  }),
  getCompletedMatchRecords: vi.fn(async () => []),
  getMatchesByTournament: vi.fn(async () => db.matches),
}));
vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(async () => []),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroups: vi.fn(async () => []), seasonHasGroups: vi.fn(async () => false) }));
vi.mock('@/lib/tournament', () => ({
  generateRound: vi.fn(() => ({ pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }, { player_1_id: 'p3', player_2_id: 'p4' }], round_name: 'Round 1', bye_player_ids: [] })),
}));
vi.mock('@/lib/tournament/bracket-generate', async () => {
  const { UserFacingError } = await import('@/lib/api/user-facing-error');
  return {
    generateEliminationBracket: vi.fn(async () => {
      if (db.rounds.length > 0) throw new UserFacingError('Bracket already generated', { code: 'bracket_already_generated', status: 409 });
      for (let index = 0; index < 3; index += 1) {
        db.rounds.push({ id: `00000000-0000-4000-8000-00000000740${index}`, tournament_id: db.tournament?.id, name: `Round ${index + 1}`, round_number: index + 1, status: 'pending', created_at: '2026-10-27T12:00:05.000Z' });
      }
      if (db.bracketCrash) throw new Error('connection reset (secret detail)');
      Object.assign(db.tournament ?? {}, { status: 'active', current_round: 1 });
      return { rounds_created: 3, matches_materialized: 2 };
    }),
  };
});
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn(async (payload: Record<string, unknown>) => void db.discord.push(payload)) }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn(async (payload: Record<string, unknown>) => void db.social.push(payload)) }));
vi.mock('@/lib/ai/trigger', () => ({ triggerTournamentReport: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ ENABLE_KALE_CABBAGE: false }));
vi.mock('@/lib/format-studio/attach', () => ({ assertSeasonFormatAttached: vi.fn() }));

import { ERROR_CATALOGS } from '@/i18n/messages/errors';
import { checkCall } from '@/lib/ai/admin-agent/dispatch';
import { parseAdminAgentEnv } from '@/lib/ai/admin-agent/env';
import { executeProposal, type ExecutorDeps, type ProposalResult } from '@/lib/ai/admin-agent/proposals/executor';
import { ADMIN, CONVERSATION_ID, DEFINITION_ID, NOW, SEASON_ID, TOKEN_SECRET, TOURNAMENT_ID, makeHarness, type HarnessOptions } from '@/lib/ai/admin-agent/proposals/__tests__/helpers';
import { ExecStore, recordedSession, reseal, statusesOf, type World } from '@/lib/ai/admin-agent/proposals/__tests__/executor-helpers';
import { deriveApprovalToken } from '@/lib/ai/admin-agent/proposals/token';
import type { StoredStep } from '@/lib/ai/admin-agent/proposals/steps';
import type { StageStaged } from '@/lib/ai/admin-agent/proposals/types';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { assertSeasonFormatAttached } from '@/lib/format-studio/attach';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { publish } from '@/lib/ruleset-studio/library';
import { movePins } from '@/lib/ruleset-studio/pins';
import { getBindingRegistry } from '../_ops/g';

const registry = getBindingRegistry();

/** The tournament row the round routes read: a phase of the league, not started. */
const tournamentRow = (bracketType: string): Record<string, unknown> => ({
  id: TOURNAMENT_ID,
  name: 'Regular season',
  season_id: SEASON_ID,
  bracket_type: bracketType,
  status: 'upcoming',
  current_round: 0,
  best_of_default: 3,
  bo_overrides: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(db, {
    audit: [],
    discord: [],
    social: [],
    versions: [{ id: V2, version_no: 2, definition_id: DEFINITION_ID, created_at: OLD, created_by: ADMIN }],
    pins: { [`season:${SEASON_ID}`]: V2, [`tournament:${TOURNAMENT_ID}`]: V2 },
    names: { [`season:${SEASON_ID}`]: 'Gen 9 OU League', [`tournament:${TOURNAMENT_ID}`]: 'Regular season' },
    pinFailure: null,
    rounds: [],
    matches: [],
    tournament: tournamentRow('swiss'),
    seasonFormat: 'singles',
    season: { id: SEASON_ID, status: 'upcoming' },
    failStart: false,
    failMatches: false,
    bracketCrash: false,
  });
});

// ─── The world: a real staged Go-live card, approved with the real bindings ──────────────────────────────────────────────

interface GoLiveWorld {
  readonly store: ExecStore;
  readonly audits: Array<{ action: string; metadata?: unknown }>;
  readonly events: Array<{ event: string; data: Record<string, unknown> }>;
  readonly sleeps: number[];
  readonly proposalId: string;
  readonly row: World['row'];
  readonly steps: StoredStep[];
  readonly step: StoredStep;
  approve(): Promise<ProposalResult>;
}

async function stageGoLive(tool: string, args: unknown, see: string[], options: HarnessOptions = {}): Promise<GoLiveWorld> {
  const harness = makeHarness(options);
  harness.store.see(CONVERSATION_ID, ...see);
  const staged = (await harness.stage(tool, args)) as StageStaged | { status: 'refused'; code: string };
  if (staged.status !== 'staged') throw new Error(`staging refused: ${JSON.stringify(staged)}`);

  const now = () => new Date(NOW.getTime());
  const row = harness.store.proposals.find((candidate) => candidate.id === staged.proposal_id)!;
  const store = new ExecStore(harness.store.proposals, now);
  const token = deriveApprovalToken(TOKEN_SECRET, staged.proposal_id, ADMIN);
  const audits: GoLiveWorld['audits'] = [];
  const events: GoLiveWorld['events'] = [];
  const sleeps: number[] = [];

  const deps: ExecutorDeps = {
    store: store.asStore(),
    // The REAL bindings.
    bindings: registry,
    fingerprints: harness.world,
    config: () => parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: '1', ADMIN_AGENT_GOLIVE: '1', ADMIN_AGENT_MAX_PHASE: '1' }),
    registryVersion: () => 'abcdef0123456789',
    rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    recordEvent: async (_adminId, _conversationId, event, data) => {
      events.push({ event, data: { ...data } });
    },
    audit: (entry) => {
      audits.push(entry);
    },
    now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  const steps = row.steps as unknown as StoredStep[];
  return {
    store,
    audits,
    events,
    sleeps,
    proposalId: staged.proposal_id,
    row,
    steps,
    get step() {
      return steps[0];
    },
    approve: async () =>
      executeProposal(deps, {
        mode: 'approve',
        adminId: ADMIN,
        adminName: 'Test Admin',
        isSiteAdmin: true,
        session: await recordedSession(),
        inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) },
        proposalId: staged.proposal_id,
        approval: { token, proposalHash: row.proposal_hash, previewHash: row.preview_hash, acks: row.acks_required as string[] },
      }),
  };
}

const publishWorld = (options?: HarnessOptions) => stageGoLive('propose_publish_ruleset', { ruleset_id: DEFINITION_ID, draft_rev: 3 }, [DEFINITION_ID], options);
const PIN_TARGETS = [
  { kind: 'season' as const, id: SEASON_ID },
  { kind: 'tournament' as const, id: TOURNAMENT_ID },
];
const pinWorld = (options?: HarnessOptions) =>
  stageGoLive('propose_move_pin', { ruleset_id: DEFINITION_ID, to_version_no: 3, targets: PIN_TARGETS }, [DEFINITION_ID, SEASON_ID, TOURNAMENT_ID], options);
const startWorld = (args: Record<string, unknown> = {}, options?: HarnessOptions) => stageGoLive('propose_start_phase', { tournament_id: TOURNAMENT_ID, ...args }, [TOURNAMENT_ID], options);
const bracketWorld = (options?: HarnessOptions) => stageGoLive('propose_generate_bracket', { tournament_id: TOURNAMENT_ID }, [TOURNAMENT_ID], options);

/** The version 3 a publish or a pin move works with, as the database holds it once the publish happened. */
const publishedV3 = () => db.versions.unshift({ id: V3, version_no: 3, definition_id: DEFINITION_ID, created_at: WRITTEN_AT, created_by: ADMIN });

const auditRows = (action: string) => db.audit.filter((entry) => entry.action === action);
const agentMeta = (world: GoLiveWorld, step: string) => ({
  via: 'agent',
  agent_conversation_id: CONVERSATION_ID,
  agent_proposal_id: world.proposalId,
  agent_step: step,
  agent_tool: step,
  approved_by: ADMIN,
  plan_code: world.row.proposal_hash.slice(0, 8),
  args_hash: world.step.args_hash,
});

// ─── The cards agree with the bindings ───────────────────────────────────────────────────────────────────────────────────

describe('what staging stores is what the bindings run', () => {
  it.each([
    ['publish_ruleset', () => publishWorld()],
    ['move_pin', () => pinWorld()],
    ['start_phase', () => startWorld({ start_round: true })],
    ['generate_bracket', () => bracketWorld()],
  ])('%s: operation, method, route, class and the stored request fit the binding', async (op, make) => {
    const world = await make();
    const { step } = world;
    const binding = registry.get(step.op);
    expect(step.op).toBe(op);
    expect(binding, op).toBeDefined();
    expect({ method: binding!.method, path: binding!.path, class: binding!.class, phase: binding!.phase }).toEqual({ method: step.method, path: step.route_template, class: 'G', phase: 1 });
    expect(step.class).toBe('G');
    expect(world.row.class).toBe('G');
    expect(checkCall(binding!, { params: step.path_params as Record<string, string>, body: step.body_template })).toEqual({ ok: true });
  });

  it('accepts the bodies staging derives in every shape: a changelog, started targets, a bare start and a bracket', async () => {
    const published = await publishWorld({ conversation: { ui_locale: 'de' } });
    expect(published.step.body_template).toEqual({ draft_rev: 3 });
    const withLog = await stageGoLive('propose_publish_ruleset', { ruleset_id: DEFINITION_ID, draft_rev: 3, changelog_text: 'Kingambit gebannt' }, [DEFINITION_ID], { conversation: { ui_locale: 'de' } });
    expect(checkCall(registry.get('publish_ruleset')!, { params: withLog.step.path_params as Record<string, string>, body: withLog.step.body_template })).toEqual({ ok: true });
    const started = await stageGoLive('propose_move_pin', { ruleset_id: DEFINITION_ID, to_version_no: 3, targets: PIN_TARGETS }, [DEFINITION_ID, SEASON_ID, TOURNAMENT_ID], {
      source: { targets: (list) => list.map((t) => ({ kind: t.kind, id: t.id, name: 'x', started: t.kind === 'season', completed: false, pinnedVersionId: V2, pinnedDefinitionId: DEFINITION_ID })) },
    });
    expect(started.step.body_template).toEqual({ to_version_no: 3, targets: PIN_TARGETS, confirm_started: [SEASON_ID] });
    expect(checkCall(registry.get('move_pin')!, { params: started.step.path_params as Record<string, string>, body: started.step.body_template })).toEqual({ ok: true });
    const bare = await startWorld();
    expect(bare.step.body_template).toEqual({});
    expect(checkCall(registry.get('start_phase')!, { params: bare.step.path_params as Record<string, string>, body: bare.step.body_template })).toEqual({ ok: true });
  });
});

// ─── publish_ruleset ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('publish_ruleset through the real route', () => {
  it('publishes, adopts the version the route answered with, and tags the route\'s own audit event with the agent', async () => {
    const world = await publishWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'publish_ruleset', status: 'ok', entity_id: V3 }] });
    expect(vi.mocked(publish)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(publish).mock.calls[0][2]).toEqual({ draftRev: 3, changelog: null });
    expect(world.store.action('publish_ruleset')).toMatchObject({
      status: 'ok',
      http_status: 201,
      outcome_kind: 'ok',
      entity_type: 'ruleset',
      entity_id: V3,
      result: { id: V3 },
      verify: { status: 'confirmed', id: V3, version_no: 3 },
    });
    expect(auditRows('ruleset.publish')).toHaveLength(1);
    expect(auditRows('ruleset.publish')[0]).toMatchObject({
      actor_id: ADMIN,
      actor_name: 'Test Admin',
      resource_type: 'ruleset',
      resource_id: DEFINITION_ID,
      resource_name: 'spring-ou',
      metadata: { version_no: 3, ...agentMeta(world, 'publish_ruleset') },
    });
    // The one Go-live execution was counted at the claim.
    expect(world.store.budgetClaims).toEqual([[{ counter: 'golive_executions', amount: 1, cap: 6 }]]);
    expect(world.audits.map((entry) => entry.action)).toContain('agent.step.execute');
  });

  it('lands a stale revision as failed with the route\'s code, and says in the ledger that nothing was published', async () => {
    const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
    vi.mocked(publish).mockRejectedValueOnce(new RulesetStudioError('ruleset_stale_revision', undefined, { draft_rev: 4 }));
    const world = await publishWorld();
    const result = await world.approve();

    expect(result.status).toBe('failed');
    expect(result.steps).toEqual([{ key: 'publish_ruleset', status: 'failed', code: 'ruleset_stale_revision' }]);
    expect(world.store.action('publish_ruleset')).toMatchObject({ status: 'failed', http_status: 409, outcome_kind: 'conflict', error_code: 'ruleset_stale_revision', verify: { status: 'absent' } });
    expect(auditRows('ruleset.publish')).toEqual([]);
    expect(world.audits.map((entry) => entry.action)).toContain('agent.step.fail');
  });

  it('lands a draft with errors (422) as failed with ruleset_document_invalid', async () => {
    const { RulesetStudioError } = await import('@/lib/ruleset-studio/errors');
    vi.mocked(publish).mockRejectedValueOnce(new RulesetStudioError('ruleset_document_invalid'));
    const world = await publishWorld();
    const result = await world.approve();

    expect(result.steps).toEqual([{ key: 'publish_ruleset', status: 'failed', code: 'ruleset_document_invalid' }]);
    expect(world.store.action('publish_ruleset')).toMatchObject({ status: 'failed', http_status: 422, outcome_kind: 'validation', error_code: 'ruleset_document_invalid' });
  });

  it('adopts the version after a masked 500 when the publish went through', async () => {
    vi.mocked(publish).mockImplementationOnce(async () => {
      publishedV3();
      throw new Error('connection reset (secret detail)');
    });
    const world = await publishWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'publish_ruleset', status: 'ok', entity_id: V3 }] });
    expect(world.store.action('publish_ruleset')).toMatchObject({ status: 'ok', outcome_kind: 'masked_server_error', verify: { status: 'confirmed', id: V3, version_no: 3 } });
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
    expect(vi.mocked(publish)).toHaveBeenCalledTimes(1);
  });

  it('leaves the step unknown, and the proposal unknown, when the read-back finds nothing after the settle wait', async () => {
    vi.mocked(publish).mockRejectedValueOnce(new Error('connection reset (secret detail)'));
    const world = await publishWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'unknown', steps: [{ key: 'publish_ruleset', status: 'unknown', code: 'unknown_outcome' }] });
    expect(world.sleeps).toEqual([15_000]);
    expect(world.store.action('publish_ruleset')).toMatchObject({ status: 'unknown', outcome_kind: 'masked_server_error', verify: { status: 'absent' } });
    expect(vi.mocked(publish)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
  });

  it('refuses a body that gained a key, and a path id that is not a uuid, before the route is called', async () => {
    const extra = await publishWorld();
    reseal(extra as unknown as World, (steps) => {
      (steps[0].body_template as Record<string, unknown>).changelog_extra = 'x';
    });
    expect(await extra.approve()).toMatchObject({ status: 'failed', steps: [{ key: 'publish_ruleset', status: 'failed', code: 'agent_harness_error' }] });

    const badId = await publishWorld();
    reseal(badId as unknown as World, (steps) => {
      steps[0].path_params = { id: '../admin' };
    });
    expect(await badId.approve()).toMatchObject({ status: 'failed', steps: [{ status: 'failed', code: 'agent_harness_error' }] });
    expect(vi.mocked(publish)).not.toHaveBeenCalled();
    expect(db.audit).toEqual([]);
  });
});

// ─── move_pin ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('move_pin through the real route', () => {
  beforeEach(() => {
    publishedV3();
  });

  it('moves every target, audits each move with the agent metadata, counts the targets and confirms by read-back', async () => {
    const world = await pinWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'move_pin', status: 'ok', entity_id: V3 }] });
    expect(vi.mocked(movePins)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(movePins).mock.calls[0][0]).toMatchObject({ toVersionNo: 3, targets: PIN_TARGETS, confirmStarted: [] });
    expect(db.pins).toEqual({ [`season:${SEASON_ID}`]: V3, [`tournament:${TOURNAMENT_ID}`]: V3 });
    expect(world.store.action('move_pin')).toMatchObject({
      status: 'ok',
      http_status: 200,
      entity_type: 'ruleset',
      entity_id: V3,
      result: { id: V3 },
      verify: { status: 'confirmed', id: V3, version_no: 3, moved: 2, expected: 2 },
    });
    const pinned = auditRows('ruleset.pin');
    expect(pinned.map((entry) => [entry.resource_type, entry.resource_id])).toEqual([
      ['season', SEASON_ID],
      ['tournament', TOURNAMENT_ID],
    ]);
    for (const entry of pinned) expect(entry.metadata).toMatchObject({ ruleset: 'spring-ou', version_no: 3, ...agentMeta(world, 'move_pin') });
    // Two pin targets and the one Go-live execution were claimed together, at the claim.
    expect(world.store.budgetClaims).toEqual([
      [
        { counter: 'pin_targets', amount: 2, cap: 50 },
        { counter: 'golive_executions', amount: 1, cap: 6 },
      ],
    ]);
  });

  it('passes the ids of started targets as confirm_started, as staging stored them', async () => {
    const world = await pinWorld({ source: { targets: (list) => list.map((t) => ({ kind: t.kind, id: t.id, name: 'x', started: t.kind === 'season', completed: false, pinnedVersionId: V2, pinnedDefinitionId: DEFINITION_ID })) } });
    const result = await world.approve();

    expect(result.status).toBe('completed');
    expect(vi.mocked(movePins).mock.calls[0][0]).toMatchObject({ confirmStarted: [SEASON_ID] });
    expect(auditRows('ruleset.pin').map((entry) => (entry.metadata as { started: boolean }).started)).toEqual([true, false]);
  });

  it('stops at a pin that moved meanwhile: failed with ruleset_pin_moved, and the ledger says one of two moved', async () => {
    db.pinFailure = { at: 1, error: 'moved' };
    const world = await pinWorld();
    const result = await world.approve();

    expect(result.status).toBe('failed');
    expect(result.steps).toEqual([{ key: 'move_pin', status: 'failed', code: 'ruleset_pin_moved' }]);
    expect(world.store.action('move_pin')).toMatchObject({
      status: 'failed',
      http_status: 409,
      outcome_kind: 'conflict',
      error_code: 'ruleset_pin_moved',
      verify: { status: 'unknown', moved: 1, expected: 2 },
    });
    // The earlier move stays and was audited by the route, with the agent metadata; the second left no event.
    expect(db.pins).toEqual({ [`season:${SEASON_ID}`]: V3, [`tournament:${TOURNAMENT_ID}`]: V2 });
    expect(auditRows('ruleset.pin')).toHaveLength(1);
    expect(auditRows('ruleset.pin')[0]).toMatchObject({ resource_id: SEASON_ID, metadata: agentMeta(world, 'move_pin') });
    expect(world.audits.map((entry) => entry.action)).toContain('agent.step.fail');
  });

  it('lands a finished target and a missing confirmation as failed with their codes, nothing moved', async () => {
    db.pinFailure = { at: 0, error: 'locked' };
    const locked = await pinWorld();
    expect((await locked.approve()).steps).toEqual([{ key: 'move_pin', status: 'failed', code: 'ruleset_pin_locked' }]);
    expect(locked.store.action('move_pin')).toMatchObject({ outcome_kind: 'locked', http_status: 409 });
    // A lock is not a conflict: nothing is read back.
    expect(locked.store.action('move_pin')?.verify).toBeNull();

    db.pinFailure = { at: 0, error: 'confirm' };
    const confirm = await pinWorld();
    expect((await confirm.approve()).steps).toEqual([{ key: 'move_pin', status: 'failed', code: 'ruleset_pin_confirm_required' }]);
    expect(confirm.store.action('move_pin')).toMatchObject({ outcome_kind: 'conflict', verify: { status: 'absent', moved: 0, expected: 2 } });
    expect(db.pins).toEqual({ [`season:${SEASON_ID}`]: V2, [`tournament:${TOURNAMENT_ID}`]: V2 });
    expect(auditRows('ruleset.pin')).toEqual([]);
  });

  it('keeps a half-done move unknown after a masked 500, never retried, and the proposal unknown', async () => {
    db.pinFailure = { at: 1, error: 'crash' };
    const world = await pinWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'unknown', steps: [{ key: 'move_pin', status: 'unknown', code: 'unknown_outcome' }] });
    expect(world.sleeps).toEqual([15_000]);
    expect(world.store.action('move_pin')).toMatchObject({ status: 'unknown', outcome_kind: 'masked_server_error', verify: { status: 'unknown', moved: 1, expected: 2 } });
    expect(vi.mocked(movePins)).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
  });

  it('adopts a move whose answer was lost when every target is there, and stays absent when none is', async () => {
    vi.mocked(movePins).mockImplementationOnce(async () => {
      db.pins = { [`season:${SEASON_ID}`]: V3, [`tournament:${TOURNAMENT_ID}`]: V3 };
      throw new Error('connection reset (secret detail)');
    });
    const adopted = await pinWorld();
    expect(await adopted.approve()).toMatchObject({ status: 'completed', steps: [{ key: 'move_pin', status: 'ok', entity_id: V3 }] });
    expect(adopted.store.action('move_pin')).toMatchObject({ outcome_kind: 'masked_server_error', verify: { status: 'confirmed', moved: 2, expected: 2 } });

    db.pinFailure = { at: 0, error: 'crash' };
    db.pins = { [`season:${SEASON_ID}`]: V2, [`tournament:${TOURNAMENT_ID}`]: V2 };
    const none = await pinWorld();
    expect(await none.approve()).toMatchObject({ status: 'unknown', steps: [{ status: 'unknown' }] });
    expect(none.store.action('move_pin')?.verify).toEqual({ status: 'absent', moved: 0, expected: 2 });
  });

  it('refuses a tampered body before the route: a foreign confirm_started, an extra key, a target of another kind', async () => {
    for (const edit of [
      (body: Record<string, unknown>) => (body.confirm_started = ['00000000-0000-4000-8000-000000004242']),
      (body: Record<string, unknown>) => (body.zz_injected = true),
      (body: Record<string, unknown>) => (body.targets = [{ kind: 'league', id: SEASON_ID }]),
    ]) {
      const world = await pinWorld();
      reseal(world as unknown as World, (steps) => edit(steps[0].body_template as Record<string, unknown>));
      expect(await world.approve()).toMatchObject({ status: 'failed', steps: [{ key: 'move_pin', status: 'failed', code: 'agent_harness_error' }] });
    }
    expect(vi.mocked(movePins)).not.toHaveBeenCalled();
    expect(db.pins).toEqual({ [`season:${SEASON_ID}`]: V2, [`tournament:${TOURNAMENT_ID}`]: V2 });
  });
});

// ─── start_phase ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('start_phase through the real route', () => {
  it('writes round 1, starts it when asked, and lets the route fire its posts exactly once each', async () => {
    const world = await startWorld({ start_round: true });
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'start_phase', status: 'ok', entity_id: ROUND_ID }] });
    expect(world.store.action('start_phase')).toMatchObject({
      status: 'ok',
      http_status: 201,
      entity_id: ROUND_ID,
      result: { id: ROUND_ID },
      verify: { status: 'confirmed', id: ROUND_ID, round_number: 1, started: true },
    });
    expect(db.tournament).toMatchObject({ status: 'active', current_round: 1 });
    expect(db.rounds).toHaveLength(1);
    expect(db.matches).toHaveLength(2);
    expect(db.season.status).toBe('active');
    // Nothing is suppressed and nothing is duplicated: the round post and the tournament-started post, to both channels.
    expect(vi.mocked(emitDiscordEvent).mock.calls.map(([payload]) => payload.event_type)).toEqual(['round_generated', 'tournament_started']);
    expect(vi.mocked(emitSocialEvent).mock.calls.map(([payload]) => payload.event_type)).toEqual(['round_generated', 'tournament_started']);
    expect(auditRows('round.generate')).toHaveLength(1);
    expect(auditRows('round.generate')[0]).toMatchObject({
      actor_id: ADMIN,
      resource_type: 'round',
      resource_id: ROUND_ID,
      metadata: { tournament_id: TOURNAMENT_ID, round_number: 1, matches: 2, started: true, ...agentMeta(world, 'start_phase') },
    });
    expect(world.store.budgetClaims).toEqual([[{ counter: 'golive_executions', amount: 1, cap: 6 }]]);
  });

  it('is still a success when the round start fails: the data is written, the round is pending', async () => {
    db.failStart = true;
    const world = await startWorld({ start_round: true });
    const result = await world.approve();

    expect(result.status).toBe('completed');
    expect(world.store.action('start_phase')).toMatchObject({ status: 'ok', verify: { status: 'confirmed', id: ROUND_ID, started: false } });
    expect(auditRows('round.generate')[0].metadata).toMatchObject({ started: false });
  });

  it('writes a pending round when no start was asked', async () => {
    const world = await startWorld();
    expect((await world.approve()).status).toBe('completed');
    expect(world.store.action('start_phase')?.verify).toMatchObject({ status: 'confirmed', started: false });
    expect(db.rounds[0]).toMatchObject({ status: 'pending' });
  });

  it('lands rounds_round_already_written (409) as failed, and the ledger says no round of this call exists', async () => {
    db.rounds = [{ id: ROUND_ID, tournament_id: TOURNAMENT_ID, name: 'Round 1', round_number: 1, status: 'pending', created_at: OLD, bye_player_ids: [] }];
    db.matches = [{ round_id: ROUND_ID }];
    const world = await startWorld();
    const result = await world.approve();

    expect(result.steps).toEqual([{ key: 'start_phase', status: 'failed', code: 'rounds_round_already_written' }]);
    expect(world.store.action('start_phase')).toMatchObject({ http_status: 409, outcome_kind: 'conflict', verify: { status: 'absent' } });
    expect(db.rounds).toHaveLength(1);
    expect(vi.mocked(emitDiscordEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(emitSocialEvent)).not.toHaveBeenCalled();
  });

  it('lands a custom league without an attached format as failed with format_not_attached, before anything is written', async () => {
    db.seasonFormat = 'custom';
    vi.mocked(assertSeasonFormatAttached).mockRejectedValueOnce(new FormatStudioError('format_not_attached'));
    const world = await startWorld();
    const result = await world.approve();

    expect(result.steps).toEqual([{ key: 'start_phase', status: 'failed', code: 'format_not_attached' }]);
    expect(world.store.action('start_phase')).toMatchObject({ http_status: 409, error_code: 'format_not_attached' });
    expect(db.rounds).toEqual([]);
  });

  it('does not adopt a half-written start after a masked 500: unknown, and the proposal unknown', async () => {
    db.failMatches = true;
    const world = await startWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'unknown', steps: [{ key: 'start_phase', status: 'unknown', code: 'unknown_outcome' }] });
    // The round was written, the matches and the tournament move were not.
    expect(db.rounds).toHaveLength(1);
    expect(db.tournament).toMatchObject({ status: 'upcoming', current_round: 0 });
    expect(world.store.action('start_phase')).toMatchObject({ status: 'unknown', verify: { status: 'unknown', id: ROUND_ID, round_number: 1, incomplete: true } });
    expect(world.sleeps).toEqual([15_000]);
    expect(vi.mocked(emitDiscordEvent)).not.toHaveBeenCalled();
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
  });

  it('adopts the start when the route died after every write (a masked 500 after the audit event), without posting twice', async () => {
    vi.mocked(emitDiscordEvent).mockImplementationOnce(() => {
      throw new Error('boom after the writes (secret detail)');
    });
    const world = await startWorld({ start_round: true });
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'start_phase', status: 'ok', entity_id: ROUND_ID }] });
    expect(world.store.action('start_phase')).toMatchObject({ outcome_kind: 'masked_server_error', verify: { status: 'confirmed', id: ROUND_ID, started: true } });
    // The read-back reads; it did not run the route again, so no round was written twice and no post was repeated.
    expect(db.rounds).toHaveLength(1);
    expect(vi.mocked(emitDiscordEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitSocialEvent)).not.toHaveBeenCalled();
  });

  it('refuses a tampered body before the route: start_round false, a stray key, an id that is not a uuid', async () => {
    for (const edit of [
      (step: StoredStep) => (step.body_template = { start_round: false }),
      (step: StoredStep) => (step.body_template = { zz_injected: true }),
      (step: StoredStep) => (step.path_params = { tid: 'not-a-uuid' }),
      (step: StoredStep) => (step.path_params = { id: TOURNAMENT_ID }),
    ]) {
      const world = await startWorld();
      reseal(world as unknown as World, (steps) => edit(steps[0]));
      expect(await world.approve()).toMatchObject({ status: 'failed', steps: [{ key: 'start_phase', status: 'failed', code: 'agent_harness_error' }] });
    }
    expect(db.rounds).toEqual([]);
    expect(vi.mocked(emitDiscordEvent)).not.toHaveBeenCalled();
  });
});

// ─── generate_bracket ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('generate_bracket through the real route', () => {
  beforeEach(() => {
    db.tournament = tournamentRow('single_elim');
  });

  it('generates the bracket, activates the league, posts once and confirms by read-back with the tournament id', async () => {
    const world = await bracketWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'completed', steps: [{ key: 'generate_bracket', status: 'ok', entity_id: TOURNAMENT_ID }] });
    expect(world.store.action('generate_bracket')).toMatchObject({
      status: 'ok',
      http_status: 201,
      entity_type: 'tournament',
      entity_id: TOURNAMENT_ID,
      result: { id: TOURNAMENT_ID },
      verify: { status: 'confirmed', id: TOURNAMENT_ID, rounds: 3 },
    });
    expect(db.rounds).toHaveLength(3);
    expect(db.season.status).toBe('active');
    expect(vi.mocked(emitDiscordEvent).mock.calls.map(([payload]) => payload.event_type)).toEqual(['round_generated']);
    expect(vi.mocked(emitSocialEvent).mock.calls.map(([payload]) => payload.event_type)).toEqual(['round_generated']);
    expect(auditRows('bracket.generate')).toHaveLength(1);
    expect(auditRows('bracket.generate')[0]).toMatchObject({
      resource_type: 'tournament',
      resource_id: TOURNAMENT_ID,
      metadata: { rounds_created: 3, matches_materialized: 2, started: false, ...agentMeta(world, 'generate_bracket') },
    });
    expect(world.store.budgetClaims).toEqual([[{ counter: 'golive_executions', amount: 1, cap: 6 }]]);
  });

  it('lands a bracket that already exists (409) as failed with its code; the older rounds are not this step\'s', async () => {
    db.rounds = [{ id: ROUND_ID, tournament_id: TOURNAMENT_ID, name: 'Round 1', round_number: 1, status: 'pending', created_at: OLD }];
    const world = await bracketWorld();
    const result = await world.approve();

    expect(result.steps).toEqual([{ key: 'generate_bracket', status: 'failed', code: 'bracket_already_generated' }]);
    expect(world.store.action('generate_bracket')).toMatchObject({ http_status: 409, outcome_kind: 'conflict', verify: { status: 'absent' } });
    expect(vi.mocked(emitDiscordEvent)).not.toHaveBeenCalled();
  });

  it('lands a custom league without a format as failed with format_not_attached', async () => {
    db.seasonFormat = 'custom';
    vi.mocked(assertSeasonFormatAttached).mockRejectedValueOnce(new FormatStudioError('format_not_attached'));
    const world = await bracketWorld();
    expect((await world.approve()).steps).toEqual([{ key: 'generate_bracket', status: 'failed', code: 'format_not_attached' }]);
    expect(db.rounds).toEqual([]);
  });

  it('does not adopt a bracket the engine did not finish (rounds written, tournament not moved): unknown', async () => {
    db.bracketCrash = true;
    const world = await bracketWorld();
    const result = await world.approve();

    expect(result).toMatchObject({ status: 'unknown', steps: [{ key: 'generate_bracket', status: 'unknown', code: 'unknown_outcome' }] });
    expect(world.store.action('generate_bracket')?.verify).toEqual({ status: 'unknown', id: TOURNAMENT_ID, rounds: 3, incomplete: true });
    expect(world.sleeps).toEqual([15_000]);
  });

  it('refuses start_round on a bracket, a stray key and a foreign path key before the route', async () => {
    for (const edit of [
      (step: StoredStep) => (step.body_template = { start_round: true }),
      (step: StoredStep) => (step.body_template = { zz_injected: true }),
      (step: StoredStep) => (step.path_params = { tid: TOURNAMENT_ID }),
    ]) {
      const world = await bracketWorld();
      reseal(world as unknown as World, (steps) => edit(steps[0]));
      expect(await world.approve()).toMatchObject({ status: 'failed', steps: [{ key: 'generate_bracket', status: 'failed', code: 'agent_harness_error' }] });
    }
    expect(db.rounds).toEqual([]);
    expect(vi.mocked(emitDiscordEvent)).not.toHaveBeenCalled();
  });
});

// ─── Shape of a Go-live run ──────────────────────────────────────────────────────────────────────────────────────────────

describe('what a Go-live proposal never does', () => {
  it('never resumes and never dispatches a second step: an unknown outcome finishes the proposal unknown', async () => {
    vi.mocked(publish).mockRejectedValueOnce(new Error('connection reset (secret detail)'));
    const world = await publishWorld();
    const result = await world.approve();
    expect(statusesOf(result)).toEqual(['publish_ruleset:unknown']);
    expect(world.row.status).toBe('unknown');
    expect(vi.mocked(publish)).toHaveBeenCalledTimes(1);
  });

  it('keeps a Build step out of a Go-live proposal and a Go-live step out of a Build', async () => {
    const world = await publishWorld();
    reseal(world as unknown as World, (steps) => {
      steps[0].op = 'league_create';
      steps[0].method = 'POST';
      steps[0].route_template = '/api/seasons';
    });
    await expect(world.approve()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'binding_differs:league_create' });
    expect(vi.mocked(publish)).not.toHaveBeenCalled();
  });
});

// ─── The error codes the four routes answer ──────────────────────────────────────────────────────────────────────────────

describe('the error catalogs hold every code the four routes answer, in English and German', () => {
  // A catalog entry is a text, or the plural forms of one (`{ one, other }`).
  const textOf = (entry: unknown): string => (typeof entry === 'string' ? entry : typeof entry === 'object' && entry !== null ? Object.values(entry).join(' ') : '');
  const en = Object.assign({}, ...Object.values(ERROR_CATALOGS).map((catalog) => catalog.en)) as Record<string, unknown>;
  const de = Object.assign({}, ...Object.values(ERROR_CATALOGS).map((catalog) => catalog.de)) as Record<string, unknown>;
  const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)[^}]*\}/g)].map((match) => match[1]))].sort();

  const CODES = [
    // publish
    'ruleset_stale_revision',
    'ruleset_document_invalid',
    'ruleset_nothing_to_publish',
    'ruleset_published_locked',
    'ruleset_preset_locked',
    'ruleset_version_quota_exceeded',
    'ruleset_not_found',
    // pins
    'ruleset_pin_moved',
    'ruleset_pin_locked',
    'ruleset_pin_confirm_required',
    'ruleset_pin_mismatch',
    // generate-round and generate-bracket
    'rounds_round_already_written',
    'format_not_attached',
    'tournament_not_found',
    'tournament_already_completed',
    'tournament_participants_too_few',
    'tournament_current_round_incomplete',
    'rounds_all_generated',
    'rounds_double_elim_starters_too_few',
    'bracket_already_generated',
    'bracket_generate_elim_only',
    'BRACKET_V2_MANAGED',
    // the harness
    'agent_harness_error',
    'unknown_outcome',
  ];

  it.each(CODES)('%s', (code) => {
    expect(textOf(en[code]).trim(), `${code} EN`).toBeTruthy();
    expect(textOf(de[code]).trim(), `${code} DE`).toBeTruthy();
    expect(placeholders(textOf(de[code])), `${code} placeholders`).toEqual(placeholders(textOf(en[code])));
  });
});
