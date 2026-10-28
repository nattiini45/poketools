import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { blockerCodes, okFacts, parseOrThrow, PLAYERS, RULESET_VERSION, uid, workedExample } from '../../plans/__tests__/fixtures';
import { parsePlanDocument } from '../../plans/schema';
import { proposalCardSchema } from '../card';
import { storedStepSchema, stepHashMatches } from '../steps';
import { ADMIN, CONVERSATION_ID, forbidden, makeHarness, seeWorkedExample } from './helpers';
import type { StageRefused, StageStaged } from '../types';

const staged = (result: unknown): StageStaged => {
  expect(result).toMatchObject({ status: 'staged' });
  return result as StageStaged;
};
const refused = (result: unknown): StageRefused => {
  expect(result).toMatchObject({ status: 'refused' });
  return result as StageRefused;
};

describe('propose_build: the plan 4.10 worked example', () => {
  it('stages one Build proposal with the steps derived by code', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    const result = staged(await h.stage('propose_build', { plan_revision: 1 }));

    expect(result.kind).toBe('build');
    expect(result.class).toBe('B');
    expect(result.plan_code).toMatch(/^[0-9a-f]{8}$/);
    expect(h.store.proposals).toHaveLength(1);
    const row = h.store.proposals[0];
    expect(row).toMatchObject({ kind: 'build', class: 'B', plan_id: uid(600), plan_revision: 1, locale: 'en', tool_registry_version: 'abcdef0123456789', supersede_key: `build:${uid(600)}` });
    expect(row.acks_required).toEqual(['visible_publicly']);

    const steps = storedStepSchema.array().parse(row.steps);
    expect(steps.map((s) => [s.key, s.op, s.method, s.route_template])).toEqual([
      ['league', 'league_create', 'POST', '/api/seasons'],
      ['roster.1', 'roster_add', 'POST', '/api/seasons/[id]/participants'],
      ['phase.regular_season', 'phase_create', 'POST', '/api/seasons/[id]/phases'],
      ['phase.playoffs', 'phase_create', 'POST', '/api/seasons/[id]/phases'],
    ]);
    // The league id is a symbolic reference, resolved from the ledger at execution; the template is what is hashed.
    expect(steps[1].path_params).toEqual({ id: { $ref: 'league.id' } });
    expect(steps[0].body_template).toMatchObject({ name: 'Gen 9 OU League', format_type: 'singles', ruleset_id: RULESET_VERSION, language: 'de' });
    expect(steps.every((s) => s.class === 'B' && s.min_role === 'any')).toBe(true);
    expect(steps[3].blocked_by).toEqual(['league', 'roster.1', 'phase.regular_season']);
    // Hashes bind each step to this admin, conversation and proposal.
    const ids = { adminId: ADMIN, conversationId: CONVERSATION_ID, proposalId: row.id };
    expect(steps.every((s) => stepHashMatches(s, ids))).toBe(true);
    expect(stepHashMatches(steps[0], { ...ids, proposalId: uid(1) })).toBe(false);
    expect(stepHashMatches({ ...steps[0], body_template: { name: 'Other' } }, ids)).toBe(false);
  });

  it('builds the card as structured data and nothing translated', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const card = proposalCardSchema.parse(h.store.proposals[0].preview);

    expect(card).toMatchObject({ v: 1, kind: 'build', class: 'B', tool: 'propose_build', summary: { steps: 4, creates: 3 }, outwardEffects: [], existingEntity: false });
    expect(card.plan).toMatchObject({ revision: 1, intent: 'league', contentLocale: 'de' });
    expect(card.steps.map((s) => [s.op, s.action, s.target.entity, s.target.name?.text ?? s.target.count])).toEqual([
      ['league_create', 'create', 'league', 'Gen 9 OU League'],
      ['roster_add', 'add', 'roster', 12],
      ['phase_create', 'create', 'phase', 'Regular season'],
      ['phase_create', 'create', 'phase', 'Playoffs'],
    ]);
    const kinds = (lines: Array<{ kind: string }>) => lines.map((l) => l.kind);
    // "visible on /leagues immediately", the creator is a site admin (no auto-grant), and Build starts nothing.
    expect(kinds(card.lines)).toEqual(['visible_publicly', 'will_not_start']);
    expect(card.acks).toEqual([{ id: 'visible_publicly', kind: 'checkbox' }]);
    expect(card.steps[0].lines).toEqual([{ kind: 'pins_ruleset', params: { ruleset: { text: 'gen9ou-custom', hidden: 0 }, version: 2 } }]);
    // The first phase enrolls the roster; the playoffs are created pre-filled from an all-tied table.
    expect(kinds(card.steps[2].lines)).toEqual(['pins_ruleset', 'enrolls_roster']);
    expect(card.steps[3].lines.find((l) => l.kind === 'prefilled_from_standings')).toEqual({
      kind: 'prefilled_from_standings',
      params: { phase: { text: 'Regular season', hidden: 0 }, count: 4, per_group: false },
    });
    expect(card.reversibility).toEqual({ kind: 'undoable' });
    // No translated prose anywhere: a card holds kinds, ids, counts and sanitised names.
    expect(JSON.stringify(card)).not.toMatch(/visible to everyone|will not start/i);
  });

  it('stores the fingerprint reads: real for what exists, null for what an earlier step creates', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const steps = storedStepSchema.array().parse(h.store.proposals[0].steps);
    expect(steps[0].preconditions.map((p) => [p.read, p.fingerprint === null])).toEqual([['league_name_recent', false]]);
    // The league does not exist yet: nothing to fingerprint, the earlier step is the evidence.
    for (const step of steps.slice(1)) {
      expect(step.preconditions.length).toBeGreaterThan(0);
      expect(step.preconditions.every((p) => p.fingerprint === null && p.target.kind === 'ref')).toBe(true);
    }
  });

  it('gives the approval token only as a hash, and never in the result', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    const result = staged(await h.stage('propose_build', { plan_revision: 1 }));
    const row = h.store.proposals[0];
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    const token = await h.stager.getApprovalToken(row.id, ADMIN);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain(token as string);
    expect(JSON.stringify(row.preview)).not.toContain(token as string);
    expect(JSON.stringify(row.steps)).not.toContain(token as string);
    expect(result).not.toHaveProperty('proposal_hash');
  });

  it('expires a Build after 60 minutes and a Go-live card after 15, bounded by the environment', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    const result = staged(await h.stage('propose_build', { plan_revision: 1 }));
    expect(new Date(result.expires_at).getTime() - new Date('2026-10-27T12:00:00.000Z').getTime()).toBe(60 * 60_000);

    const custom = makeHarness({ env: { ADMIN_AGENT_PROPOSAL_TTL_BUILD_MINUTES: '5' } });
    seeWorkedExample(custom);
    const short = staged(await custom.stage('propose_build', { plan_revision: 1 }));
    expect(new Date(short.expires_at).getTime() - new Date('2026-10-27T12:00:00.000Z').getTime()).toBe(5 * 60_000);
  });
});

