/**
 * The league admin Live tab panel (`formatLivePanel`): a notice for a league that runs no kit format, and for one that
 * does the kit context loaded once, every admin loader run over it, and only plain props handed to the client islands.
 * The loaders and the islands are stubs; the panel function is called directly.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadKitContext: vi.fn(),
  loadAdminOverview: vi.fn(),
  loadChecksPage: vi.fn(),
  loadAdjustmentsPage: vi.fn(),
  listFormatChallenges: vi.fn(),
  loadParticipantNames: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('@/lib/format-engine/runtime/load', () => ({
  loadKitContext: mocks.loadKitContext,
  // The real roster rule: the players of every phase, sorted, no repeats.
  rosterOf: (ctx: { phases: { members: string[] }[] }) => [...new Set(ctx.phases.flatMap((p) => p.members))].sort(),
}));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({
  loadAdminOverview: mocks.loadAdminOverview,
  loadChecksPage: mocks.loadChecksPage,
  loadAdjustmentsPage: mocks.loadAdjustmentsPage,
  loadParticipantNames: mocks.loadParticipantNames,
}));
vi.mock('@/lib/supabase/queries/format-challenges', () => ({ listFormatChallenges: mocks.listFormatChallenges }));
vi.mock('@/components/ui/Section', () => stub('Section'));
vi.mock('@/components/format-runtime/admin/ChecksInbox', () => stub('ChecksInbox'));
vi.mock('@/components/format-runtime/admin/AdjustmentsPanel', () => stub('AdjustmentsPanel'));
vi.mock('@/components/format-runtime/admin/AdjustmentHistory', () => stub('AdjustmentHistory'));
vi.mock('@/components/format-runtime/admin/ActionsOverview', () => stub('ActionsOverview'));
vi.mock('@/components/format-runtime/admin/RelationsAdmin', () => stub('RelationsAdmin'));
vi.mock('@/components/format-runtime/admin/AdminLadders', () => stub('AdminLadders'));
vi.mock('@/components/format-runtime/admin/DomainsSummary', () => stub('DomainsSummary'));
vi.mock('@/components/format-runtime/admin/LateJoiners', () => stub('LateJoiners'));

import { formatLivePanel } from '../_components/panels/LivePanel';
import type { LeagueAdminPanelContext } from '../_components/panels/context';
import Section from '@/components/ui/Section';
import ChecksInbox from '@/components/format-runtime/admin/ChecksInbox';
import AdjustmentsPanel from '@/components/format-runtime/admin/AdjustmentsPanel';
import AdjustmentHistory from '@/components/format-runtime/admin/AdjustmentHistory';
import ActionsOverview from '@/components/format-runtime/admin/ActionsOverview';
import RelationsAdmin from '@/components/format-runtime/admin/RelationsAdmin';
import AdminLadders from '@/components/format-runtime/admin/AdminLadders';
import LateJoiners from '@/components/format-runtime/admin/LateJoiners';
import DomainsSummary from '@/components/format-runtime/admin/DomainsSummary';

const S1 = '5e150000-0000-4000-8000-000000000001';
const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const MARA = 'b0000000-0000-4000-8000-000000000001';
const MISTY = 'b0000000-0000-4000-8000-000000000002';
const PHASE = 'c0000000-0000-4000-8000-000000000001';
const CHALLENGE = 'd0000000-0000-4000-8000-000000000001';

type El = ReactElement<Record<string, unknown>>;

function walk(node: ReactNode, visit: (el: El) => void): void {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n as ReactNode, visit));
    return;
  }
  if (isValidElement<Record<string, unknown>>(node)) {
    visit(node);
    walk(node.props.children as ReactNode, visit);
  }
}

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  walk(node, (el) => {
    if (el.type === type) found.push(el);
  });
  return found;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n as ReactNode)).join('');
  if (isValidElement<Record<string, unknown>>(node)) return textOf(node.props.children as ReactNode);
  return '';
}

const text = (v: string) => ({ base: 'en' as const, en: { v, s: 'human' as const } });

const tabLink = vi.fn((tab: string) => (chunks: ReactNode) => <a href={`/admin/leagues/${S1}?tab=${tab}`}>{chunks}</a>);

const panelContext = (): LeagueAdminPanelContext =>
  ({ id: S1, playerId: ADMIN, isSiteAdmin: true, tabLink }) as unknown as LeagueAdminPanelContext;

const phase = (id: string, pairing: { kind: string }) => ({ id, stage: { key: 'cup', name: text('Cup'), pairing }, members: [MARA, MISTY] });

function context(phases = [phase(PHASE, { kind: 'swiss' })]) {
  return { seasonId: S1, seed: 'SECRET-SEED', phases };
}

const OVERVIEW = {
  running: true,
  actions: [{ id: 'gift', label: text('Gift'), window: 'open', lock: 'on_close', actors: 2, counts: { missing: 1, draft: 0, submitted: 1, locked: 0 } }],
  domains: [{ key: 'pool', label: text('Pool'), visibility: 'public', unlocked: true, entry_count: 3 }],
  relations: [{ key: 'santa', label: text('Santa'), shape: 'derangement', links: [], masked: true, link_count: 2 }],
  open_checks: 1,
  open_challenges: 1,
  allowed_adjustments: ['points', 'resource', 'action', 'relation'],
  late_joiners: [] as unknown[],
};

const ADJUSTMENTS = {
  allowed: ['points', 'resource', 'action', 'relation'],
  targets: {
    stages: [{ key: 'cup', label: text('Cup'), players: [{ id: MARA, name: 'Mara' }, { id: MISTY, name: 'Misty' }] }],
    players: [{ id: MARA, name: 'Mara' }, { id: MISTY, name: 'Misty' }],
    resources: [],
    relations: [],
    actions: [{ id: 'gift', label: text('Gift') }],
  },
  history: [{ id: 'h1', kind: 'points', target: {}, delta: {}, reason: 'fix', admin: null, created_at: '2026-11-01T10:00:00.000Z' }],
  total: 31,
};

const CHECKS = { checks: [{ id: 'k1', source: 'standings_tie', rule_id: 'r', rule_label: null, subject: {}, state: 'open', note: null, opened_at: '2026-11-01T10:00:00.000Z', resolved_at: null, resolved_by: null }], total: 1 };

const CHALLENGE_ROW = {
  id: CHALLENGE,
  season_id: S1,
  phase_id: PHASE,
  challenger_id: MARA,
  defender_id: MISTY,
  status: 'open',
  round: 2,
  created_at: '2026-11-01T10:00:00.000Z',
  expires_at: '2999-01-01T00:00:00.000Z',
  responded_at: null,
  match_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadKitContext.mockResolvedValue(context());
  mocks.loadAdminOverview.mockResolvedValue(OVERVIEW);
  mocks.loadChecksPage.mockResolvedValue(CHECKS);
  mocks.loadAdjustmentsPage.mockResolvedValue(ADJUSTMENTS);
  mocks.listFormatChallenges.mockResolvedValue([]);
  mocks.loadParticipantNames.mockResolvedValue(new Map([[MARA, 'Mara'], [MISTY, 'Misty']]));
});

describe('Live tab panel', () => {
  it('a league without a running kit format gets a notice that links to the Format tab, and nothing is loaded', async () => {
    mocks.loadKitContext.mockResolvedValue(null);
    const tree = await formatLivePanel(panelContext());
    expect(mocks.loadAdminOverview).not.toHaveBeenCalled();
    expect(mocks.loadChecksPage).not.toHaveBeenCalled();
    expect(mocks.loadAdjustmentsPage).not.toHaveBeenCalled();
    expect(mocks.listFormatChallenges).not.toHaveBeenCalled();
    expect(mocks.loadParticipantNames).not.toHaveBeenCalled();
    expect(tabLink).toHaveBeenCalledWith('format');
    const [link] = (() => {
      const anchors: El[] = [];
      walk(tree, (el) => {
        if (el.type === 'a') anchors.push(el);
      });
      return anchors;
    })();
    expect(link.props.href).toBe(`/admin/leagues/${S1}?tab=format`);
    expect(textOf(tree)).toContain('not running a custom format yet');
    expect(findByType(tree, ChecksInbox)).toHaveLength(0);
  });

  it('loads the kit context once and runs every admin loader over it, in one wave', async () => {
    await formatLivePanel(panelContext());
    expect(mocks.loadKitContext).toHaveBeenCalledTimes(1);
    expect(mocks.loadKitContext).toHaveBeenCalledWith(S1);
    const ctx = await mocks.loadKitContext.mock.results[0].value;
    expect(mocks.loadAdminOverview).toHaveBeenCalledWith(ctx, ADMIN, expect.any(Date));
    expect(mocks.loadChecksPage).toHaveBeenCalledWith(S1, ctx, 'open', { limit: 20, offset: 0 }, ADMIN, true);
    expect(mocks.loadAdjustmentsPage).toHaveBeenCalledWith(S1, ctx, { limit: 20, offset: 0 }, ADMIN);
    expect(mocks.listFormatChallenges).toHaveBeenCalledWith(S1, { status: 'open' });
    expect(mocks.loadParticipantNames).toHaveBeenCalledWith(S1);
  });

  it('renders the sections in order and hands the islands their data', async () => {
    const tree = await formatLivePanel(panelContext());
    expect(findByType(tree, Section).map((s) => s.props.title)).toEqual([
      'Checks inbox',
      'Manual adjustments',
      'Player actions',
      'Relations',
      'Lists',
    ]);

    const [inbox] = findByType(tree, ChecksInbox);
    expect(inbox.props.seasonId).toBe(S1);
    expect(inbox.props.initial).toBe(CHECKS);
    expect(inbox.props.names).toEqual({ [MARA]: 'Mara', [MISTY]: 'Misty' });
    expect(inbox.props.labels).toEqual({ stages: { cup: text('Cup') }, actions: { gift: text('Gift') } });

    const [form] = findByType(tree, AdjustmentsPanel);
    expect(form.props.allowed).toEqual(['points', 'resource', 'action', 'relation']);
    expect(form.props.targets).toBe(ADJUSTMENTS.targets);

    const [history] = findByType(tree, AdjustmentHistory);
    expect(history.props.initial).toBe(ADJUSTMENTS.history);
    expect(history.props.total).toBe(31);

    const [actions] = findByType(tree, ActionsOverview);
    expect(actions.props.actions).toBe(OVERVIEW.actions);
    expect(actions.props.canAdjust).toBe(true);

    const [relations] = findByType(tree, RelationsAdmin);
    expect(relations.props.relations).toBe(OVERVIEW.relations);
    expect(relations.props.canReveal).toBe(true);
    // The draw dialog lists who the server will draw over: the players of the phases, with their names.
    expect(relations.props.roster).toEqual([{ id: MARA, name: 'Mara' }, { id: MISTY, name: 'Misty' }]);

    const [domains] = findByType(tree, DomainsSummary);
    expect(domains.props.domains).toBe(OVERVIEW.domains);
  });

  it('lists the late joiners in a section of their own, and shows no such section when nobody joined late', async () => {
    expect(findByType(await formatLivePanel(panelContext()), LateJoiners)).toHaveLength(0);

    const lateJoiners = [{ player: { id: MISTY, name: 'Misty' }, missed: [] }];
    mocks.loadAdminOverview.mockResolvedValue({ ...OVERVIEW, late_joiners: lateJoiners });
    const tree = await formatLivePanel(panelContext());

    const [list] = findByType(tree, LateJoiners);
    expect(list.props.lateJoiners).toBe(lateJoiners);
    const titles = findByType(tree, Section).map((s) => s.props.title);
    expect(titles).toContain('Late joiners');
    expect(titles.indexOf('Late joiners')).toBeLessThan(titles.indexOf('Relations'));
  });

  it('Open and Lock and Reveal follow the kinds the format allows', async () => {
    mocks.loadAdminOverview.mockResolvedValue({ ...OVERVIEW, allowed_adjustments: ['points'] });
    const tree = await formatLivePanel(panelContext());
    expect(findByType(tree, ActionsOverview)[0].props.canAdjust).toBe(false);
    expect(findByType(tree, RelationsAdmin)[0].props.canReveal).toBe(false);
  });

  it('the challenges section appears only for a format with a challenge ladder', async () => {
    expect(findByType(await formatLivePanel(panelContext()), AdminLadders)).toHaveLength(0);

    mocks.loadKitContext.mockResolvedValue(context([phase(PHASE, { kind: 'challenge' })]));
    mocks.listFormatChallenges.mockResolvedValue([CHALLENGE_ROW]);
    const tree = await formatLivePanel(panelContext());
    const [ladders] = findByType(tree, AdminLadders);
    expect(ladders.props.phases).toEqual([{ id: PHASE, label: text('Cup') }]);
    const challenges = ladders.props.challenges as { id: string; challenger: unknown; lapsed: boolean }[];
    expect(challenges).toHaveLength(1);
    expect(challenges[0]).toMatchObject({
      id: CHALLENGE,
      challenger: { id: MARA, name: 'Mara' },
      defender: { id: MISTY, name: 'Misty' },
      state: 'open',
      lapsed: false,
    });
    expect(findByType(tree, Section).map((s) => s.props.title)).toContain('Challenges');
  });

  it('names every season participant, also one who sits in no phase, instead of calling them a former player', async () => {
    const LATE = 'b0000000-0000-4000-8000-000000000003';
    mocks.loadParticipantNames.mockResolvedValue(new Map([[MARA, 'Mara'], [MISTY, 'Misty'], [LATE, 'Late Joiner']]));
    mocks.loadKitContext.mockResolvedValue(context([phase(PHASE, { kind: 'challenge' })]));
    mocks.listFormatChallenges.mockResolvedValue([{ ...CHALLENGE_ROW, defender_id: LATE }]);
    const tree = await formatLivePanel(panelContext());

    // The phase targets still list the two seated players only; the names cover the whole season.
    expect(findByType(tree, AdjustmentsPanel)[0].props.targets).toBe(ADJUSTMENTS.targets);
    expect(findByType(tree, ChecksInbox)[0].props.names).toEqual({ [MARA]: 'Mara', [MISTY]: 'Misty', [LATE]: 'Late Joiner' });
    expect(findByType(tree, AdjustmentHistory)[0].props.names).toEqual({ [MARA]: 'Mara', [MISTY]: 'Misty', [LATE]: 'Late Joiner' });
    const [ladders] = findByType(tree, AdminLadders);
    expect((ladders.props.challenges as { defender: unknown }[])[0].defender).toEqual({ id: LATE, name: 'Late Joiner' });
  });

  it('only plain data reaches the islands: no seed, no player row, no key of a private column', async () => {
    mocks.loadKitContext.mockResolvedValue(context([phase(PHASE, { kind: 'challenge' })]));
    mocks.listFormatChallenges.mockResolvedValue([CHALLENGE_ROW]);
    const tree = await formatLivePanel(panelContext());
    const props: unknown[] = [];
    walk(tree, (el) => {
      if (typeof el.type === 'string') return;
      const { children: _children, ...rest } = el.props;
      props.push(rest);
    });
    const json = JSON.stringify(props);
    expect(json).not.toContain('SECRET-SEED');
    expect(json).not.toMatch(/"(seed|discord_id|email|target_player_id|source_ref)"/);
  });
});
