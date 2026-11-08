/**
 * The pure mappers of the live-format surfaces and the privacy contract they keep (docs/format-kit.md, "Live format routes"; `views.ts` header): a hidden side of a
 * relation is never serialised, a player sees only their own submission, items follow the resource's visibility, a secret
 * list never says what is taken, and no DTO carries a row id, a `source_ref`, a `target_player_id` or a `status` member.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '@/lib/format-kit/compile';
import { wichtelcup } from '@/lib/format-kit/presets/wichtelcup';
import type { FormatDefinition, RelationDef } from '@/lib/format-kit/types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { KitContext } from '../load';
import type { KitRuntimeState, RuntimeSubmission } from '../types';
import {
  allowedAdjustments,
  buildAdjustmentTargets,
  buildAdminOverview,
  buildPlayerView,
  buildUnmasked,
  giverHiddenActions,
  hiddenGiverActions,
  picksOf,
  refOf,
  ruleLabelsOf,
  toAdjustmentView,
  adjustmentMaskOf,
  toChallengeView,
  toCheckView,
  toSubmissionView,
  windowOf,
  type ChallengeRecordLike,
  type LadderInput,
} from '../views';
import type { PlayerFormatView } from '../view-types';
import { PLAYERS, SEED, giftDef, item, link, stateFor } from './helpers';

const NOW = new Date('2026-11-05T12:00:00Z');
const NAMES = new Map(PLAYERS.map((id) => [id, `Name ${id}`]));
const OPEN_FLAGS = { 'action:choose_gift': 'open', 'domain:pool': 'unlocked' } as const;

type DefPatch = (def: FormatDefinition) => FormatDefinition;

function withRelation(patch: Partial<RelationDef>): DefPatch {
  return (def) => ({ ...def, relations: (def.relations ?? []).map((r) => (r.key === 'santa' ? { ...r, ...patch } : r)) });
}
const withPicksVisibility = (visibility: 'own' | 'all'): DefPatch => (def) => ({
  ...def,
  resources: (def.resources ?? []).map((r) => (r.key === 'picks' ? { ...r, visibility } : r)),
});
const withPoolVisibility = (visibility: 'public' | 'when_unlocked' | 'admins'): DefPatch => (def) => ({
  ...def,
  domains: (def.domains ?? []).map((d) => (d.key === 'pool' ? { ...d, visibility } : d)),
});

function context(opts: { state?: Partial<KitRuntimeState>; defs?: DefPatch[]; players?: string[] } = {}): KitContext {
  const def = (opts.defs ?? []).reduce<FormatDefinition>((acc, patch) => patch(acc), giftDef());
  const state = stateFor(def, {
    flags: { ...OPEN_FLAGS },
    links: [link('p1', 'p2'), link('p2', 'p3'), link('p3', 'p1')],
    ...opts.state,
  });
  return {
    seasonId: 's-1',
    seed: SEED,
    revision: 1,
    def,
    state,
    tunableIssues: [],
    phases: [{ id: 'phase-1', stage: def.stages[0], members: opts.players ?? PLAYERS }],
  };
}

function running(view: PlayerFormatView) {
  if (!view.running) throw new Error('expected a running view');
  return view;
}

const viewOf = (viewer: string, ctx = context(), names = NAMES) => running(buildPlayerView(ctx, viewer, names, [], NOW));
const action = (view: ReturnType<typeof viewOf>) => view.actions.find((a) => a.id === 'choose_gift')!;

describe('refOf', () => {
  it('names a current participant and gives a former player a null name, never an empty string', () => {
    expect(refOf(NAMES, 'p1')).toEqual({ id: 'p1', name: 'Name p1' });
    expect(refOf(NAMES, 'gone')).toEqual({ id: 'gone', name: null });
  });
});

describe('the action card', () => {
  it('names the window, the label, the lock and the steps of an action the viewer can act on', () => {
    const card = action(viewOf('p1'));
    expect(card).toMatchObject({ id: 'choose_gift', window: 'open', lock: 'on_close', accessible: true, actionable: true, submission: null });
    expect(card.target).toEqual({ id: 'p2', name: 'Name p2' });
    expect(card.target_hidden).toBe(false);
    expect(card.steps).toHaveLength(1);
    expect(card.steps[0]).toMatchObject({ index: 0, resource: 'picks', domain: 'pool', count: 2, distinct_attr: 'role', unlocked: true });
  });

  it('reads the window like isActionWindowOpen: locked flag, open flag, or opens_on pending', () => {
    const rule = context().def.rules.find((r) => r.kind === 'player.action')!;
    if (rule.kind !== 'player.action') throw new Error('rule');
    expect(windowOf(rule, { flags: { 'action:choose_gift': 'locked' } })).toBe('locked');
    expect(windowOf(rule, { flags: { 'action:choose_gift': 'open' } })).toBe('open');
    expect(windowOf(rule, { flags: {} })).toBe('not_open_yet');
    expect(windowOf({ ...rule, window: {} }, { flags: {} })).toBe('open');
  });

  it('is not actionable when the window is closed or not open yet, and ships no entries then', () => {
    const locked = viewOf('p1', context({ state: { flags: { ...OPEN_FLAGS, 'action:choose_gift': 'locked' } } }));
    expect(action(locked)).toMatchObject({ window: 'locked', accessible: true, actionable: false });
    expect(locked.domains).toEqual([]);
    expect(action(locked).steps[0].blocked).toEqual([]);
    const pending = viewOf('p1', context({ state: { flags: { 'domain:pool': 'unlocked' } } }));
    expect(action(pending)).toMatchObject({ window: 'not_open_yet', actionable: false });
    expect(pending.domains).toEqual([]);
  });

  it('is not accessible for a player without a link, and not actionable', () => {
    const card = action(viewOf('p4'));
    expect(card).toMatchObject({ accessible: false, actionable: false, target: null, target_hidden: false });
  });

  it('is not accessible for a viewer who is not a current participant', () => {
    const names = new Map(NAMES);
    names.delete('p1');
    expect(action(viewOf('p1', context(), names))).toMatchObject({ accessible: false, actionable: false });
  });

  it('shows only the viewer’s own submission, and a locked one is not actionable', () => {
    const submissions: RuntimeSubmission[] = [
      { id: 'sub-1', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'submitted', picks: [{ step: 0, item_id: 'garchomp' }, { step: 0, item_id: 'blissey' }] },
      { id: 'sub-2', action: 'choose_gift', actor: 'p2', target: 'p3', status: 'locked', picks: [{ step: 0, item_id: 'secretmon' }] },
    ];
    const mine = viewOf('p1', context({ state: { submissions } }));
    expect(action(mine).submission).toEqual({ state: 'submitted', picks: [{ step: 0, item_id: 'garchomp' }, { step: 0, item_id: 'blissey' }] });
    expect(action(mine).actionable).toBe(true);
    expect(JSON.stringify(mine)).not.toContain('secretmon');
    const locked = viewOf('p2', context({ state: { submissions } }));
    expect(action(locked).submission?.state).toBe('locked');
    expect(action(locked).actionable).toBe(false);
  });
});

describe('hidden relation sides', () => {
  // santa: from hidden, to own. p1 gives to p2, p2 to p3, p3 to p1.
  it('lets the giver see the target and never anybody’s giver', () => {
    const view = viewOf('p1');
    const santa = view.relations.find((r) => r.key === 'santa')!;
    expect(santa.links).toEqual([{ from: { id: 'p1', name: 'Name p1' }, to: { id: 'p2', name: 'Name p2' }, revealed: false }]);
  });

  it('shows the receiver nothing: the giver is hidden, so the link does not even exist for them', () => {
    const santa = viewOf('p2').relations.find((r) => r.key === 'santa')!;
    expect(santa.links.every((l) => l.from?.id !== 'p1')).toBe(true);
    // p2 is a giver too (to p3), so they see their own outgoing link and nothing else.
    expect(santa.links).toEqual([{ from: { id: 'p2', name: 'Name p2' }, to: { id: 'p3', name: 'Name p3' }, revealed: false }]);
  });

  it('shows a third party nothing', () => {
    expect(viewOf('p4').relations.find((r) => r.key === 'santa')!.links).toEqual([]);
  });

  it('never puts the id of another player’s giver into the serialised view', () => {
    const ids = ['giver-aaaa-0001', 'giver-bbbb-0002', 'giver-cccc-0003', 'bystander-0004'];
    const names = new Map(ids.map((id) => [id, id.toUpperCase()]));
    const ctx = context({
      players: ids,
      state: { links: [link(ids[0], ids[1]), link(ids[1], ids[2]), link(ids[2], ids[0])] },
    });
    const json = JSON.stringify(buildPlayerView(ctx, ids[3], names, [], NOW));
    for (const id of ids.slice(0, 3)) expect(json).not.toContain(id);
    // The giver learns their own target and themselves, and not the third link.
    const asGiver = JSON.stringify(buildPlayerView(ctx, ids[0], names, [], NOW));
    expect(asGiver).toContain(ids[1]);
    expect(asGiver).not.toContain(ids[2]);
  });

  it('makes both sides public once the relation is revealed', () => {
    const revealed = context({ state: { links: [link('p1', 'p2', 'santa', true), link('p2', 'p3', 'santa', true), link('p3', 'p1', 'santa', true)] } });
    const santa = viewOf('p4', revealed).relations.find((r) => r.key === 'santa')!;
    expect(santa.links).toHaveLength(3);
    expect(santa.links.every((l) => l.revealed && l.from !== null && l.to !== null)).toBe(true);
  });

  it('carries no information in the order of the output (a viewer who sees the targets only)', () => {
    const open = withRelation({ visibility: { from: 'hidden', to: 'all' } });
    const links = [link('p1', 'p5'), link('p2', 'p3'), link('p3', 'p6'), link('p4', 'p1')];
    const forward = viewOf('p6', context({ defs: [open], state: { links } }));
    const reversed = viewOf('p6', context({ defs: [open], state: { links: [...links].reverse() } }));
    const santaOf = (v: ReturnType<typeof viewOf>) => v.relations.find((r) => r.key === 'santa')!.links;
    expect(santaOf(forward).every((l) => l.from === null)).toBe(true);
    expect(santaOf(forward)).toEqual(santaOf(reversed));
    const targets = santaOf(forward).map((l) => l.to?.id);
    expect(targets).toEqual([...targets].sort());
  });

  it('flags a target the viewer may not see, only for a viewer who has a link', () => {
    const hiddenTo = withRelation({ visibility: { from: 'hidden', to: 'hidden' } });
    const giver = action(viewOf('p1', context({ defs: [hiddenTo] })));
    expect(giver).toMatchObject({ target: null, target_hidden: true, accessible: true });
    const stranger = action(viewOf('p4', context({ defs: [hiddenTo] })));
    expect(stranger).toMatchObject({ target: null, target_hidden: false, accessible: false });
  });

  it('leaves the admin overview masked by default and unmasks only in buildUnmasked', () => {
    const ctx = context();
    const overview = buildAdminOverview(ctx, 'admin-1', NAMES, { openChallenges: 0 });
    const masked = overview.relations.find((r) => r.key === 'santa')!;
    expect(masked).toMatchObject({ masked: true, link_count: 3, links: [] });
    // An admin who also plays sees what a player sees and nothing more.
    const playing = buildAdminOverview(ctx, 'p1', NAMES, { openChallenges: 0 }).relations[0];
    expect(playing.links).toEqual([{ from: { id: 'p1', name: 'Name p1' }, to: { id: 'p2', name: 'Name p2' }, revealed: false }]);

    const unmasked = buildUnmasked(ctx, 'admin-1', NAMES);
    const santa = unmasked.relations.find((r) => r.key === 'santa')!;
    expect(santa).toMatchObject({ masked: false, link_count: 3 });
    expect(santa.links).toHaveLength(3);
    expect(santa.links.every((l) => l.from !== null && l.to !== null)).toBe(true);
  });
});

describe('domain entries', () => {
  it('ships each domain once, with the entries a viewer may see, for an actionable step', () => {
    const view = viewOf('p1');
    expect(view.domains).toHaveLength(1);
    expect(view.domains[0].key).toBe('pool');
    expect(view.domains[0].entries.map((e) => e.id)).toEqual(['garchomp', 'blissey', 'corviknight']);
    expect(view.domains[0].entries[0].attrs).toEqual(
      expect.arrayContaining([{ key: 'role', value: 'attacker' }, { key: 'tags', value: ['fast', 'bulky'] }, { key: 'bonus', value: 2 }]),
    );
  });

  it('ships no entries of a domain only admins see', () => {
    const view = viewOf('p1', context({ defs: [withPoolVisibility('admins')] }));
    expect(view.domains).toEqual([]);
    expect(action(view).steps[0].blocked).toEqual([]);
  });

  it('ships no entries of a when_unlocked domain while it is locked', () => {
    const view = viewOf('p1', context({ state: { flags: { 'action:choose_gift': 'open' } } }));
    expect(view.domains).toEqual([]);
    expect(action(view).steps[0]).toMatchObject({ unlocked: false, blocked: [] });
  });

  it('ships the entries of a public domain even while it is locked, only for an actionable action', () => {
    const publicDomain = withPoolVisibility('public');
    const locked = viewOf('p1', context({ defs: [publicDomain], state: { flags: { 'action:choose_gift': 'locked' } } }));
    expect(locked.domains).toEqual([]);
  });
});

describe('blocked entries', () => {
  it('marks an entry the step’s where refuses as not_eligible', () => {
    const ctx = context({
      state: { amendments: [{ domain: 'pool', add: [{ id: 'magikarp', attrs: [{ key: 'role', value: 'tank' }, { key: 'bonus', value: 0 }] }] }] },
    });
    expect(action(viewOf('p1', ctx)).steps[0].blocked).toEqual([{ id: 'magikarp', reason: 'not_eligible' }]);
  });

  it('marks an item somebody else holds as taken for a globally exclusive resource of any visibility, never saying by whom', () => {
    const items = [item({ resource: 'picks', player_id: 'p5', item_id: 'blissey', exclusive: true })];
    const open = viewOf('p1', context({ defs: [withPicksVisibility('all')], state: { items } }));
    expect(action(open).steps[0].blocked).toEqual([{ id: 'blissey', reason: 'taken' }]);
    const secret = viewOf('p1', context({ state: { items } }));
    expect(action(secret).steps[0].blocked).toEqual([{ id: 'blissey', reason: 'taken' }]);
    // The flag is holder-free: neither the holder nor a row member appears for a secret resource.
    expect(JSON.stringify(secret)).not.toContain('p5');
    expect(secret.items).toEqual([]);
  });

  it('marks nothing taken on a pool the viewer may not see (an admins domain)', () => {
    const items = [item({ resource: 'picks', player_id: 'p5', item_id: 'blissey', exclusive: true })];
    const view = viewOf('p1', context({ defs: [withPoolVisibility('admins')], state: { items } }));
    expect(action(view).steps[0].blocked).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('blissey');
  });

  it('marks nothing taken for a resource that is not globally exclusive', () => {
    const items = [item({ resource: 'picks', player_id: 'p5', item_id: 'blissey', exclusive: false })];
    const view = viewOf('p1', context({ defs: [(def) => ({ ...def, resources: (def.resources ?? []).map((r) => (r.key === 'picks' ? { ...r, exclusive: 'none' as const } : r)) })], state: { items } }));
    expect(action(view).steps[0].blocked).toEqual([]);
  });

  it('does not mark the viewer’s own current pick as taken', () => {
    const items = [item({ resource: 'picks', player_id: 'p2', item_id: 'garchomp', exclusive: true, source: 'action', source_ref: 'sub-1' })];
    const submissions: RuntimeSubmission[] = [{ id: 'sub-1', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'submitted', picks: [{ step: 0, item_id: 'garchomp' }] }];
    const mine = viewOf('p1', context({ defs: [withPicksVisibility('all')], state: { items, submissions } }));
    expect(action(mine).steps[0].blocked).toEqual([]);
    // Another player sees it as taken.
    const other = viewOf('p3', context({ defs: [withPicksVisibility('all')], state: { items, submissions, links: [link('p3', 'p1')] } }));
    expect(action(other).steps[0].blocked).toEqual([{ id: 'garchomp', reason: 'taken' }]);
  });
});

describe('items', () => {
  const items = [
    item({ resource: 'coins', player_id: 'p1', amount: 3 }),
    item({ resource: 'coins', player_id: 'p2', amount: 2 }),
    item({ resource: 'picks', player_id: 'p1', item_id: 'garchomp', exclusive: true, source: 'action', source_ref: 'sub-x' }),
    item({ resource: 'picks', player_id: 'p2', item_id: 'blissey', exclusive: true, source: 'action', source_ref: 'sub-y' }),
  ];

  it('shows the viewer’s own items, and other players’ only for a resource with visibility all', () => {
    const view = viewOf('p1', context({ state: { items } }));
    expect(view.items).toEqual([
      expect.objectContaining({ resource: 'coins', amount: 3, holder: null }),
      expect.objectContaining({ resource: 'coins', amount: 2, holder: { id: 'p2', name: 'Name p2' } }),
      expect.objectContaining({ resource: 'picks', item_id: 'garchomp', amount: 1, holder: null }),
    ]);
  });

  it('never carries the source, the source_ref or a row id of an item', () => {
    const json = JSON.stringify(viewOf('p1', context({ state: { items } })));
    expect(json).not.toContain('"source"');
    expect(json).not.toContain('"source_ref"');
    expect(json).not.toContain('sub-x');
    expect(json).not.toContain('"id":"i-');
  });

  it('merges rows of one holder and item', () => {
    const twice = [item({ resource: 'coins', player_id: 'p1', amount: 1 }), item({ resource: 'coins', player_id: 'p1', amount: 4 })];
    expect(viewOf('p1', context({ state: { items: twice } })).items).toEqual([expect.objectContaining({ amount: 5, holder: null })]);
  });

  it('names a holder who left as a former player', () => {
    const names = new Map(NAMES);
    names.delete('p2');
    const view = viewOf('p1', context({ state: { items } }), names);
    expect(view.items.find((i) => i.holder?.id === 'p2')?.holder).toEqual({ id: 'p2', name: null });
  });
});

describe('players who left', () => {
  it('gives a link partner without a public name a null name, never an empty string', () => {
    const names = new Map(NAMES);
    names.delete('p2');
    const view = viewOf('p1', context(), names);
    expect(action(view).target).toEqual({ id: 'p2', name: null });
    expect(JSON.stringify(view)).not.toContain('""');
  });

  it('counts only current participants who can act in the admin overview', () => {
    const names = new Map(NAMES);
    names.delete('p3');
    const submissions: RuntimeSubmission[] = [
      { id: 'a', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'submitted', picks: [] },
      { id: 'b', action: 'choose_gift', actor: 'p3', target: 'p1', status: 'locked', picks: [] },
    ];
    const overview = buildAdminOverview(context({ state: { submissions } }), 'admin-1', names, { openChallenges: 0 });
    const card = overview.actions[0];
    // Actors: the givers p1 and p2 (p3 left). p3's locked row is not counted.
    expect(card).toMatchObject({ id: 'choose_gift', actors: 2, counts: { missing: 1, draft: 0, submitted: 1, locked: 0 } });
  });
});

describe('the challenge ladder', () => {
  const ladderContext = (): KitContext => {
    const base = context();
    const stage = { ...base.def.stages[0], pairing: { kind: 'challenge', rounds: 8, rank_range: 3, max_open: 2, cooldown_rounds: 1, accept_window_hours: 72 } } as const;
    return { ...base, phases: [{ id: 'phase-1', stage: stage as unknown as KitContext['phases'][number]['stage'], members: PLAYERS }] };
  };
  const row = (over: Partial<ChallengeRecordLike> = {}): ChallengeRecordLike => ({
    id: 'c-1',
    phase_id: 'phase-1',
    challenger_id: 'p2',
    defender_id: 'p1',
    status: 'open',
    round: 2,
    created_at: '2026-11-05T10:00:00Z',
    expires_at: '2026-11-06T10:00:00Z',
    responded_at: null,
    match_id: null,
    ...over,
  });
  const input = (over: Partial<LadderInput> = {}): LadderInput => ({
    phaseId: 'phase-1',
    table: [{ player_id: 'p2', rank: 2 }, { player_id: 'p1', rank: 1 }, { player_id: 'p3', rank: 3 }],
    round: 2,
    targets: ['p1'],
    challenges: [row()],
    ...over,
  });

  it('builds the ranked table, the viewer’s rank, the targets and the viewer’s own challenges', () => {
    const view = running(buildPlayerView(ladderContext(), 'p2', NAMES, [input()], NOW));
    expect(view.ladders).toHaveLength(1);
    const ladder = view.ladders[0];
    expect(ladder).toMatchObject({ phase_id: 'phase-1', stage_key: 'main', round: 2, my_rank: 2, targets: ['p1'] });
    expect(ladder.config).toEqual({ rank_range: 3, max_open: 2, cooldown_rounds: 1, accept_window_hours: 72 });
    expect(ladder.table.map((r) => r.player.id)).toEqual(['p1', 'p2', 'p3']);
    expect(ladder.challenges).toEqual([
      expect.objectContaining({ id: 'c-1', state: 'open', lapsed: false, challenger: { id: 'p2', name: 'Name p2' }, defender: { id: 'p1', name: 'Name p1' } }),
    ]);
  });

  it('drops a challenge in which the viewer is not a party', () => {
    const view = running(buildPlayerView(ladderContext(), 'p4', NAMES, [input()], NOW));
    expect(view.ladders[0].challenges).toEqual([]);
    expect(view.ladders[0].my_rank).toBeNull();
  });

  it('marks an open challenge past its accept window as lapsed, and only that one', () => {
    const late = new Date('2026-11-06T10:00:01Z');
    expect(toChallengeView(row(), NAMES, late)).toMatchObject({ state: 'open', lapsed: true });
    expect(toChallengeView(row({ status: 'accepted', match_id: 'm-1' }), NAMES, late)).toMatchObject({ state: 'accepted', lapsed: false, match_id: 'm-1' });
    expect(toChallengeView(row(), NAMES, NOW).lapsed).toBe(false);
  });

  it('ignores an input for a phase that is not a challenge ladder', () => {
    const view = running(buildPlayerView(context(), 'p1', NAMES, [input()], NOW));
    expect(view.ladders).toEqual([]);
  });

  it('has no status member anywhere in the serialised challenge', () => {
    const view = running(buildPlayerView(ladderContext(), 'p2', NAMES, [input()], NOW));
    expect(JSON.stringify(view)).not.toContain('"status"');
  });
});

describe('private data', () => {
  it('never serialises a status, source_ref, target_player_id or row id key of the runtime rows', () => {
    const submissions: RuntimeSubmission[] = [{ id: 'sub-1', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'submitted', picks: [{ step: 0, item_id: 'garchomp' }] }];
    const items = [item({ resource: 'picks', player_id: 'p1', item_id: 'garchomp', exclusive: true, source: 'action', source_ref: 'sub-1' })];
    const ctx = context({ state: { submissions, items } });
    const everything = {
      player: buildPlayerView(ctx, 'p1', NAMES, [], NOW),
      admin: buildAdminOverview(ctx, 'admin-1', NAMES, { openChallenges: 1 }),
      unmasked: buildUnmasked(ctx, 'admin-1', NAMES),
      targets: buildAdjustmentTargets(ctx, NAMES),
    };
    expectNoPrivatePlayerData(everything);
    const json = JSON.stringify(everything);
    for (const forbidden of ['source_ref', 'target_player_id', 'actor_player_id', 'season_id', '"source"', 'sub-1']) expect(json).not.toContain(forbidden);
  });
});

describe('admin builders', () => {
  const ctx = context({
    state: {
      submissions: [
        { id: 'a', action: 'choose_gift', actor: 'p1', target: 'p2', status: 'draft', picks: [{ step: 0, item_id: 'garchomp' }] },
        { id: 'b', action: 'choose_gift', actor: 'p2', target: 'p3', status: 'locked', picks: [{ step: 0, item_id: 'blissey' }] },
      ],
      checks: [
        { id: 'k1', source: 'standings_tie', rule_id: 'ties', dedupe_key: 'd1', subject: {}, status: 'open', note: null },
        { id: 'k2', source: 'standings_tie', rule_id: 'ties', dedupe_key: 'd2', subject: {}, status: 'confirmed', note: null },
      ],
    },
  });

  it('counts the open checks, passes the open challenges and lists the domains', () => {
    const overview = buildAdminOverview(ctx, 'admin-1', NAMES, { openChallenges: 4 });
    expect(overview).toMatchObject({ running: true, open_checks: 1, open_challenges: 4 });
    expect(overview.domains).toEqual([expect.objectContaining({ key: 'pool', visibility: 'when_unlocked', unlocked: true, entry_count: 3 })]);
    expect(overview.actions[0]).toMatchObject({ actors: 3, counts: { missing: 1, draft: 1, submitted: 0, locked: 1 } });
    expect(overview.allowed_adjustments).toEqual(['points', 'resource', 'relation', 'action', 'domain', 'rank']);
  });

  it('lists the states and targets per action after the unmask, and no picks', () => {
    const unmasked = buildUnmasked(ctx, 'admin-1', NAMES);
    expect(unmasked.submissions).toEqual([
      {
        action: 'choose_gift',
        rows: [
          { player: { id: 'p1', name: 'Name p1' }, state: 'draft', target: { id: 'p2', name: 'Name p2' } },
          { player: { id: 'p2', name: 'Name p2' }, state: 'locked', target: { id: 'p3', name: 'Name p3' } },
        ],
      },
    ]);
    const json = JSON.stringify(unmasked);
    expect(json).not.toContain('picks');
    expect(json).not.toContain('garchomp');
  });

  it('offers the form targets: stage rosters, players, the entries a resource holds, relations and actions', () => {
    const targets = buildAdjustmentTargets(ctx, NAMES);
    expect(targets.stages).toEqual([expect.objectContaining({ key: 'main', players: PLAYERS.map((id) => ({ id, name: `Name ${id}` })) })]);
    expect(targets.players).toHaveLength(PLAYERS.length);
    expect(targets.resources.find((r) => r.key === 'picks')).toMatchObject({ holds_domain: 'pool', exclusive: true, items: ['garchomp', 'blissey', 'corviknight'] });
    expect(targets.resources.find((r) => r.key === 'coins')).toMatchObject({ holds_domain: null, exclusive: false, items: [] });
    expect(targets.relations).toEqual([expect.objectContaining({ key: 'santa', has_links: true })]);
    expect(targets.actions).toEqual([expect.objectContaining({ id: 'choose_gift' })]);
  });

  it('offers only the kinds an adjust.manual rule allows that the route accepts (never outcome)', () => {
    expect(allowedAdjustments(ctx.def)).toEqual(['points', 'resource', 'relation', 'action', 'domain', 'rank']);
    expect(allowedAdjustments({ rules: [] })).toEqual([]);
    expect(allowedAdjustments({ rules: [{ kind: 'adjust.manual', id: 'a', allow: ['outcome', 'points'] }] })).toEqual(['points']);
  });
});

describe('rows of the history', () => {
  it('maps a submission without its row id or target, and drops anything that is not a pick', () => {
    expect(toSubmissionView({ status: 'submitted', picks: [{ step: 0, item_id: 'a' }, { step: 'x' }, null, 4] })).toEqual({
      state: 'submitted',
      picks: [{ step: 0, item_id: 'a' }],
    });
    expect(toSubmissionView({ status: 'weird', picks: 'nope' })).toEqual({ state: 'draft', picks: [] });
    expect(picksOf(undefined)).toEqual([]);
  });

  it('maps a check with its rule label and the admin who resolved it', () => {
    const labels = ruleLabelsOf(context().def);
    const view = toCheckView(
      { id: 'k', source: 'standings_tie', rule_id: 'ties', subject: { a: 1 }, status: 'confirmed', note: 'ok', opened_at: 't1', resolved_at: 't2', resolved_by: 'p1' },
      labels,
      NAMES,
    );
    expect(view).toMatchObject({ id: 'k', state: 'confirmed', note: 'ok', rule_label: expect.objectContaining({ base: 'en' }), resolved_by: { id: 'p1', name: 'Name p1' } });
    expect(JSON.stringify(view)).not.toContain('"status"');
    expect(toCheckView({ id: 'k', source: 'brand_new_source', rule_id: 'unknown', subject: {}, status: 'open', note: null, opened_at: 't', resolved_at: null, resolved_by: null }, labels, NAMES)).toMatchObject({
      source: 'brand_new_source',
      rule_label: null,
      resolved_by: null,
    });
  });

  describe('the waiting giver of a hidden relation', () => {
    const missed = (over: Record<string, unknown> = {}) => ({
      id: 'k',
      source: 'deadline_missed',
      rule_id: 'deadline:swiss:0',
      subject: { stage: 'swiss', applies: 'action', on_miss: 'admin_review', action: 'choose_gift', player_id: 'p2', reason: 'admin_review', ...over },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    });

    it('is hidden from an admin who plays, for the actions that run through the relation', () => {
      expect([...giverHiddenActions(context(), 'p1')]).toEqual(['choose_gift']);
      // An admin who does not play is no recipient.
      expect(giverHiddenActions(context(), 'admin-1').size).toBe(0);
    });

    it('stays hidden for a reader who was removed from every phase but still holds a link', () => {
      // The links outlive the roster entry: removing a player from the phase deletes only the participant row.
      const removed = context({ players: ['p2', 'p3'] });
      expect([...giverHiddenActions(removed, 'p1')]).toEqual(['choose_gift']);
      // A reader with neither a phase nor a link is still no recipient.
      expect(giverHiddenActions(removed, 'admin-1').size).toBe(0);
    });

    it('depends on the relation alone for the writers of the audit log (a giver who is in no phase included)', () => {
      expect([...hiddenGiverActions(context({ players: ['p2', 'p3'] }))]).toEqual(['choose_gift']);
      const revealed = context({ state: { links: [link('p1', 'p2', 'santa', true), link('p2', 'p1', 'santa', true)] } });
      expect(hiddenGiverActions(revealed).size).toBe(0);
      expect(hiddenGiverActions(context({ defs: [withRelation({ visibility: { from: 'own', to: 'own' } })] })).size).toBe(0);
    });

    it('is not hidden once every link is revealed, or when the format shows the source side', () => {
      const revealed = context({ state: { links: [link('p1', 'p2', 'santa', true), link('p2', 'p1', 'santa', true)] } });
      expect(giverHiddenActions(revealed, 'p1').size).toBe(0);
      const partly = context({ state: { links: [link('p1', 'p2', 'santa', true), link('p2', 'p1')] } });
      expect(giverHiddenActions(partly, 'p1').size).toBe(1);
      expect(giverHiddenActions(context({ defs: [withRelation({ visibility: { from: 'own', to: 'own' } })] }), 'p1').size).toBe(0);
    });

    it('drops the player of a deadline_missed action check for a viewer who plays, keeping the rest', () => {
      const hidden = giverHiddenActions(context(), 'p1');
      const view = toCheckView(missed(), new Map(), NAMES, hidden);
      expect(view.subject).toEqual({ stage: 'swiss', applies: 'action', on_miss: 'admin_review', action: 'choose_gift', reason: 'admin_review', giver_masked: true });
      expect(JSON.stringify(view)).not.toContain('p2');
      expect(JSON.stringify(toCheckView(missed({ player_id: undefined, players: ['p2', 'p3'] }), new Map(), NAMES, hidden))).not.toMatch(/p2|p3/);
    });

    it('leaves other checks, other actions and a viewer who does not play untouched', () => {
      const hidden = giverHiddenActions(context(), 'p1');
      expect(toCheckView(missed({ action: 'other' }), new Map(), NAMES, hidden).subject).toMatchObject({ player_id: 'p2' });
      expect(toCheckView({ ...missed(), source: 'standings_tie' }, new Map(), NAMES, hidden).subject).toMatchObject({ player_id: 'p2' });
      expect(toCheckView(missed(), new Map(), NAMES, giverHiddenActions(context(), 'admin-1')).subject).toMatchObject({ player_id: 'p2' });
      expect(toCheckView(missed(), new Map(), NAMES).subject).toMatchObject({ player_id: 'p2' });
    });
  });

  describe('the planned team behind a team_audit check', () => {
    const audit = (over: Record<string, unknown> = {}) => ({
      id: 'k',
      source: 'team_audit',
      rule_id: 'team.audit',
      subject: {
        stage: 'main',
        match_id: 'm-1',
        round: 2,
        player_id: 'p2',
        team_id: 'team-9',
        team_source: 'planned',
        reasons: ['rules', 'observed_mismatch'],
        issues: [{ code: 'kit_not_allowed', params: { species: 'Mewtwo', max: 2 }, pokemon_indexes: [3] }],
        off_team: ['Dragonite', 'Snorlax'],
        cause: null,
        ...over,
      },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    });

    it('is redacted for a league admin who is not a site admin: no species, no team id, the counts stay', () => {
      for (const viewer of [{}, { id: 'admin-1' }, { id: 'admin-1', siteAdmin: false }]) {
        const view = toCheckView(audit(), new Map(), NAMES, undefined, viewer);
        expect(view.subject).toMatchObject({
          match_id: 'm-1',
          player_id: 'p2',
          team_id: null,
          team_source: 'planned',
          reasons: ['rules', 'observed_mismatch'],
          issues: [{ code: 'kit_not_allowed', params: {}, pokemon_indexes: [3] }],
          off_team: [],
          off_team_count: 2,
          team_hidden: true,
        });
        expect(JSON.stringify(view)).not.toMatch(/Mewtwo|Dragonite|Snorlax|team-9/);
      }
    });

    it('is shown to a site admin and to the player the team belongs to', () => {
      expect(toCheckView(audit(), new Map(), NAMES, undefined, { id: 'admin-1', siteAdmin: true }).subject).toMatchObject({ team_id: 'team-9', off_team: ['Dragonite', 'Snorlax'] });
      expect(toCheckView(audit(), new Map(), NAMES, undefined, { id: 'p2' }).subject).toMatchObject({ team_id: 'team-9' });
    });

    it('leaves a match-linked team and a side without a team alone, for every viewer', () => {
      expect(toCheckView(audit({ team_source: 'match' }), new Map(), NAMES).subject).toMatchObject({ team_id: 'team-9', off_team: ['Dragonite', 'Snorlax'] });
      expect(toCheckView(audit({ team_source: 'none', team_id: null, issues: [], off_team: [] }), new Map(), NAMES).subject).toMatchObject({ team_source: 'none' });
    });

    it('redacts a match-linked team once its check is closed: a reset match unlinks the team and closes the check without touching its subject', () => {
      for (const status of ['rejected', 'confirmed']) {
        const view = toCheckView({ ...audit({ team_source: 'match' }), status }, new Map(), NAMES, undefined, { id: 'admin-1' });
        expect(view.subject).toMatchObject({ team_id: null, off_team: [], off_team_count: 2, team_hidden: true });
        expect(JSON.stringify(view)).not.toMatch(/Mewtwo|Dragonite|Snorlax|team-9/);
      }
      // A site admin and the owner of the team still read it.
      expect(toCheckView({ ...audit({ team_source: 'match' }), status: 'rejected' }, new Map(), NAMES, undefined, { id: 'a', siteAdmin: true }).subject).toMatchObject({ team_id: 'team-9' });
      expect(toCheckView({ ...audit({ team_source: 'match' }), status: 'rejected' }, new Map(), NAMES, undefined, { id: 'p2' }).subject).toMatchObject({ team_id: 'team-9' });
    });

    it('survives a subject of an unexpected shape', () => {
      expect(toCheckView(audit({ issues: 'nope', off_team: 7 }), new Map(), NAMES).subject).toMatchObject({ issues: [], off_team: [], off_team_count: 0, team_hidden: true });
      expect(toCheckView({ ...audit(), subject: 'text' }, new Map(), NAMES).subject).toBe('text');
    });
  });

  it('reduces the links of a relation adjustment to a count, so no hidden pair is copied', () => {
    const view = toAdjustmentView(
      { id: 'a', kind: 'relation', target: { relation: 'santa' }, delta: { reveal: true, links: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p1' }] }, reason: 'fix', admin_id: 'p1', created_at: 't' },
      NAMES,
    );
    expect(view.delta).toEqual({ reveal: true, link_count: 2 });
    expect(view.admin).toEqual({ id: 'p1', name: 'Name p1' });
    expect(JSON.stringify(view)).not.toContain('"to"');
  });

  describe('the holdings a resource adjustment names', () => {
    const grant = (resource: string, playerId = 'p2') => ({
      id: 'a',
      kind: 'resource',
      target: { resource, player_id: playerId, item_id: 'rare_candy' },
      delta: { amount: 1 },
      reason: 'the organizer re-grants a gift',
      admin_id: 'p1',
      created_at: 't',
    });
    const withResources = (visibility: 'own' | 'all') => {
      const ctx = context();
      return { ...ctx, def: { ...ctx.def, resources: [{ key: 'premium_gift', visibility }, { key: 'open_gift', visibility: 'all' }] } } as unknown as KitContext;
    };

    it('shows the kind and the reason only to a co-admin who plays, for a resource that is not visible to all', () => {
      const mask = adjustmentMaskOf(withResources('own'), 'p1');
      const view = toAdjustmentView(grant('premium_gift'), NAMES, mask);
      expect(view).toMatchObject({ kind: 'resource', target: {}, delta: {}, reason: 'the organizer re-grants a gift' });
      expect(JSON.stringify(view)).not.toContain('rare_candy');
      expect(JSON.stringify(view)).not.toContain('p2');
    });

    it('hides a resource the format no longer defines, and a malformed target is left as it is', () => {
      const mask = adjustmentMaskOf(withResources('own'), 'p1');
      expect(toAdjustmentView(grant('gone'), NAMES, mask).target).toEqual({});
      expect(toAdjustmentView({ ...grant('premium_gift'), target: 'text' }, NAMES, mask).target).toBe('text');
    });

    it('shows everything to the player it is about, for a resource visible to all, to an admin who does not play and without a mask', () => {
      const mask = adjustmentMaskOf(withResources('own'), 'p1');
      expect(toAdjustmentView(grant('premium_gift', 'p1'), NAMES, mask).target).toMatchObject({ item_id: 'rare_candy' });
      expect(toAdjustmentView(grant('open_gift'), NAMES, mask).target).toMatchObject({ item_id: 'rare_candy' });
      expect(adjustmentMaskOf(withResources('own'), 'admin-not-playing')).toBeUndefined();
      // Removed from every phase but still linked: still a possible recipient, so still masked.
      const removed = { ...withResources('own'), phases: [{ id: 'phase-1', members: ['p2', 'p3'] }] } as unknown as KitContext;
      expect(adjustmentMaskOf(removed, 'p1')).toBeDefined();
      expect(adjustmentMaskOf(removed, 'admin-not-playing')).toBeUndefined();
      expect(adjustmentMaskOf(null, 'p1')).toBeUndefined();
      expect(toAdjustmentView(grant('premium_gift'), NAMES, undefined).target).toMatchObject({ item_id: 'rare_candy' });
    });

    it('leaves the other kinds alone', () => {
      const mask = adjustmentMaskOf(withResources('own'), 'p1');
      const points = { id: 'a', kind: 'points', target: { stage: 'main', player_id: 'p2' }, delta: { points: 2 }, reason: 'r', admin_id: null, created_at: 't' };
      expect(toAdjustmentView(points, NAMES, mask)).toMatchObject({ target: { stage: 'main', player_id: 'p2' }, delta: { points: 2 } });
    });
  });

  it('keeps the delta of the other kinds and a null admin', () => {
    const view = toAdjustmentView({ id: 'a', kind: 'points', target: { stage: 'main', player_id: 'p1' }, delta: { points: 2 }, reason: 'r', admin_id: null, created_at: 't' }, NAMES);
    expect(view).toMatchObject({ kind: 'points', delta: { points: 2 }, admin: null });
  });
});

// The leak contract (docs/format-kit.md, "Live format routes") on the shipped Wichtelcup document, not on the gift-exchange fixture. The
// document's own keys (santa, choose_gifts, junk_gifts, premium_gift) and its deadline policy go through the mappers.
describe('the shipped Wichtelcup document keeps the leak contract', () => {
  const compiled = compile(wichtelcup);
  if (compiled.definition === null) throw new Error('the Wichtelcup example does not compile');
  const DEF = compiled.definition as FormatDefinition;
  const GIVERS = ['giver-aaaa-0001', 'giver-bbbb-0002', 'giver-cccc-0003', 'giver-dddd-0004'];
  const [g1, g2, g3, g4] = GIVERS;
  const WNAMES = new Map([...GIVERS, 'admin-0005'].map((id) => [id, id.toUpperCase()]));
  const RING = [link(g1, g2), link(g2, g3), link(g3, g4), link(g4, g1)];

  function wichtelContext(patch: Partial<KitRuntimeState> = {}, players: string[] = GIVERS): KitContext {
    const state = stateFor(DEF, { flags: { 'action:choose_gifts': 'open' }, links: RING, ...patch });
    return { seasonId: 's-1', seed: SEED, revision: 1, def: DEF, state, tunableIssues: [], phases: [{ id: 'cup', stage: DEF.stages[0], members: players }] };
  }
  const player = (viewer: string, ctx: KitContext) => running(buildPlayerView(ctx, viewer, WNAMES, [], NOW));
  const cardOf = (view: ReturnType<typeof player>) => view.actions.find((a) => a.id === 'choose_gifts')!;
  const ref = (id: string) => ({ id, name: id.toUpperCase() });

  it('gives a giver their recipient and nobody else, and the receiver no giver before the week 4 reveal', () => {
    const ctx = wichtelContext();
    const giver = player(g1, ctx);
    expect(cardOf(giver)).toMatchObject({ accessible: true, actionable: true, target: ref(g2) });
    expect(giver.relations.find((r) => r.key === 'santa')!.links).toEqual([{ from: ref(g1), to: ref(g2), revealed: false }]);
    for (const id of [g3, g4]) expect(JSON.stringify(giver)).not.toContain(id);
    // g2 receives from g1 and gives to g3: the view names g3 and never g1.
    const receiver = JSON.stringify(player(g2, ctx));
    expect(receiver).toContain(g3);
    expect(receiver).not.toContain(g1);
    expect(receiver).not.toContain(g4);
  });

  it('lists the junk and the premium pool without saying which premium gift a giver holds or took', () => {
    const items = [
      item({ resource: 'premium_gift', player_id: g3, item_id: 'glastrier', exclusive: true, source: 'action', source_ref: 'sub-1' }),
      item({ resource: 'junk_gifts', player_id: g3, item_id: 'bergmite', source: 'action', source_ref: 'sub-1' }),
    ];
    const submissions: RuntimeSubmission[] = [
      { id: 'sub-1', action: 'choose_gifts', actor: g2, target: g3, status: 'submitted', picks: [{ step: 1, item_id: 'glastrier' }] },
    ];
    const view = player(g1, wichtelContext({ items, submissions }));
    const card = cardOf(view);
    expect(card.steps.map((step) => step.resource)).toEqual(['junk_gifts', 'premium_gift']);
    // premium_gift is visibility 'own' and exclusive 'global': the held premium is flagged taken (the submit says so
    // anyway), but nothing says who holds it, and the junk step marks nothing.
    expect(card.steps[0].blocked.every((entry) => entry.reason !== 'taken')).toBe(true);
    expect(card.steps[1].blocked).toEqual([{ id: 'glastrier', reason: 'taken' }]);
    expect(JSON.stringify(view)).not.toContain(g3);
    expect(JSON.stringify(view)).not.toContain('sub-1');
    expect(JSON.stringify(view.items)).not.toContain('glastrier');
  });

  it('shows a held own-visibility gift only to its holder', () => {
    const items = [item({ resource: 'premium_gift', player_id: g3, item_id: 'glastrier', exclusive: true })];
    const ctx = wichtelContext({ items });
    expect(JSON.stringify(player(g3, ctx).items)).toContain('glastrier');
    expect(JSON.stringify(player(g1, ctx).items)).not.toContain('glastrier');
  });

  it('keeps the givers out of the admin overview, and gives an admin who plays only their own link', () => {
    const ctx = wichtelContext({}, [...GIVERS, 'admin-0005']);
    const overview = buildAdminOverview(ctx, 'admin-0005', WNAMES, { openChallenges: 0 });
    expect(overview.relations.find((r) => r.key === 'santa')).toMatchObject({ masked: true, link_count: 4, links: [] });
    for (const id of GIVERS) expect(JSON.stringify(overview)).not.toContain(id);
    // A playing admin who is a giver in the ring sees exactly the link a player sees.
    const playing = buildAdminOverview(ctx, g1, WNAMES, { openChallenges: 0 });
    expect(playing.relations[0].links).toEqual([{ from: ref(g1), to: ref(g2), revealed: false }]);
    expect(JSON.stringify(playing)).not.toContain(g3);
    expect(JSON.stringify(playing)).not.toContain(g4);
  });

  it('hides the waiting giver of the choose_gifts deadline check from an admin who plays', () => {
    const ctx = wichtelContext();
    const hidden = giverHiddenActions(ctx, g1);
    expect([...hidden]).toEqual(['choose_gifts']);
    const row = {
      id: 'k',
      source: 'deadline_missed',
      rule_id: 'deadline:cup:0',
      subject: { stage: 'cup', applies: 'action', on_miss: 'admin_review', action: 'choose_gifts', player_id: g3, reason: 'admin_review' },
      status: 'open',
      note: null,
      opened_at: 't',
      resolved_at: null,
      resolved_by: null,
    };
    const masked = toCheckView(row, new Map(), WNAMES, hidden);
    expect(masked.subject).toMatchObject({ action: 'choose_gifts', giver_masked: true });
    expect(JSON.stringify(masked)).not.toContain(g3);
    // An admin outside the ring is no recipient and sees the player.
    expect(toCheckView(row, new Map(), WNAMES, giverHiddenActions(ctx, 'admin-0005')).subject).toMatchObject({ player_id: g3 });
  });

  it('shows the whole ring once the givers are revealed', () => {
    const revealed = wichtelContext({ links: RING.map((l) => ({ ...l, revealed: true })) });
    const santa = player(g1, revealed).relations.find((r) => r.key === 'santa')!;
    expect(santa.links).toHaveLength(4);
    expect(santa.links.every((l) => l.revealed && l.from !== null && l.to !== null)).toBe(true);
    expect(giverHiddenActions(revealed, g1).size).toBe(0);
  });

  it('passes the private-player-data check on both read models', () => {
    const ctx = wichtelContext({}, [...GIVERS, 'admin-0005']);
    expectNoPrivatePlayerData(player(g1, ctx));
    expectNoPrivatePlayerData(buildAdminOverview(ctx, 'admin-0005', WNAMES, { openChallenges: 0 }));
  });
});