describe('propose_build: refusals, each a catalogued code and nothing written', () => {
  it('has no plan, a moved revision, or a plan that is already built', async () => {
    const h = makeHarness();
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('plan_not_ready');
    seeWorkedExample(h);
    const stale = refused(await h.stage('propose_build', { plan_revision: 2 }));
    expect(stale).toMatchObject({ code: 'plan_stale', params: { revision: 1 } });
    h.store.setPlan(workedExample(), { status: 'built' });
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('plan_not_ready');
    expect(h.store.proposals).toHaveLength(0);
  });

  it('lists the readiness blockers when the Plan cannot be built yet', async () => {
    const h = makeHarness();
    const plan = workedExample();
    const entries = [...(plan.slots.roster?.entries ?? [])];
    entries[3] = { input: 'Mystery', state: 'unresolved' };
    h.store.setPlan(parseOrThrow({ ...plan, slots: { ...plan.slots, roster: { entries, target_count: 12 } } }));
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(result.code).toBe('plan_not_ready');
    expect(result.findings?.map((f) => f.code)).toContain('roster_unresolved');
    expect(h.store.proposals).toHaveLength(0);
  });

  it('refuses the double round robin of the headline example as an engine gap, not as a Build that plays one circle', async () => {
    const h = makeHarness();
    const plan = workedExample();
    h.store.setPlan(parseOrThrow({ ...plan, assumptions: [{ key: 'legs.regular_season', value: 2, source: 'admin', confirmed: true }] }));
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(result.code).toBe('plan_not_ready');
    expect(result.findings?.map((f) => f.code)).toEqual(['double_round_robin_unsupported']);
    expect(h.store.proposals).toHaveLength(0);
  });

  it('refuses an engine gap, an unpublished ruleset and a banned player from the live facts', async () => {
    const h = makeHarness({
      source: {
        facts: (plan) => okFacts(plan, { players: { [PLAYERS[0]]: { status: 'banned' }, [PLAYERS[1]]: { status: 'not_found' } }, rulesetVersions: { [RULESET_VERSION]: 'forbidden' } }),
      },
    });
    seeWorkedExample(h);
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    const codes = result.findings?.map((f) => f.code) ?? [];
    expect(codes).toEqual(expect.arrayContaining(['player_not_eligible', 'player_not_found', 'ruleset_forbidden']));
    expect(blockerCodes({ blockers: result.findings ?? [] })).toEqual(codes);
  });

  it('runs the shared ruleset check as a live guard: ruleset_not_found and ruleset_forbidden come back as themselves', async () => {
    const h = makeHarness({ refuseGuard: { rulesetUsable: forbidden('ruleset_forbidden') } });
    seeWorkedExample(h);
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('ruleset_forbidden');
    const gone = makeHarness({ refuseGuard: { rulesetUsable: forbidden('ruleset_not_found', 404) } });
    seeWorkedExample(gone);
    expect(refused(await gone.stage('propose_build', { plan_revision: 1 })).code).toBe('ruleset_not_found');
    expect(h.store.proposals).toHaveLength(0);
  });

  it('refuses a live guard failure for the admin (forbidden) before reading anything', async () => {
    const h = makeHarness({ refuseGuard: { any: forbidden('forbidden') } });
    seeWorkedExample(h);
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('forbidden');
  });

  it('refuses hidden characters, links and markdown in a league name with text_not_allowed', async () => {
    for (const name of ['Cup ‮gnirts', 'See https://evil.example', '[x](javascript:alert(1))']) {
      const h = makeHarness();
      const plan = workedExample();
      h.store.setPlan(parseOrThrow({ ...plan, slots: { ...plan.slots, league: { ...plan.slots.league!, name } } }));
      h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
      const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
      expect(result.code).toBe('text_not_allowed');
      expect(result.params).toMatchObject({ path: '/slots/league/name' });
    }
  });

  it('refuses an id the conversation has never seen (unknown_reference), and accepts it once seen', async () => {
    const h = makeHarness();
    h.store.setPlan(workedExample());
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS.slice(1)); // the first player was never read through a tool
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(result).toMatchObject({ code: 'unknown_reference', params: { count: 1, id: PLAYERS[0] } });
    expect(h.store.proposals).toHaveLength(0);
    h.store.see(CONVERSATION_ID, PLAYERS[0]);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
  });

  it('does not ask for provenance of the entities the Plan built itself (a fresh Build for the remainder)', async () => {
    const h = makeHarness({ source: { facts: (plan) => okFacts(plan, { refs: { league: 'live', roster: 'live' } }) } });
    const base = workedExample();
    const built = parsePlanDocument({
      ...base,
      refs: { league: { entity_type: 'season', entity_id: uid(8001) }, roster: { entity_type: 'season_roster', entity_id: uid(8001) } },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    h.store.setPlan(built.plan);
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const steps = storedStepSchema.array().parse(h.store.proposals[0].steps);
    // The league and roster exist: the remaining steps address the live league, and the first one carries real fingerprints.
    expect(steps.map((s) => s.key)).toEqual(['phase.regular_season', 'phase.playoffs']);
    expect(steps[0].path_params).toEqual({ id: uid(8001) });
    expect(h.guards).toContainEqual({ kind: 'season', id: uid(8001), versionId: undefined });
    expect(steps[0].preconditions.map((p) => [p.read, p.fingerprint === null])).toEqual([
      ['season_state', false],
      ['phase_stage_order', false],
    ]);
    // The second phase changes the same league as the first: its season reads are evaluated by the earlier step.
    expect(steps[1].preconditions.every((p) => p.fingerprint === null)).toBe(true);
  });

  it('fingerprints a later step\'s read of state that no earlier step changes (a phase added by someone else is seen)', async () => {
    const h = makeHarness({ source: { facts: (plan) => okFacts(plan, { refs: { league: 'live' } }) } });
    const built = parsePlanDocument({ ...workedExample(), refs: { league: { entity_type: 'season', entity_id: uid(8001) } } });
    if (!built.ok) throw new Error('fixture');
    h.store.setPlan(built.plan);
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const steps = storedStepSchema.array().parse(h.store.proposals[0].steps);
    expect(steps.map((s) => s.key)).toEqual(['roster.1', 'phase.regular_season', 'phase.playoffs']);
    expect(steps[0].preconditions.map((p) => [p.read, p.fingerprint === null])).toEqual([['roster_hash', false]]);
    // The roster step may move the season's status or dates, so the phase step defers that read to it ...
    // ... but no earlier step changes the phases, so their order is fingerprinted: a phase added meanwhile makes the step stale.
    expect(steps[1].preconditions.map((p) => [p.read, p.fingerprint === null])).toEqual([
      ['season_state', true],
      ['phase_stage_order', false],
    ]);
    expect(steps[2].preconditions.every((p) => p.fingerprint === null)).toBe(true);
  });

  it('refuses a phase name that the league built earlier already has (PHASE_NAME_TAKEN)', async () => {
    const h = makeHarness({ source: { phaseNames: ['  regular SEASON '], facts: (plan) => okFacts(plan, { refs: { league: 'live' } }) } });
    const built = parsePlanDocument({ ...workedExample(), refs: { league: { entity_type: 'season', entity_id: uid(8001) } } });
    if (!built.ok) throw new Error('fixture');
    h.store.setPlan(built.plan);
    h.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(result).toMatchObject({ code: 'PHASE_NAME_TAKEN', params: { name: 'Regular season' } });
  });

  it('refuses a Build with an op above the cap once approve runs, and still shows the card at phase 0', async () => {
    const withGroups = parsePlanDocument({ ...workedExample(), slots: { ...workedExample().slots, groups: { mode: 'serpentine', count: 2 } } });
    if (!withGroups.ok) throw new Error('fixture');
    const atPhase1 = makeHarness({ env: { ADMIN_AGENT_MAX_PHASE: '1' } });
    atPhase1.store.setPlan(withGroups.plan);
    atPhase1.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    expect(refused(await atPhase1.stage('propose_build', { plan_revision: 1 }))).toMatchObject({ code: 'phase_disabled', params: { op: 'groups_set' } });

    const atPhase2 = makeHarness({ env: { ADMIN_AGENT_MAX_PHASE: '2' } });
    atPhase2.store.setPlan(withGroups.plan);
    atPhase2.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    staged(await atPhase2.stage('propose_build', { plan_revision: 1 }));

    const atPhase0 = makeHarness({ env: { ADMIN_AGENT_MAX_PHASE: '0' } });
    atPhase0.store.setPlan(withGroups.plan);
    atPhase0.store.see(CONVERSATION_ID, RULESET_VERSION, ...PLAYERS);
    staged(await atPhase0.stage('propose_build', { plan_revision: 1 }));
  });

  it('refuses a Build over the configured size', async () => {
    const h = makeHarness({ env: { ADMIN_AGENT_MAX_BUILD_STEPS: '3' } });
    seeWorkedExample(h);
    const result = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(result.code).toBe('plan_not_ready');
    expect(result.findings?.[0]).toMatchObject({ code: 'build_too_large', params: { steps: 4 } });
  });
});

describe('propose_build: what the card says about rulesets and who creates', () => {
  it('says a private ruleset becomes publicly readable when a league pins it (plan 3.5 rule 7)', async () => {
    const h = makeHarness({ visibility: 'private' });
    seeWorkedExample(h);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const card = proposalCardSchema.parse(h.store.proposals[0].preview);
    expect(card.lines.find((l) => l.kind === 'publishes_ruleset_readable')).toEqual({
      kind: 'publishes_ruleset_readable',
      params: { ruleset: { text: 'gen9ou-custom', hidden: 0 }, version: 2 },
    });
    const gallery = makeHarness({ visibility: 'gallery' });
    seeWorkedExample(gallery);
    staged(await gallery.stage('propose_build', { plan_revision: 1 }));
    expect(proposalCardSchema.parse(gallery.store.proposals[0].preview).lines.map((l) => l.kind)).not.toContain('publishes_ruleset_readable');
  });

  it('tells a league admin that they become admin of what they create, and a site admin nothing', async () => {
    const scoped = makeHarness({ admin: { isSiteAdmin: false }, conversation: { tool_set: 'scoped' } });
    seeWorkedExample(scoped);
    staged(await scoped.stage('propose_build', { plan_revision: 1 }));
    expect(proposalCardSchema.parse(scoped.store.proposals[0].preview).lines.map((l) => l.kind)).toContain('creator_becomes_admin');
  });

  it('shows "pins Point Buy Battle vN" for an Evolution Point Buy league without a ruleset', async () => {
    const h = makeHarness({ source: { epbHead: { versionId: uid(9300), versionNo: 4, slug: 'point-buy-battle' }, facts: (plan) => okFacts(plan, { epbActiveListAvailable: true }) } });
    const base = workedExample();
    const epb = parsePlanDocument({
      ...base,
      slots: {
        ...base.slots,
        ruleset: { mode: 'auto_epb' },
        league: { ...base.slots.league!, format_type: 'evolution_point_buy' },
        phases: [base.slots.phases![0]],
      },
    });
    if (!epb.ok) throw new Error(JSON.stringify(epb.issues));
    h.store.setPlan(epb.plan);
    h.store.see(CONVERSATION_ID, ...PLAYERS);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    const card = proposalCardSchema.parse(h.store.proposals[0].preview);
    expect(card.steps[0].lines.map((l) => l.kind)).toEqual(expect.arrayContaining(['pins_ruleset_auto', 'ensures_battle_ruleset']));
    expect(card.steps[0].lines.find((l) => l.kind === 'pins_ruleset_auto')?.params).toEqual({ ruleset: { text: 'point-buy-battle', hidden: 0 }, version: 4 });
  });

  it('a hostile name on a card is shown plain with a hidden-character count', async () => {
    // A name that reached the Plan before the text rule (an imported league name) still renders safely.
    const h = makeHarness();
    seeWorkedExample(h);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    expect(proposalCardSchema.parse(h.store.proposals[0].preview).steps[0].target.name).toEqual({ text: 'Gen 9 OU League', hidden: 0 });
  });
});

describe('stageProposal: the tool, the audience and the limits', () => {
  it('refuses a tool that is not a staged B or G tool, or not offered to this conversation', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    for (const name of ['plan_set', 'league_get', 'delete_league', 'propose_nothing']) {
      expect(refused(await h.stage(name, {})).code).toBe('tool_not_available');
    }
    expect(h.store.proposals).toHaveLength(0);
  });

  it('refuses a tool of a phase above ADMIN_AGENT_MAX_PHASE and a Go-live card while the Go-live switch is off', async () => {
    const early = makeHarness({ env: { ADMIN_AGENT_MAX_PHASE: '0' } });
    expect(refused(await early.stage('propose_start_phase', { tournament_id: uid(710) })).code).toBe('phase_disabled');
    const off = makeHarness({ env: { ADMIN_AGENT_GOLIVE: '0' } });
    expect(refused(await off.stage('propose_start_phase', { tournament_id: uid(710) })).code).toBe('agent_golive_disabled');
  });

  it('refuses a site-only tool in a scoped conversation, and a conversation whose live tier no longer matches', async () => {
    const scoped = makeHarness({ conversation: { tool_set: 'scoped' }, admin: { isSiteAdmin: false } });
    expect(refused(await scoped.stage('propose_league_trash', { league_id: uid(720) })).code).toBe('tool_not_available');
    const downgraded = makeHarness({ admin: { isSiteAdmin: false } }); // a site conversation, but the live admin is no longer a site admin
    seeWorkedExample(downgraded);
    expect(refused(await downgraded.stage('propose_build', { plan_revision: 1 })).code).toBe('forbidden');
  });

  it('checks the arguments against the tool schema', async () => {
    const h = makeHarness();
    const result = refused(await h.stage('propose_build', { plan_revision: 'one', extra: true }));
    expect(result.code).toBe('validation_failed');
    expect(typeof result.params?.issues).toBe('string');
  });

  it('allows at most 2 pending proposals and supersedes the older card of the same Plan', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    const first = staged(await h.stage('propose_build', { plan_revision: 1 }));
    const second = staged(await h.stage('propose_build', { plan_revision: 1 }));
    expect(h.store.proposals.find((p) => p.id === first.proposal_id)?.status).toBe('superseded');
    expect(h.store.proposals.find((p) => p.id === second.proposal_id)?.status).toBe('proposed');
    // Fill the second pending slot with a different card, then a third is refused by the store.
    h.store.proposals.push({ ...h.store.proposals[1], id: uid(9999), supersede_key: 'other', status: 'proposed' });
    h.store.proposals[1].supersede_key = 'another';
    const third = refused(await h.stage('propose_build', { plan_revision: 1 }));
    expect(third).toMatchObject({ code: 'agent_cap_reached', params: { limit: 2 } });
  });

  it('stages at most 4 proposals in one assistant turn', async () => {
    const h = makeHarness({ env: { ADMIN_AGENT_MAX_STAGINGS_PER_TURN: '1' } });
    seeWorkedExample(h);
    staged(await h.stage('propose_build', { plan_revision: 1 }));
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('agent_cap_reached');
    // A refused attempt consumes nothing: a new turn starts clean.
    expect(h.turn.stagings).toBe(1);
  });

  it('stages nothing and writes no ref when a derived step cannot be fingerprinted (the app cannot say)', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    h.world.unavailable.add('league_name_recent');
    expect(refused(await h.stage('propose_build', { plan_revision: 1 })).code).toBe('tool_not_available');
    expect(h.store.proposals).toHaveLength(0);
    expect(h.store.recorded).toHaveLength(0);
  });

  it('records the proposal id as something this conversation has seen', async () => {
    const h = makeHarness();
    seeWorkedExample(h);
    const result = staged(await h.stage('propose_build', { plan_revision: 1 }));
    expect(h.store.recorded).toContainEqual({ kind: 'proposal', id: result.proposal_id });
    expect(h.guards.map((g) => g.kind)).toContain('any');
  });
});
