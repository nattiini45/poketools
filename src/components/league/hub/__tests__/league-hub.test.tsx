/**
 * The league hub (LeagueHub + its tab panels) as the league page renders it
 * inside a world's #pulse section: header strip, tab links, the active panel.
 *
 * Rendered through react-dom/server (vitest 'node' env, no DOM). The markup
 * is read back with a tiny well-formed-HTML parser (React's static markup:
 * every attribute double-quoted and escaped, no comments), so assertions name
 * elements and attributes instead of matching raw strings.
 *
 * Mocks: `next/link` is a plain anchor that forwards its props (and shows
 * `scroll` / `prefetch` as data attributes); `useLinkStatus` is a seeded
 * stub (HubTabPending). The bracket renderer's feeder labels import the
 * Supabase query modules, so the Supabase client is a stub that throws on
 * use: nothing here reads. `next-auth/react` is stubbed for the Kale report
 * card (no SessionProvider in a static render).
 *
 * i18n: the hub follows the VIEWER's language (`locale`, the page's
 * `getLocale()`), never the world. Every render is wrapped in the
 * `I18nProvider` of the same locale (`withI18n`, time zone UTC), which the
 * client leaves (kickoff `<LocalTime>`, the insights view) read. Kickoffs are
 * in the viewer's zone, so the old fixed " UTC" suffix is gone; match status
 * chips use the unified `enums` wording ("Completed", "In progress").
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const linkStatus = vi.hoisted(() => ({ pending: false }));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  function Link({
    href,
    children,
    scroll,
    prefetch,
    ...rest
  }: {
    href: string | { pathname?: string };
    children?: ReactNode;
    scroll?: boolean;
    prefetch?: boolean | null;
    [key: string]: unknown;
  }) {
    return createElement(
      'a',
      {
        ...rest,
        href: typeof href === 'string' ? href : (href.pathname ?? ''),
        'data-link-scroll': scroll === undefined ? undefined : String(scroll),
        'data-link-prefetch': prefetch === undefined || prefetch === null ? undefined : String(prefetch),
      },
      children,
    );
  }
  return { default: Link, useLinkStatus: () => ({ pending: linkStatus.pending }) };
});

vi.mock('@/lib/supabase/client', () => ({
  get supabase(): never {
    throw new Error('league hub render must not reach Supabase');
  },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: async () => null }),
}));

import LeagueHub, { LEAGUE_HUB_PANEL_ID, type LeagueHubProps } from '../LeagueHub';
import { leagueHubCopy } from '@/lib/league-hub/copy';
import type { Locale } from '@/i18n/config';
import { createFormatter } from '@/i18n/format';
import { withI18n } from '@/test/i18n';
import {
  availableLeagueHubTabs,
  DEFAULT_LEAGUE_HUB_TAB,
  leagueHubHref,
  LEAGUE_HUB_TABS,
  type LeagueHubTab,
} from '@/lib/league-hub/tabs';
import type { HubBracketStage, HubPhase, LeagueHubPanelData } from '@/lib/league-hub/load';
import type { HubGroupTable, HubRoundMatches, HubStageMatches, HubTableStage } from '@/lib/league-hub/views';
import { getFormatName } from '@/lib/pkmn/formats';
import type { PublicSeasonParticipant, PublicTournamentParticipant } from '@/lib/players/public-player';
import type { LeagueStanding } from '@/lib/supabase/queries/league-standings';
import type { Standing } from '@/lib/tournament/types';
import type { GameSummary, MatchWithPlayers } from '@/types/match';
import type { Round } from '@/types/round';
import type { Ruleset } from '@/types/ruleset';
import type { CoreTriple, SeasonWithDetails, TournamentGroupWithMembers } from '@/types/season';
import type { TournamentReport } from '@/types/tournament-report';
import type { TournamentWithDetails } from '@/types/tournament';

// ─── Dates as the hub prints them (provider time zone UTC) ─────────────────

/** A season's calendar day (zone-free `formatter.calendarDate`). */
function formatDay(day: string, locale: Locale): string {
  return createFormatter({ locale, timeZone: 'UTC' }).calendarDate(day);
}

/** A kickoff: `<LocalTime preset="dateTime">` in the viewer's zone (UTC here). */
function formatKickoff(iso: string, locale: Locale): string {
  return createFormatter({ locale, timeZone: 'UTC' }).instant(iso, 'dateTime');
}

// ─── Markup reader ────────────────────────────────────────────────────────

interface HtmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
type HtmlNode = HtmlElement | string;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return NAMED_ENTITIES[code] ?? whole;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)) {
    attrs[match[1]] = decodeEntities(match[2] ?? '');
  }
  return attrs;
}

/** Parses React's static markup into a tree; throws on anything it cannot read (so a test never passes on a misparse). */
function parseMarkup(html: string): HtmlElement {
  const root: HtmlElement = { tag: '#root', attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const token =
    /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let index = 0;
  for (const match of html.matchAll(token)) {
    if (match.index !== index) throw new Error(`unreadable markup at ${index}: ${html.slice(index, index + 60)}`);
    index += match[0].length;
    const [, closeTag, openTag, rawAttrs, selfClose, text] = match;
    const parent = stack[stack.length - 1];
    if (text !== undefined) {
      parent.children.push(decodeEntities(text));
    } else if (closeTag !== undefined) {
      const open = stack.pop();
      if (!open || open === root || open.tag !== closeTag.toLowerCase()) {
        throw new Error(`unbalanced </${closeTag}> at ${index}`);
      }
    } else if (openTag !== undefined) {
      const element: HtmlElement = { tag: openTag.toLowerCase(), attrs: parseAttrs(rawAttrs ?? ''), children: [] };
      parent.children.push(element);
      if (!selfClose && !VOID_TAGS.has(element.tag)) stack.push(element);
    }
  }
  if (index !== html.length || stack.length !== 1) throw new Error('markup ended with unclosed elements');
  return root;
}

function descendants(node: HtmlElement): HtmlElement[] {
  const out: HtmlElement[] = [];
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    out.push(child, ...descendants(child));
  }
  return out;
}

function findAll(node: HtmlElement, predicate: (el: HtmlElement) => boolean): HtmlElement[] {
  return descendants(node).filter(predicate);
}

function findOne(node: HtmlElement, predicate: (el: HtmlElement) => boolean, what: string): HtmlElement {
  const hits = findAll(node, predicate);
  if (hits.length !== 1) throw new Error(`expected exactly one ${what}, found ${hits.length}`);
  return hits[0];
}

function textOf(node: HtmlNode): string {
  return typeof node === 'string' ? node : node.children.map(textOf).join('');
}

/** Visible-ish text with whitespace collapsed. */
function squash(node: HtmlNode): string {
  return textOf(node).replace(/\s+/g, ' ').trim();
}

function classList(el: HtmlElement): string[] {
  return (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
}

const tag = (name: string) => (el: HtmlElement) => el.tag === name;
const withId = (id: string) => (el: HtmlElement) => el.attrs.id === id;

// ─── Fixtures ─────────────────────────────────────────────────────────────

const LEAGUE_ID = 'league-1';
const STAMP = '2026-01-01T00:00:00Z';

function makeLeague(overrides: Partial<SeasonWithDetails> = {}): SeasonWithDetails {
  return {
    id: LEAGUE_ID,
    name: 'Spring League',
    description: '',
    format_type: 'singles',
    ruleset_id: 'rs-1',
    start_date: '2026-03-01',
    end_date: '2026-06-30',
    status: 'active',
    archived: false,
    legacy: false,
    is_test_season: false,
    core_pool: null,
    point_buy_list_id: null,
    language: 'de',
    created_at: STAMP,
    updated_at: STAMP,
    ruleset_name: 'Spring OU Rules',
    participant_count: 8,
    tournament_count: 2,
    ...overrides,
  };
}

function makeStage(
  overrides: Partial<TournamentWithDetails> & Pick<TournamentWithDetails, 'id' | 'name' | 'bracket_type'>,
): TournamentWithDetails {
  return {
    description: '',
    season_id: LEAGUE_ID,
    ruleset_id: 'rs-1',
    best_of_default: 3,
    bo_overrides: {},
    is_doubles: false,
    team_visibility: 'always_public',
    status: 'active',
    current_round: 1,
    stage_order: 1,
    advancement_rule: null,
    enrollment_source: null,
    archived: false,
    legacy: false,
    created_at: STAMP,
    updated_at: STAMP,
    ruleset_name: 'Spring OU Rules',
    season_name: 'Spring League',
    participant_count: 8,
    ...overrides,
  };
}

const GROUP_STAGE = makeStage({
  id: 'stage-groups',
  name: 'Group Stage',
  bracket_type: 'round_robin',
  stage_order: 1,
  advancement_rule: { type: 'top_n', count: 2, per_group: true },
});
const SWISS_STAGE = makeStage({
  id: 'stage-swiss',
  name: 'Swiss Stage',
  bracket_type: 'swiss',
  stage_order: 2,
  status: 'upcoming',
  participant_count: 6,
  advancement_rule: { type: 'top_n', count: 4, per_group: false },
});
const PLAYOFF_STAGE = makeStage({
  id: 'stage-playoffs',
  name: 'Playoffs',
  bracket_type: 'single_elim',
  stage_order: 3,
  status: 'upcoming',
  best_of_default: 5,
  participant_count: 4,
});
const DOUBLE_ELIM_STAGE = makeStage({
  id: 'stage-double',
  name: 'Last Chance',
  bracket_type: 'double_elim',
  stage_order: 4,
  status: 'upcoming',
  participant_count: 1,
});

const STAGES: TournamentWithDetails[] = [GROUP_STAGE, PLAYOFF_STAGE];

const NAMES: Record<string, string> = {
  p1: 'Ash',
  p2: 'Brock',
  p3: 'Misty',
  p4: 'Gary',
  p5: 'Dawn',
  p6: 'Iris',
  p7: 'Cynthia',
  p8: 'Lance',
};

function makeParticipant(
  id: string,
  overrides: Partial<PublicSeasonParticipant> = {},
): PublicSeasonParticipant {
  return { id, name: NAMES[id], gym_type: null, avatar_url: null, core_types: null, ...overrides };
}

const PARTICIPANTS: PublicSeasonParticipant[] = [
  makeParticipant('p1', { gym_type: 'Fire' }),
  makeParticipant('p2'),
  makeParticipant('p3'),
  makeParticipant('p4'),
];

function makeStanding(id: string, overrides: Partial<LeagueStanding> = {}): LeagueStanding {
  return {
    player_id: id,
    player_name: NAMES[id],
    player_avatar_url: null,
    gym_type: null,
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    buchholz: 0,
    games_played: 0,
    kill_differential: 0,
    eliminated: false,
    rank_change: null,
    ...overrides,
  };
}

function game(number: number, winner: string | null): GameSummary {
  return {
    id: `g-${number}-${winner ?? 'none'}`,
    game_number: number,
    winner_id: winner,
    replay_url: '',
    source: 'manual',
    stats_locked: false,
  };
}

function makeMatch(
  id: string,
  overrides: Partial<MatchWithPlayers> &
    Pick<MatchWithPlayers, 'round_id' | 'tournament_id' | 'player_1_id' | 'player_2_id'>,
): MatchWithPlayers {
  return {
    id,
    winner_id: null,
    status: 'scheduled',
    submitter_id: null,
    date_played: null,
    scheduled_at: null,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: '',
    social_image_url: null,
    bracket_side: null,
    bracket_pos: null,
    created_at: STAMP,
    updated_at: STAMP,
    player_1_name: NAMES[overrides.player_1_id],
    player_2_name: NAMES[overrides.player_2_id],
    player_1_avatar_url: null,
    player_2_avatar_url: null,
    winner_name: overrides.winner_id ? NAMES[overrides.winner_id] : null,
    round_status: 'active',
    games: [],
    ...overrides,
  };
}

function makeRound(overrides: Partial<Round> & Pick<Round, 'id' | 'tournament_id' | 'name' | 'round_number'>): Round {
  return {
    best_of: 3,
    status: 'pending',
    pairings_generated: true,
    deadline: null,
    bracket_side: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function makeRuleset(overrides: Partial<Ruleset> = {}): Ruleset {
  return {
    id: 'rs-1',
    name: 'Spring OU Rules',
    base_format: 'gen9ou',
    is_doubles: false,
    clauses: [],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

function makeReport(id: string, headline: string, createdAt: string, tournamentId: string): TournamentReport {
  return {
    id,
    tournament_id: tournamentId,
    round_id: 'round-x',
    report_type: 'round_recap',
    model_id: 'model',
    // The collapsed card renders only the headline.
    content: { headline } as unknown as TournamentReport['content'],
    prompt_tokens: null,
    completion_tokens: null,
    generation_time_ms: null,
    status: 'completed',
    error: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const SEASON_ROWS: LeagueStanding[] = [
  makeStanding('p1', { wins: 3, points: 9, buchholz: 9, rank_change: 2 }),
  makeStanding('p2', { wins: 2, losses: 1, points: 6, buchholz: 12, rank_change: -1 }),
  makeStanding('p3', { wins: 1, losses: 2, points: 3, buchholz: 15.5, rank_change: null }),
  makeStanding('p4', { losses: 3, rank_change: 0 }),
];

const STANDINGS_PANEL: LeagueHubPanelData = {
  tab: 'standings',
  isEvolutionPointBuy: false,
  standings: SEASON_ROWS,
};

// ─── Render helper ────────────────────────────────────────────────────────

interface Rendered {
  html: string;
  /** The hub's root element. */
  hub: HtmlElement;
  /** The active panel region. */
  panel: HtmlElement;
}

function renderHub(overrides: Partial<LeagueHubProps> & { panel: LeagueHubPanelData }): Rendered {
  const stages = overrides.stages ?? STAGES;
  const props: LeagueHubProps = {
    league: makeLeague(),
    stages,
    participants: PARTICIPANTS,
    locale: 'en',
    query: {},
    tabs: availableLeagueHubTabs(stages, { reports: false }),
    activeTab: overrides.panel.tab === 'unavailable' ? overrides.panel.requested : overrides.panel.tab,
    ...overrides,
  };
  const html = renderToStaticMarkup(withI18n(<LeagueHub {...props} />, { locale: props.locale }));
  const tree = parseMarkup(html);
  const roots = tree.children.filter((child): child is HtmlElement => typeof child !== 'string');
  if (roots.length !== 1) throw new Error(`expected one hub root, found ${roots.length}`);
  return { html, hub: roots[0], panel: findOne(roots[0], withId(LEAGUE_HUB_PANEL_ID), 'panel region') };
}

/** The strip above the tab bar (heading, facts, status, dates, league links). */
function headerOf(hub: HtmlElement): HtmlElement {
  const first = hub.children.find((child): child is HtmlElement => typeof child !== 'string');
  if (!first || first.tag !== 'div') throw new Error('hub header strip missing');
  return first;
}

function navOf(hub: HtmlElement): HtmlElement {
  return findOne(hub, tag('nav'), 'tab nav');
}

function tabLinks(hub: HtmlElement): HtmlElement[] {
  return findAll(navOf(hub), tag('a'));
}

/** Data rows (tbody) of a table. */
function bodyRows(table: HtmlElement): HtmlElement[] {
  return findAll(findOne(table, tag('tbody'), 'tbody'), tag('tr'));
}

function headerCells(table: HtmlElement): string[] {
  return findAll(findOne(table, tag('thead'), 'thead'), tag('th')).map(squash);
}

/** Standings tables carry a caption; the round robin results grid does not. */
function standingsTables(node: HtmlElement): HtmlElement[] {
  return findAll(node, (el) => el.tag === 'table' && el.children.some((c) => typeof c !== 'string' && c.tag === 'caption'));
}

function expectNoSection(rendered: Rendered): void {
  // The 3D route-live CSS forces every <section> inside the world to 100vh
  // with hidden children; the hub lives inside #pulse, so it must not add one.
  expect(findAll(rendered.hub, tag('section'))).toHaveLength(0);
  expect(rendered.html).not.toMatch(/<section[\s>]/);
}

beforeEach(() => {
  linkStatus.pending = false;
});

// ─── Root, header strip, league links ─────────────────────────────────────

describe('LeagueHub root', () => {
  it.each(['standings', 'rules'] as const)(
    'carries the league-hub class and data-league-hub=%s for the active tab',
    (active) => {
      const panel: LeagueHubPanelData =
        active === 'standings' ? STANDINGS_PANEL : { tab: 'rules', ruleset: null };
      const { hub } = renderHub({ panel });
      expect(hub.tag).toBe('div');
      expect(classList(hub)).toContain('league-hub');
      expect(hub.attrs['data-league-hub']).toBe(active);
      expect(hub.attrs.id).toBe('league-hub');
      expect(hub.attrs.role).toBe('region');
      expect(hub.attrs['aria-labelledby']).toBe('league-hub-heading');
      expect(squash(findOne(hub, withId('league-hub-heading'), 'heading'))).toBe('League hub');
    },
  );

  it('labels the panel region with the active tab id, which the tab bar holds', () => {
    const { hub, panel } = renderHub({
      panel: { tab: 'insights', usageRows: [], killRanking: [], isDoubles: false },
    });
    expect(panel.tag).toBe('div');
    expect(panel.attrs.role).toBe('region');
    expect(panel.attrs['aria-labelledby']).toBe('league-hub-tab-insights');
    const labelledBy = findOne(hub, withId('league-hub-tab-insights'), 'active tab');
    expect(labelledBy.attrs['data-hub-tab']).toBe('insights');
    expect(findAll(navOf(hub), withId('league-hub-tab-insights'))).toHaveLength(1);
  });

  it('renders the heading in German for a German viewer', () => {
    const { hub } = renderHub({ locale: 'de', panel: STANDINGS_PANEL });
    expect(squash(findOne(hub, withId('league-hub-heading'), 'heading'))).toBe('Liga-Übersicht');
  });
});

describe('LeagueHub header strip', () => {
  it('shows format, ruleset, trainer count, status chip and dates (en)', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    const header = squash(headerOf(hub));
    const format = header.indexOf('Singles');
    const ruleset = header.indexOf('Spring OU Rules');
    const trainers = header.indexOf('8 trainers');
    expect(format).toBeGreaterThanOrEqual(0);
    expect(ruleset).toBeGreaterThan(format);
    expect(trainers).toBeGreaterThan(ruleset);
    // Status chip: its own pill, with the live dot while the league runs.
    const chip = findOne(headerOf(hub), (el) => el.tag === 'span' && squash(el) === 'In progress', 'status chip');
    expect(classList(chip)).toContain('rounded-full');
    expect(findAll(chip, (el) => el.attrs['aria-hidden'] === 'true')).toHaveLength(1);
    expect(header).toContain(`Start: ${formatDay('2026-03-01', 'en')}`);
    expect(header).toContain(`End: ${formatDay('2026-06-30', 'en')}`);
    expect(header).toContain('Start: 1 Mar 2026 — End: 30 Jun 2026');
  });

  it('shows the same strip in German', () => {
    const { hub } = renderHub({
      locale: 'de',
      league: makeLeague({ format_type: 'evolution_point_buy', status: 'upcoming', participant_count: 12 }),
      panel: { ...STANDINGS_PANEL, isEvolutionPointBuy: true },
    });
    const header = squash(headerOf(hub));
    expect(header).toContain('Evolution Point Buy');
    expect(header).toContain('Spring OU Rules');
    expect(header).toContain('12 Teilnehmer');
    expect(findAll(headerOf(hub), (el) => el.tag === 'span' && squash(el) === 'Bevorstehend')).toHaveLength(1);
    expect(header).toContain('Start: 1. März 2026 — Ende: 30. Juni 2026');
  });

  it('uses the singular for one trainer, drops a missing ruleset and missing dates', () => {
    const { hub } = renderHub({
      league: makeLeague({ participant_count: 1, ruleset_name: null, start_date: null, end_date: null, status: 'completed' }),
      panel: STANDINGS_PANEL,
    });
    const header = squash(headerOf(hub));
    expect(header).toContain('1 trainer');
    expect(header).not.toContain('1 trainers');
    expect(header).not.toContain('Spring OU Rules');
    expect(header).not.toContain('Start:');
    expect(header).not.toContain('End:');
    expect(header).toContain('Completed');
  });

  it('shows only "Full insights" for a classic format', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    const links = findAll(headerOf(hub), tag('a'));
    expect(links.map((a) => [a.attrs.href, squash(a)])).toEqual([
      [`/insights?scope=league&id=${LEAGUE_ID}&tab=usage`, 'Full insights'],
    ]);
  });

  it('adds the draft room for a draft league, but no matchup analysis', () => {
    const { hub } = renderHub({ league: makeLeague({ format_type: 'draft' }), panel: STANDINGS_PANEL });
    const links = findAll(headerOf(hub), tag('a'));
    expect(links.map((a) => [a.attrs.href, squash(a)])).toEqual([
      [`/insights?scope=league&id=${LEAGUE_ID}&tab=usage`, 'Full insights'],
      [`/leagues/${LEAGUE_ID}/draft`, 'Draft room'],
    ]);
  });

  it('adds the draft room and matchup analysis for EPB (German labels)', () => {
    const { hub } = renderHub({
      locale: 'de',
      league: makeLeague({ format_type: 'evolution_point_buy' }),
      panel: { ...STANDINGS_PANEL, isEvolutionPointBuy: true },
    });
    const links = findAll(headerOf(hub), tag('a'));
    expect(links.map((a) => [a.attrs.href, squash(a)])).toEqual([
      [`/insights?scope=league&id=${LEAGUE_ID}&tab=usage`, 'Alle Insights'],
      // EPB drafts in the arena, as the Pulse CTA links (the plain draft format uses /draft).
      [`/leagues/${LEAGUE_ID}/draft-room`, 'Draft-Raum'],
      [`/leagues/${LEAGUE_ID}/matchup`, 'Matchup-Analyse'],
    ]);
  });
});

// ─── Tab bar ──────────────────────────────────────────────────────────────

describe('LeagueHub tab bar', () => {
  const ALL_STAGES = [GROUP_STAGE, SWISS_STAGE, PLAYOFF_STAGE];

  it('renders one link per available tab, in order, with data-hub-tab and ids', () => {
    const tabs = availableLeagueHubTabs(ALL_STAGES, { reports: true });
    expect(tabs).toEqual([...LEAGUE_HUB_TABS]);
    const { hub } = renderHub({ stages: ALL_STAGES, tabs, panel: STANDINGS_PANEL });
    const links = tabLinks(hub);
    expect(links.map((a) => a.attrs['data-hub-tab'])).toEqual([...tabs]);
    expect(links.map((a) => a.attrs.id)).toEqual(tabs.map((t) => `league-hub-tab-${t}`));
    expect(links.map(squash)).toEqual([
      'Standings',
      'Matches',
      'Group stage',
      'Playoffs',
      'Phases',
      'Insights',
      'Rules',
      'Reports',
    ]);
  });

  it('renders exactly the tabs it is given (no groups/playoffs/reports when absent)', () => {
    const tabs: LeagueHubTab[] = ['standings', 'matches', 'phases', 'insights', 'rules'];
    const { hub } = renderHub({ tabs, panel: STANDINGS_PANEL });
    expect(tabLinks(hub).map((a) => a.attrs['data-hub-tab'])).toEqual(tabs);
  });

  it.each(['standings', 'matches', 'groups', 'playoffs'] as const)(
    'marks only the active tab (%s) with aria-current and aria-controls',
    (active) => {
      const panels: Record<typeof active, LeagueHubPanelData> = {
        standings: STANDINGS_PANEL,
        matches: { tab: 'matches', stages: [] },
        groups: { tab: 'groups', stages: [], isEvolutionPointBuy: false },
        playoffs: { tab: 'playoffs', stages: [] },
      };
      const { hub, panel } = renderHub({ panel: panels[active] });
      const links = tabLinks(hub);
      const current = links.filter((a) => a.attrs['aria-current'] === 'page');
      expect(current).toHaveLength(1);
      expect(current[0].attrs['data-hub-tab']).toBe(active);
      const controlling = links.filter((a) => 'aria-controls' in a.attrs);
      expect(controlling).toHaveLength(1);
      expect(controlling[0].attrs['data-hub-tab']).toBe(active);
      expect(controlling[0].attrs['aria-controls']).toBe(LEAGUE_HUB_PANEL_ID);
      expect(panel.attrs['aria-labelledby']).toBe(`league-hub-tab-${active}`);
      expect(hub.attrs['data-league-hub']).toBe(active);
    },
  );

  it('links the default tab to the bare league URL and the others to ?tab=', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    const hrefs = Object.fromEntries(tabLinks(hub).map((a) => [a.attrs['data-hub-tab'], a.attrs.href]));
    expect(hrefs[DEFAULT_LEAGUE_HUB_TAB]).toBe(`/leagues/${LEAGUE_ID}`);
    expect(hrefs.matches).toBe(`/leagues/${LEAGUE_ID}?tab=matches`);
    expect(hrefs.groups).toBe(`/leagues/${LEAGUE_ID}?tab=groups`);
    expect(hrefs.playoffs).toBe(`/leagues/${LEAGUE_ID}?tab=playoffs`);
    expect(hrefs.rules).toBe(`/leagues/${LEAGUE_ID}?tab=rules`);
  });

  it('keeps every other query param on every tab link and replaces the current tab', () => {
    const query = { world: 'sakura', focus: 'schedule', tab: 'matches', multi: ['a', 'b'], gone: undefined };
    const { hub } = renderHub({ query, panel: { tab: 'matches', stages: [] } });
    for (const link of tabLinks(hub)) {
      const tab = link.attrs['data-hub-tab'] as LeagueHubTab;
      expect(link.attrs.href).toBe(leagueHubHref(LEAGUE_ID, query, tab));
    }
    const hrefs = Object.fromEntries(tabLinks(hub).map((a) => [a.attrs['data-hub-tab'], a.attrs.href]));
    expect(hrefs.standings).toBe(`/leagues/${LEAGUE_ID}?world=sakura&focus=schedule&multi=a&multi=b`);
    expect(hrefs.groups).toBe(`/leagues/${LEAGUE_ID}?world=sakura&focus=schedule&multi=a&multi=b&tab=groups`);
  });

  it('switches tabs without scrolling or prefetching', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    for (const link of tabLinks(hub)) {
      expect(link.attrs['data-link-scroll']).toBe('false');
      expect(link.attrs['data-link-prefetch']).toBe('false');
    }
  });

  it('draws the focus ring inset on every tab link (the scrolling tab strip clips an outset ring)', () => {
    const tabs = availableLeagueHubTabs(ALL_STAGES, { reports: true });
    for (const active of ['standings', 'rules'] as const) {
      const panel: LeagueHubPanelData = active === 'standings' ? STANDINGS_PANEL : { tab: 'rules', ruleset: null };
      const { hub } = renderHub({ stages: ALL_STAGES, tabs, panel });
      const links = tabLinks(hub);
      expect(links).toHaveLength(tabs.length);
      for (const link of links) {
        expect(classList(link)).toContain('focus-visible:outline-offset-[-2px]');
        expect(classList(link)).toContain('focus-visible:outline-arena-focus');
      }
    }
  });

  it('carries a pending mark inside every tab link, shown only while the link is pending', () => {
    const idle = renderHub({ panel: STANDINGS_PANEL });
    for (const link of tabLinks(idle.hub)) {
      const marks = findAll(link, (el) => el.tag === 'span' && el.attrs['aria-hidden'] === 'true');
      expect(marks).toHaveLength(1);
      expect(marks[0].attrs['data-pending']).toBeUndefined();
      expect(classList(marks[0])).toContain('opacity-0');
      // Pulse keyframes animate opacity: on an idle dot they would beat opacity-0.
      expect(classList(marks[0]).filter((c) => c.includes('animate-'))).toEqual([]);
    }
    linkStatus.pending = true;
    const pending = renderHub({ panel: STANDINGS_PANEL });
    for (const link of tabLinks(pending.hub)) {
      const mark = findOne(link, (el) => el.attrs['aria-hidden'] === 'true', 'pending mark');
      expect(mark.attrs['data-pending']).toBe('true');
      expect(classList(mark)).toContain('opacity-100');
      expect(classList(mark)).toContain('motion-safe:animate-pulse');
    }
  });

  it('labels the groups tab "Swiss rounds" when no phase is a round robin', () => {
    const stages = [SWISS_STAGE, PLAYOFF_STAGE];
    const { hub } = renderHub({ stages, panel: STANDINGS_PANEL });
    const groups = findOne(navOf(hub), (el) => el.attrs['data-hub-tab'] === 'groups', 'groups tab');
    expect(squash(groups)).toBe('Swiss rounds');
    const de = renderHub({ stages, locale: 'de', panel: STANDINGS_PANEL });
    expect(squash(findOne(navOf(de.hub), (el) => el.attrs['data-hub-tab'] === 'groups', 'groups tab'))).toBe(
      'Schweizer System',
    );
  });

  it('labels the groups tab "Group stage" as soon as one phase is a round robin', () => {
    const stages = [GROUP_STAGE, SWISS_STAGE];
    const { hub } = renderHub({ stages, panel: STANDINGS_PANEL });
    expect(squash(findOne(navOf(hub), (el) => el.attrs['data-hub-tab'] === 'groups', 'groups tab'))).toBe(
      'Group stage',
    );
  });

  it('renders German tab labels and nav label for the plaza', () => {
    const tabs = availableLeagueHubTabs([GROUP_STAGE, PLAYOFF_STAGE], { reports: true });
    const { hub } = renderHub({ locale: 'de', tabs, panel: STANDINGS_PANEL });
    expect(navOf(hub).attrs['aria-label']).toBe('Liga-Ansichten');
    expect(tabLinks(hub).map(squash)).toEqual([
      'Tabelle',
      'Spiele',
      'Gruppenphase',
      'Playoffs',
      'Phasen',
      'Insights',
      'Regeln',
      'Berichte',
    ]);
  });
});

// ─── Standings ────────────────────────────────────────────────────────────

describe('standings panel', () => {
  it('renders the season table in order with movement glyphs', () => {
    const rendered = renderHub({ panel: STANDINGS_PANEL });
    const { panel } = rendered;
    expect(squash(panel)).toContain('Season table: every phase combined.');
    const table = findOne(panel, tag('table'), 'standings table');
    expect(squash(findOne(table, tag('caption'), 'caption'))).toBe('Standings');
    // The Buchholz column shows the tiebreak the note names.
    expect(headerCells(table)).toEqual(['#', 'Trainer', 'Move', 'W', 'L', 'D', 'Buchholz', 'Pts']);
    const rows = bodyRows(table);
    expect(rows.map((row) => squash(findAll(row, tag('td'))[6]))).toEqual(['9', '12', '15.5', '0']);
    expect(rows.map((row) => squash(findOne(row, tag('a'), 'player link')))).toEqual(['Ash', 'Brock', 'Misty', 'Gary']);
    expect(rows.map((row) => findOne(row, tag('a'), 'player link').attrs.href)).toEqual([
      '/players/p1',
      '/players/p2',
      '/players/p3',
      '/players/p4',
    ]);
    // Rank, then movement column (third cell).
    expect(rows.map((row) => squash(findAll(row, tag('td'))[0]))).toEqual(['1', '2', '3', '4']);
    expect(rows.map((row) => squash(findAll(row, tag('td'))[2]))).toEqual(['▲2', '▼1', '–', '–']);
    expect(rows.map((row) => squash(findAll(row, tag('td')).at(-1) as HtmlElement))).toEqual(['9', '6', '3', '0']);
    // No advancement zone on the season table.
    expect(findAll(table, (el) => el.attrs['data-advancing'] === 'true')).toHaveLength(0);
    expectNoSection(rendered);
  });

  it('fills a missing gym band from the season participants', () => {
    const { panel } = renderHub({ panel: STANDINGS_PANEL });
    const ashRow = bodyRows(findOne(panel, tag('table'), 'table'))[0];
    expect(findAll(ashRow, (el) => el.tag === 'img' && el.attrs.alt === 'Fire type')).toHaveLength(1);
    const brockRow = bodyRows(findOne(panel, tag('table'), 'table'))[1];
    expect(findAll(brockRow, tag('img'))).toHaveLength(0);
  });

  it('adds the evolution-points column for EPB but never the tie marker on the season table (German)', () => {
    // The season table is computed without battle stats, so kill difference
    // cannot split a tie there: rows flagged needs_decision_match must not be
    // badged (the phase page may resolve them). Group tables do badge them.
    const epbRow = (id: string, points: number, ep: number, tie: boolean): LeagueStanding =>
      Object.assign(makeStanding(id, { points, wins: points / 3 }), { evolution_points: ep, needs_decision_match: tie });
    const { panel } = renderHub({
      locale: 'de',
      league: makeLeague({ format_type: 'evolution_point_buy' }),
      panel: {
        tab: 'standings',
        isEvolutionPointBuy: true,
        standings: [epbRow('p1', 9, 14, false), epbRow('p2', 6, 9, true), epbRow('p3', 6, 9, true)],
      },
    });
    expect(squash(panel)).toContain('Saisontabelle über alle Phasen.');
    const table = findOne(panel, tag('table'), 'table');
    expect(squash(findOne(table, tag('caption'), 'caption'))).toBe('Tabelle');
    // EP column, no kill difference column.
    expect(headerCells(table)).toEqual(['#', 'Spieler', 'Trend', 'S', 'N', 'U', 'EP', 'Pkt.']);
    const rows = bodyRows(table);
    expect(rows.map((row) => squash(findAll(row, tag('td'))[6]))).toEqual(['14', '9', '9']);
    expect(rows.map((row) => squash(row).includes('Gleichstand'))).toEqual([false, false, false]);
    expect(squash(table)).not.toContain('Gleichstand');
    // The trainer cell holds the profile link and nothing beside it.
    for (const row of rows) {
      const trainer = findAll(row, tag('td'))[1];
      expect(trainer.children.filter((c): c is HtmlElement => typeof c !== 'string').map((c) => c.tag)).toEqual(['a']);
    }
  });

  it('follows the season note with the season scoring sentence (en, not EPB)', () => {
    const { panel } = renderHub({ panel: STANDINGS_PANEL });
    const note = findAll(panel, tag('p'))[0];
    expect(squash(note)).toBe('Season table: every phase combined. 1 point per win, ½ per draw · Buchholz breaks ties.');
  });

  it('follows the season note with the EPB scoring sentence (de, EPB)', () => {
    const { panel } = renderHub({
      locale: 'de',
      league: makeLeague({ format_type: 'evolution_point_buy' }),
      panel: { ...STANDINGS_PANEL, isEvolutionPointBuy: true },
    });
    const note = findAll(panel, tag('p'))[0];
    expect(squash(note)).toBe(
      'Saisontabelle über alle Phasen. 3 Punkte pro Sieg, 1 pro Unentschieden · bei Gleichstand Kill-Differenz, dann Evolutionspunkte.',
    );
  });

  it.each([
    ['en', false],
    ['en', true],
    ['de', false],
    ['de', true],
  ] as const)('picks the season scoring sentence by format (%s, EPB %s), also above an empty table', (locale, epb) => {
    const copy = leagueHubCopy(locale);
    const [shown, hidden] = epb
      ? [copy.seasonEvolutionScoring, copy.seasonScoring]
      : [copy.seasonScoring, copy.seasonEvolutionScoring];
    for (const standings of [SEASON_ROWS, []]) {
      const { panel } = renderHub({
        locale,
        league: makeLeague({ format_type: epb ? 'evolution_point_buy' : 'singles' }),
        panel: { tab: 'standings', isEvolutionPointBuy: epb, standings },
      });
      const note = findAll(panel, tag('p'))[0];
      expect(squash(note)).toBe(`${copy.standingsNote} ${shown}`);
      expect(squash(panel)).not.toContain(hidden);
    }
  });

  it('hides the evolution column outside EPB', () => {
    const { panel } = renderHub({ panel: STANDINGS_PANEL });
    expect(headerCells(findOne(panel, tag('table'), 'table'))).not.toContain('EP');
  });

  it('shows the empty state instead of a table when nobody has played', () => {
    const en = renderHub({ panel: { tab: 'standings', standings: [], isEvolutionPointBuy: false } });
    expect(findAll(en.panel, tag('table'))).toHaveLength(0);
    expect(squash(en.panel)).toContain('No results yet.');
    const de = renderHub({ locale: 'de', panel: { tab: 'standings', standings: [], isEvolutionPointBuy: false } });
    expect(squash(de.panel)).toContain('Noch keine Ergebnisse.');
  });
});

// ─── Matches ──────────────────────────────────────────────────────────────

describe('matches panel', () => {
  const A = GROUP_STAGE.id;
  const roundOne: HubRoundMatches = {
    roundId: 'r1',
    name: 'Round 1',
    position: 1,
    status: 'completed',
    bracketSide: null,
    matches: [
      makeMatch('m1', {
        round_id: 'r1',
        tournament_id: A,
        player_1_id: 'p1',
        player_2_id: 'p2',
        status: 'completed',
        winner_id: 'p1',
        scheduled_at: '2026-03-12T18:00:00Z',
        games: [game(1, 'p1'), game(2, 'p2'), game(3, 'p1')],
      }),
      makeMatch('m2', {
        round_id: 'r1',
        tournament_id: A,
        player_1_id: 'p3',
        player_2_id: 'p4',
        status: 'completed',
        winner_id: 'p4',
        games: [game(1, 'p4'), game(2, 'p4')],
      }),
    ],
  };
  const roundTwo: HubRoundMatches = {
    roundId: 'r2',
    name: null,
    position: 2,
    status: 'active',
    bracketSide: null,
    matches: [
      makeMatch('m3', {
        round_id: 'r2',
        tournament_id: A,
        player_1_id: 'p1',
        player_2_id: 'p3',
        status: 'in_progress',
        games: [game(1, 'p3')],
      }),
      makeMatch('m4', { round_id: 'r2', tournament_id: A, player_1_id: 'p2', player_2_id: 'p4' }),
      makeMatch('m5', {
        round_id: 'r2',
        tournament_id: A,
        player_1_id: 'p5',
        player_2_id: 'p6',
        status: 'pending_confirmation',
        winner_id: 'p5',
        games: [game(1, 'p5'), game(2, 'p5')],
      }),
      makeMatch('m6', {
        round_id: 'r2',
        tournament_id: A,
        player_1_id: 'p7',
        player_2_id: 'p8',
        status: 'disputed',
        games: [game(1, 'p7'), game(2, 'p8')],
      }),
    ],
  };
  const roundThree: HubRoundMatches = {
    roundId: 'r3',
    name: 'Round 3',
    position: 3,
    status: 'pending',
    bracketSide: null,
    matches: [makeMatch('m7', { round_id: 'r3', tournament_id: A, player_1_id: 'p1', player_2_id: 'p4' })],
  };
  const doubleRounds: HubRoundMatches[] = [
    {
      roundId: 'd1',
      name: 'Round 2',
      position: 1,
      status: 'pending',
      bracketSide: 'losers',
      matches: [makeMatch('m8', { round_id: 'd1', tournament_id: DOUBLE_ELIM_STAGE.id, player_1_id: 'p2', player_2_id: 'p3' })],
    },
    {
      roundId: 'd2',
      name: 'Losers Final',
      position: 2,
      status: 'pending',
      bracketSide: 'losers',
      matches: [makeMatch('m9', { round_id: 'd2', tournament_id: DOUBLE_ELIM_STAGE.id, player_1_id: 'p2', player_2_id: 'p4' })],
    },
  ];
  const STAGES_MATCHES: HubStageMatches[] = [
    { stage: GROUP_STAGE, rounds: [roundOne, roundTwo, roundThree] },
    { stage: DOUBLE_ELIM_STAGE, rounds: doubleRounds },
    { stage: SWISS_STAGE, rounds: [] },
  ];

  function stageBlocks(panel: HtmlElement): HtmlElement[] {
    const wrapper = panel.children.find((c): c is HtmlElement => typeof c !== 'string');
    if (!wrapper) throw new Error('matches wrapper missing');
    return wrapper.children.filter((c): c is HtmlElement => typeof c !== 'string');
  }

  function rounds(block: HtmlElement): HtmlElement[] {
    return findAll(block, tag('details'));
  }

  function summaryLabel(details: HtmlElement): string {
    const summary = findOne(details, tag('summary'), 'summary');
    const label = summary.children.find((c): c is HtmlElement => typeof c !== 'string');
    return label ? squash(label).replace(/^›\s*/, '') : '';
  }

  function matchLink(rendered: Rendered, matchId: string): HtmlElement {
    return findOne(
      rendered.panel,
      (el) => el.tag === 'a' && (el.attrs.href ?? '').endsWith(`/matches/${matchId}`),
      `match link ${matchId}`,
    );
  }

  /** The centre cell of a match row: the score, or "vs" before any game has a winner. */
  function scoreOf(link: HtmlElement): string {
    const cells = link.children.filter((c): c is HtmlElement => typeof c !== 'string');
    return squash(cells[2]);
  }

  it('renders one block per phase with header and phase-page link', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const blocks = stageBlocks(rendered.panel);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => squash(findOne(b, tag('h4'), 'phase name')))).toEqual([
      'Group Stage',
      'Last Chance',
      'Swiss Stage',
    ]);
    const link = findOne(blocks[0], (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${A}`, 'phase link');
    expect(squash(link)).toBe('Open phase page →');
    expect(squash(blocks[0])).toContain('Round robin · Bo3');
    expect(squash(blocks[0])).toContain('In progress');
    expect(squash(blocks[1])).toContain('Double elimination · Bo3');
    expect(squash(blocks[1])).toContain('Upcoming');
    expectNoSection(rendered);
  });

  it('opens only the active round of a phase', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const groupRounds = rounds(stageBlocks(rendered.panel)[0]);
    expect(groupRounds.map(summaryLabel)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(groupRounds.map((d) => 'open' in d.attrs)).toEqual([false, true, false]);
    // Completed count and round status in the summary.
    const summaries = groupRounds.map((d) => squash(findOne(d, tag('summary'), 'summary')));
    expect(summaries[0]).toContain('2/2');
    expect(summaries[0]).toContain('Completed');
    expect(summaries[1]).toContain('0/4');
    expect(summaries[1]).toContain('Active');
    expect(summaries[2]).toContain('0/1');
    expect(summaries[2]).toContain('Pending');
  });

  it('opens the first round still to play when no round is active, else the last round', () => {
    const pendingOnly: HubStageMatches = {
      stage: GROUP_STAGE,
      rounds: [roundOne, { ...roundThree, status: 'pending' }],
    };
    const finished: HubStageMatches = {
      stage: GROUP_STAGE,
      rounds: [roundOne, { ...roundOne, roundId: 'r1b', name: 'Round 2', position: 2 }],
    };
    const open = renderHub({ panel: { tab: 'matches', stages: [pendingOnly] } });
    expect(rounds(open.panel).map((d) => 'open' in d.attrs)).toEqual([false, true]);
    const done = renderHub({ panel: { tab: 'matches', stages: [finished] } });
    expect(rounds(done.panel).map((d) => 'open' in d.attrs)).toEqual([false, true]);
  });

  it('labels bracket sides unless the round name already says it', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const sideRounds = rounds(stageBlocks(rendered.panel)[1]);
    expect(sideRounds.map(summaryLabel)).toEqual(['Losers · Round 2', 'Losers Final']);
  });

  it('does not state the bracket side twice in German when the round name already names it', () => {
    // Round rows carry the bracket engine's English names (bracket-structure.ts:
    // "Losers Round n", "Losers Finals", "Grand Finals"); the side prefix is
    // only for names that do not say which side they are on.
    const engineRounds: HubRoundMatches[] = [
      { ...doubleRounds[0], roundId: 'e1', name: 'Losers Round 1' },
      { ...doubleRounds[1], roundId: 'e2', name: 'Losers Finals' },
      { ...doubleRounds[1], roundId: 'e3', name: 'Grand Finals', bracketSide: 'grand_finals' },
    ];
    const en = renderHub({ panel: { tab: 'matches', stages: [{ stage: DOUBLE_ELIM_STAGE, rounds: engineRounds }] } });
    expect(rounds(en.panel).map(summaryLabel)).toEqual(['Losers Round 1', 'Losers Finals', 'Grand Finals']);
    const de = renderHub({
      locale: 'de',
      panel: { tab: 'matches', stages: [{ stage: DOUBLE_ELIM_STAGE, rounds: engineRounds }] },
    });
    const labels = rounds(de.panel).map(summaryLabel);
    // The engine's English names in German, each naming its side once.
    expect(labels).toEqual(['Verliererseite · Runde 1', 'Verliererseite · Finale', 'Großes Finale']);
  });

  it('never prefixes single elimination rounds, which the engine stores on the winners side', () => {
    const P = PLAYOFF_STAGE.id;
    const singleRounds: HubRoundMatches[] = [
      {
        roundId: 's1',
        name: 'Semifinals',
        position: 1,
        status: 'completed',
        bracketSide: 'winners',
        matches: [makeMatch('s1m', { round_id: 's1', tournament_id: P, player_1_id: 'p1', player_2_id: 'p4' })],
      },
      {
        roundId: 's2',
        name: 'Finals',
        position: 2,
        status: 'pending',
        bracketSide: 'winners',
        matches: [makeMatch('s2m', { round_id: 's2', tournament_id: P, player_1_id: 'p1', player_2_id: 'p2' })],
      },
    ];
    for (const [locale, names] of [
      ['en', ['Semifinals', 'Finals']],
      ['de', ['Halbfinale', 'Finale']],
    ] as const) {
      const rendered = renderHub({
        locale,
        panel: { tab: 'matches', stages: [{ stage: PLAYOFF_STAGE, rounds: singleRounds }] },
      });
      const labels = rounds(rendered.panel).map(summaryLabel);
      expect(labels).toEqual(names);
      const summaries = rounds(rendered.panel).map((d) => squash(findOne(d, tag('summary'), 'summary')));
      for (const summary of summaries) {
        expect(summary).not.toContain('Winners ·');
        expect(summary).not.toContain('Gewinnerseite');
      }
    }
  });

  it('keeps the side prefix in double elimination for winners rounds whose name does not say the side', () => {
    const D = DOUBLE_ELIM_STAGE.id;
    const winnersRounds: HubRoundMatches[] = [
      {
        roundId: 'w1',
        name: null,
        position: 1,
        status: 'completed',
        bracketSide: 'winners',
        matches: [makeMatch('w1m', { round_id: 'w1', tournament_id: D, player_1_id: 'p1', player_2_id: 'p4' })],
      },
      {
        roundId: 'w2',
        name: 'Semifinals',
        position: 2,
        status: 'active',
        bracketSide: 'winners',
        matches: [makeMatch('w2m', { round_id: 'w2', tournament_id: D, player_1_id: 'p1', player_2_id: 'p2' })],
      },
      {
        roundId: 'w3',
        name: 'Winners Final',
        position: 3,
        status: 'pending',
        bracketSide: 'winners',
        matches: [makeMatch('w3m', { round_id: 'w3', tournament_id: D, player_1_id: 'p1', player_2_id: 'p3' })],
      },
    ];
    const stages: HubStageMatches[] = [{ stage: DOUBLE_ELIM_STAGE, rounds: winnersRounds }];
    const en = renderHub({ panel: { tab: 'matches', stages } });
    expect(rounds(en.panel).map(summaryLabel)).toEqual(['Winners · Round 1', 'Winners · Semifinals', 'Winners Final']);
    const de = renderHub({ locale: 'de', panel: { tab: 'matches', stages } });
    expect(rounds(de.panel).map(summaryLabel)).toEqual([
      'Gewinnerseite · Runde 1',
      'Gewinnerseite · Halbfinale',
      'Gewinnerseite · Finale',
    ]);
  });

  it('shows "2 : 1" for a decided series and "vs" before any game has a winner', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    expect(scoreOf(matchLink(rendered, 'm1'))).toBe('2 : 1');
    expect(scoreOf(matchLink(rendered, 'm2'))).toBe('0 : 2');
    expect(scoreOf(matchLink(rendered, 'm3'))).toBe('0 : 1');
    expect(scoreOf(matchLink(rendered, 'm4'))).toBe('vs');
    expect(scoreOf(matchLink(rendered, 'm7'))).toBe('vs');
  });

  it('shows the outcome of a completed match that has no game rows, never "vs"', () => {
    // An admin-set result, a forfeit, or a result confirmed before the
    // replays were imported: completed with a winner, but no games to score.
    const noGames = (id: string, winner: string | null): MatchWithPlayers =>
      makeMatch(id, {
        round_id: 'r1',
        tournament_id: A,
        player_1_id: 'p1',
        player_2_id: 'p2',
        status: 'completed',
        winner_id: winner,
      });
    const stages: HubStageMatches[] = [
      {
        stage: GROUP_STAGE,
        rounds: [
          {
            roundId: 'r1',
            name: 'Round 1',
            position: 1,
            status: 'completed',
            bracketSide: null,
            matches: [noGames('w1', 'p1'), noGames('w2', 'p2'), noGames('w3', null)],
          },
        ],
      },
    ];
    const en = renderHub({ panel: { tab: 'matches', stages } });
    expect(['w1', 'w2', 'w3'].map((id) => scoreOf(matchLink(en, id)))).toEqual(['W : L', 'L : W', 'D : D']);
    const cell = matchLink(en, 'w1').children.filter((c): c is HtmlElement => typeof c !== 'string')[2];
    expect(cell.attrs.title).toBe('Result recorded without game reports');
    const de = renderHub({ locale: 'de', panel: { tab: 'matches', stages } });
    expect(['w1', 'w2', 'w3'].map((id) => scoreOf(matchLink(de, id)))).toEqual(['S : N', 'N : S', 'U : U']);
    // A scored match carries no such tooltip.
    const scored = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const scoredCell = matchLink(scored, 'm1').children.filter((c): c is HtmlElement => typeof c !== 'string')[2];
    expect('title' in scoredCell.attrs).toBe(false);
  });

  /** Asserts each part occurs in the text, in the given order. */
  function expectInOrder(text: string, parts: string[]): void {
    let from = 0;
    for (const part of parts) {
      const at = text.indexOf(part, from);
      expect(at, `"${part}" after position ${from} in "${text}"`).toBeGreaterThanOrEqual(0);
      from = at + part.length;
    }
  }

  it('links every match to its detail page, named by its visible text (no aria-label)', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const m1 = matchLink(rendered, 'm1');
    expect(m1.attrs.href).toBe(`/tournaments/${A}/matches/m1`);
    // An aria-label would replace the visible kickoff, score and status as the
    // link's accessible name; the row text is the name.
    expect('aria-label' in m1.attrs).toBe(false);
    expectInOrder(squash(m1), ['12 Mar, 18:00', 'Ash', '2 : 1', 'Brock', 'Completed']);
    const m4 = matchLink(rendered, 'm4');
    expect('aria-label' in m4.attrs).toBe(false);
    expectInOrder(squash(m4), ['Brock', 'vs', 'Gary', 'Scheduled']);
    expect(matchLink(rendered, 'm8').attrs.href).toBe(`/tournaments/${DOUBLE_ELIM_STAGE.id}/matches/m8`);
    const all = findAll(rendered.panel, (el) => el.tag === 'a' && /\/matches\//.test(el.attrs.href ?? ''));
    expect(all).toHaveLength(9);
    for (const link of all) expect('aria-label' in link.attrs).toBe(false);
    expect(rendered.html).not.toContain('aria-label="Ash');
  });

  it("prints the kickoff in the viewer's zone and the match status label", () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    expect(squash(matchLink(rendered, 'm1'))).toContain(formatKickoff('2026-03-12T18:00:00Z', 'en'));
    expect(formatKickoff('2026-03-12T18:00:00Z', 'en')).toBe('12 Mar, 18:00');
    // A <time> leaf with the machine-readable instant (the client re-renders it in the browser zone).
    const time = findOne(matchLink(rendered, 'm1'), tag('time'), 'kickoff time');
    expect(time.attrs.dateTime).toBe('2026-03-12T18:00:00.000Z');
    expect(squash(matchLink(rendered, 'm1'))).not.toContain('UTC');
    // Another viewer zone moves the clock (Europe/Berlin is UTC+1 in March).
    const berlin = parseMarkup(
      renderToStaticMarkup(
        withI18n(
          <LeagueHub
            league={makeLeague()}
            stages={STAGES}
            participants={PARTICIPANTS}
            locale="en"
            query={{}}
            tabs={availableLeagueHubTabs(STAGES, { reports: false })}
            activeTab="matches"
            panel={{ tab: 'matches', stages: STAGES_MATCHES }}
          />,
          { locale: 'en', timeZone: 'Europe/Berlin' },
        ),
      ),
    );
    const berlinM1 = findOne(berlin, (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${A}/matches/m1`, 'm1');
    expect(squash(berlinM1)).toContain('12 Mar, 19:00');
    const status = (id: string) => {
      const cells = matchLink(rendered, id).children.filter((c): c is HtmlElement => typeof c !== 'string');
      return squash(cells[4]);
    };
    // Unified enum wording (i18n-core §5.3): the hub's former "Final" / "Live".
    expect(status('m1')).toBe('Completed');
    expect(status('m3')).toBe('In progress');
    expect(status('m4')).toBe('Scheduled');
    expect(status('m5')).toBe('Awaiting confirmation');
    expect(status('m6')).toBe('Disputed');
  });

  it('says so when a phase has no matches yet, and when the league has no phases', () => {
    const rendered = renderHub({ panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const swiss = stageBlocks(rendered.panel)[2];
    expect(findAll(swiss, tag('details'))).toHaveLength(0);
    expect(squash(swiss)).toContain('No matches scheduled yet.');
    const empty = renderHub({ panel: { tab: 'matches', stages: [] } });
    expect(squash(empty.panel)).toBe('No phases configured yet.');
  });

  it('renders German round, score, status and link labels', () => {
    const rendered = renderHub({ locale: 'de', panel: { tab: 'matches', stages: STAGES_MATCHES } });
    const blocks = stageBlocks(rendered.panel);
    expect(rounds(blocks[0]).map(summaryLabel)).toEqual(['Runde 1', 'Runde 2', 'Runde 3']);
    expect(rounds(blocks[1]).map(summaryLabel)[0]).toBe('Verliererseite · Runde 2');
    expect(scoreOf(matchLink(rendered, 'm4'))).toBe('vs.');
    const m1 = matchLink(rendered, 'm1');
    expect('aria-label' in m1.attrs).toBe(false);
    expectInOrder(squash(m1), [formatKickoff('2026-03-12T18:00:00Z', 'de'), 'Ash', '2 : 1', 'Brock', 'Beendet']);
    const m4 = matchLink(rendered, 'm4');
    expect('aria-label' in m4.attrs).toBe(false);
    expectInOrder(squash(m4), ['Brock', 'vs.', 'Gary', 'Angesetzt']);
    expect(rendered.html).not.toContain('aria-label="Ash gegen');
    expect(squash(blocks[0])).toContain('Jeder gegen jeden · Bo3');
    expect(squash(blocks[0])).toContain('Zur Phasenseite');
    expect(squash(blocks[2])).toContain('Noch keine Spiele angesetzt.');
    expect(squash(matchLink(rendered, 'm1'))).toContain('Beendet');
    expect(squash(matchLink(rendered, 'm1'))).toContain(formatKickoff('2026-03-12T18:00:00Z', 'de'));
  });
});

// ─── Groups ───────────────────────────────────────────────────────────────

describe('groups panel', () => {
  function groupTable(key: string, name: string | null, ids: string[], advanceCount: number | null): HubGroupTable {
    const standings: Standing[] = ids.map((id, index) =>
      makeStanding(id, {
        wins: ids.length - index,
        points: 3 * (ids.length - index),
        kill_differential: 4 - index,
        games_played: 7 + index,
      }),
    );
    return {
      key,
      name,
      standings,
      members: ids.map((id) => ({ id, name: NAMES[id] })),
      matches: [
        makeMatch(`${key}-m1`, {
          round_id: 'gr1',
          tournament_id: GROUP_STAGE.id,
          player_1_id: ids[0],
          player_2_id: ids[1],
          status: 'completed',
          winner_id: ids[0],
        }),
      ],
      advanceCount,
    };
  }

  const GROUPED: HubTableStage = {
    stage: GROUP_STAGE,
    scoring: 'round_robin',
    advancementRule: GROUP_STAGE.advancement_rule,
    tables: [
      groupTable('group-a', 'Group A', ['p1', 'p2', 'p3', 'p4'], 2),
      groupTable('group-b', 'Group B', ['p5', 'p6', 'p7', 'p8'], 2),
    ],
  };
  const SWISS: HubTableStage = {
    stage: SWISS_STAGE,
    scoring: 'swiss',
    advancementRule: SWISS_STAGE.advancement_rule,
    tables: [
      {
        ...groupTable('stage-swiss', null, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], 4),
        standings: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => makeStanding(id, { points: 6 - i, buchholz: 10 - i })),
      },
    ],
  };

  it('renders one standings table per group, with its name and caption', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const tables = standingsTables(rendered.panel);
    expect(tables).toHaveLength(3);
    expect(tables.map((t) => squash(findOne(t, tag('caption'), 'caption')))).toEqual([
      'Group Stage · Group A',
      'Group Stage · Group B',
      'Swiss Stage',
    ]);
    expect(findAll(rendered.panel, tag('h5')).map(squash)).toEqual(['Group A', 'Group B']);
    expect(bodyRows(tables[0]).map((r) => squash(findOne(r, tag('a'), 'player')))).toEqual(['Ash', 'Brock', 'Misty', 'Gary']);
    expect(bodyRows(tables[1]).map((r) => squash(findOne(r, tag('a'), 'player')))).toEqual([
      'Dawn',
      'Iris',
      'Cynthia',
      'Lance',
    ]);
    expectNoSection(rendered);
  });

  it('marks exactly advanceCount rows per table as advancing, from the top', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const tables = standingsTables(rendered.panel);
    const advancing = tables.map((t) => bodyRows(t).map((r) => r.attrs['data-advancing'] === 'true'));
    expect(advancing).toEqual([
      [true, true, false, false],
      [true, true, false, false],
      [true, true, true, true, false, false],
    ]);
  });

  it('marks no rows when the table has no advancement count', () => {
    const noRule: HubTableStage = { ...GROUPED, tables: GROUPED.tables.map((t) => ({ ...t, advanceCount: null })) };
    const rendered = renderHub({ panel: { tab: 'groups', stages: [noRule], isEvolutionPointBuy: false } });
    expect(findAll(rendered.panel, (el) => el.attrs['data-advancing'] === 'true')).toHaveLength(0);
  });

  it('states the scoring and the advancement rule in each phase header', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const text = squash(rendered.panel);
    expect(text).toContain('Round robin · 3 points per win · kill difference breaks ties · Top 2 per group advance');
    expect(text).toContain('Swiss · 1 point per win, ½ per draw · Buchholz breaks ties · Top 4 overall advance');
    expect(
      findAll(rendered.panel, (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${GROUP_STAGE.id}`),
    ).toHaveLength(1);
  });

  it('omits the advancement text when the phase has no rule', () => {
    const noRule: HubTableStage = { ...SWISS, stage: { ...SWISS_STAGE, advancement_rule: null }, advancementRule: null };
    const rendered = renderHub({ panel: { tab: 'groups', stages: [noRule], isEvolutionPointBuy: false } });
    expect(squash(rendered.panel)).not.toContain('advance');
  });

  it('shows a results grid only for round robin tables', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const grids = findAll(rendered.panel, (el) => el.tag === 'details' && squash(el).includes('Results grid'));
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(findAll(grid, tag('table'))).toHaveLength(1);
      expect('open' in grid.attrs).toBe(false);
    }
    // The grid of group A lists group A's members only.
    const gridA = findOne(grids[0], tag('thead'), 'grid head');
    expect(squash(gridA)).toContain('Ash');
    expect(squash(gridA)).not.toContain('Dawn');
  });

  it('picks the columns by scoring: games and kill diff for round robin, Buchholz for Swiss', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const [groupA, , swiss] = standingsTables(rendered.panel);
    expect(headerCells(groupA)).toEqual(['#', 'Trainer', 'Games', 'W', 'L', 'D', 'Kill diff', 'Pts']);
    expect(headerCells(swiss)).toEqual(['#', 'Trainer', 'W', 'L', 'D', 'Buchholz', 'Pts']);
    expect(squash(findAll(bodyRows(groupA)[0], tag('td'))[6])).toBe('+4');
  });

  it('shows games and kill difference values on round robin tables outside EPB', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED], isEvolutionPointBuy: false } });
    for (const table of standingsTables(rendered.panel)) {
      const rows = bodyRows(table);
      // Columns: #, Trainer, Games, W, L, D, Kill diff, Pts.
      expect(rows.map((row) => squash(findAll(row, tag('td'))[2]))).toEqual(['7', '8', '9', '10']);
      expect(rows.map((row) => squash(findAll(row, tag('td'))[6]))).toEqual(['+4', '+3', '+2', '+1']);
      expect(headerCells(table)).not.toContain('EP');
      expect(headerCells(table)).not.toContain('Buchholz');
    }
  });

  // ─── EPB group tables ───

  /** An EPB row: evolution points and the decision-match flag ride on the standing. */
  function epbStanding(row: Standing, ep: number, tie: boolean): Standing {
    return Object.assign({ ...row }, { evolution_points: ep, needs_decision_match: tie });
  }

  /** Flags the 2nd and 3rd rows of every table as needing a decision match. */
  function withEpb(stage: HubTableStage): HubTableStage {
    return {
      ...stage,
      tables: stage.tables.map((table) => ({
        ...table,
        standings: table.standings.map((row, index) => epbStanding(row, 20 - index, index === 1 || index === 2)),
      })),
    };
  }

  const EPB_GROUPED = withEpb(GROUPED);
  const EPB_SWISS = withEpb(SWISS);
  const EPB_LEAGUE = makeLeague({ format_type: 'evolution_point_buy' });

  function trainerBadges(row: HtmlElement, label: string): HtmlElement[] {
    const trainer = findAll(row, tag('td'))[1];
    return findAll(trainer, (el) => el.tag === 'span' && squash(el) === label);
  }

  it('shows evolution points instead of games for EPB', () => {
    const rendered = renderHub({
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [GROUPED], isEvolutionPointBuy: true },
    });
    const [groupA] = standingsTables(rendered.panel);
    expect(headerCells(groupA)).toEqual(['#', 'Trainer', 'W', 'L', 'D', 'EP', 'Kill diff', 'Pts']);
  });

  it('EPB tables: EP everywhere, kill difference on round robin only, no games or Buchholz column', () => {
    const rendered = renderHub({
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: true },
    });
    const [groupA, groupB, swiss] = standingsTables(rendered.panel);
    for (const table of [groupA, groupB]) {
      expect(headerCells(table)).toEqual(['#', 'Trainer', 'W', 'L', 'D', 'EP', 'Kill diff', 'Pts']);
      expect(bodyRows(table).map((row) => squash(findAll(row, tag('td'))[5]))).toEqual(['20', '19', '18', '17']);
    }
    expect(headerCells(swiss)).toEqual(['#', 'Trainer', 'W', 'L', 'D', 'EP', 'Pts']);
    expect(headerCells(swiss)).not.toContain('Buchholz');
    expect(bodyRows(swiss).map((row) => squash(findAll(row, tag('td'))[5]))).toEqual([
      '20',
      '19',
      '18',
      '17',
      '16',
      '15',
    ]);
  });

  it('states the EPB scoring in every phase header, round robin and Swiss alike', () => {
    const rendered = renderHub({
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: true },
    });
    const text = squash(rendered.panel);
    expect(text).toContain(
      'Round robin · 3 points per win, 1 per draw · kill difference, then evolution points, then head-to-head · Top 2 per group advance',
    );
    expect(text).toContain(
      'Swiss · 3 points per win, 1 per draw · kill difference, then evolution points, then head-to-head · Top 4 overall advance',
    );
    expect(text).not.toContain('kill difference breaks ties');
    expect(text).not.toContain('Buchholz breaks ties');
    const de = renderHub({
      locale: 'de',
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: true },
    });
    const deText = squash(de.panel);
    expect(deText).toContain(
      'Jeder gegen jeden · 3 Punkte pro Sieg, 1 pro Unentschieden · Kill-Differenz, dann Evolutionspunkte, dann direkter Vergleich · Top 2 je Gruppe kommen weiter',
    );
    expect(deText).toContain(
      'Schweizer System · 3 Punkte pro Sieg, 1 pro Unentschieden · Kill-Differenz, dann Evolutionspunkte, dann direkter Vergleich · Top 4 gesamt kommen weiter',
    );
    expect(deText).not.toContain('Buchholz bei Gleichstand');
  });

  it('marks EPB decision-match ties in round robin group tables only', () => {
    const rendered = renderHub({
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: true },
    });
    const [groupA, groupB, swiss] = standingsTables(rendered.panel);
    for (const table of [groupA, groupB]) {
      expect(bodyRows(table).map((row) => trainerBadges(row, 'Tie').length)).toEqual([0, 1, 1, 0]);
    }
    // Swiss tables carry no battle stats, so kill difference cannot split a tie there.
    expect(bodyRows(swiss).map((row) => trainerBadges(row, 'Tie').length)).toEqual([0, 0, 0, 0, 0, 0]);

    const de = renderHub({
      locale: 'de',
      league: EPB_LEAGUE,
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: true },
    });
    const [deGroupA, , deSwiss] = standingsTables(de.panel);
    expect(bodyRows(deGroupA).map((row) => trainerBadges(row, 'Gleichstand').length)).toEqual([0, 1, 1, 0]);
    expect(squash(deSwiss)).not.toContain('Gleichstand');
  });

  it('never marks ties outside EPB, even on rows that carry the flag', () => {
    const rendered = renderHub({
      panel: { tab: 'groups', stages: [EPB_GROUPED, EPB_SWISS], isEvolutionPointBuy: false },
    });
    for (const table of standingsTables(rendered.panel)) {
      expect(bodyRows(table).every((row) => trainerBadges(row, 'Tie').length === 0)).toBe(true);
      expect(headerCells(table)).not.toContain('EP');
    }
  });

  it('lays the tables out in a grid whose track and cards can shrink below their content', () => {
    const rendered = renderHub({ panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false } });
    const grids = findAll(rendered.panel, (el) => el.tag === 'div' && classList(el).includes('grid'));
    expect(grids).toHaveLength(2);
    for (const grid of grids) {
      expect(classList(grid)).toContain('grid-cols-[minmax(0,1fr)]');
      const cards = grid.children.filter((c): c is HtmlElement => typeof c !== 'string');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(classList(card)).toContain('min-w-0');
        expect(standingsTables(card)).toHaveLength(1);
      }
    }
    // Two columns from xl only where a phase has more than one table.
    const [grouped, swiss] = grids;
    expect(classList(grouped)).toContain('xl:grid-cols-2');
    expect(grouped.children.filter((c) => typeof c !== 'string')).toHaveLength(2);
    expect(classList(swiss)).not.toContain('xl:grid-cols-2');
  });

  it('says so when a phase has nobody enrolled, and when the league has no table phase', () => {
    const empty: HubTableStage = { stage: GROUP_STAGE, scoring: 'round_robin', advancementRule: null, tables: [] };
    const rendered = renderHub({ panel: { tab: 'groups', stages: [empty], isEvolutionPointBuy: false } });
    expect(squash(rendered.panel)).toContain('No players enrolled in this phase yet.');
    expect(findAll(rendered.panel, tag('table'))).toHaveLength(0);
    const none = renderHub({ panel: { tab: 'groups', stages: [], isEvolutionPointBuy: false } });
    expect(squash(none.panel)).toBe('This league has no table phase yet.');
  });

  it('renders German labels', () => {
    const rendered = renderHub({
      locale: 'de',
      panel: { tab: 'groups', stages: [GROUPED, SWISS], isEvolutionPointBuy: false },
    });
    const text = squash(rendered.panel);
    expect(text).toContain(
      'Jeder gegen jeden · 3 Punkte pro Sieg · Kill-Differenz bei Gleichstand · Top 2 je Gruppe kommen weiter',
    );
    expect(text).toContain(
      'Schweizer System · 1 Punkt pro Sieg, ½ pro Unentschieden · Buchholz bei Gleichstand · Top 4 gesamt kommen weiter',
    );
    expect(text).toContain('Ergebnismatrix');
    expect(text).toContain('Zur Phasenseite');
    const [groupA] = standingsTables(rendered.panel);
    expect(headerCells(groupA)).toEqual(['#', 'Spieler', 'Spiele', 'S', 'N', 'U', 'Kill-Diff.', 'Pkt.']);
    const none = renderHub({ locale: 'de', panel: { tab: 'groups', stages: [], isEvolutionPointBuy: false } });
    expect(squash(none.panel)).toBe('Diese Liga hat noch keine Tabellenphase.');
  });
});

// ─── Playoffs ─────────────────────────────────────────────────────────────

describe('playoffs panel', () => {
  const P = PLAYOFF_STAGE.id;
  const seeds: PublicTournamentParticipant[] = ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({
    id,
    name: NAMES[id],
    avatar_url: null,
    seed: index + 1,
    starting_bracket: 'winners',
  }));
  const bracket: HubBracketStage = {
    stage: PLAYOFF_STAGE,
    rounds: [
      makeRound({ id: 'pr2', tournament_id: P, name: 'Finals', round_number: 2, bracket_side: 'winners' }),
      makeRound({ id: 'pr1', tournament_id: P, name: 'Semifinals', round_number: 1, bracket_side: 'winners', status: 'active' }),
    ],
    matches: [
      makeMatch('sf1', {
        round_id: 'pr1',
        tournament_id: P,
        player_1_id: 'p1',
        player_2_id: 'p4',
        status: 'completed',
        winner_id: 'p1',
        bracket_side: 'winners',
        bracket_pos: 0,
        games: [game(1, 'p1'), game(2, 'p1'), game(3, 'p1')],
      }),
      makeMatch('sf2', {
        round_id: 'pr1',
        tournament_id: P,
        player_1_id: 'p2',
        player_2_id: 'p3',
        bracket_side: 'winners',
        bracket_pos: 1,
      }),
    ],
    participants: seeds,
  };
  const pending: HubBracketStage = { stage: DOUBLE_ELIM_STAGE, rounds: [], matches: [], participants: [seeds[0]] };

  it('draws the bracket of a phase with rounds: round names, match cards, feeder labels', () => {
    const rendered = renderHub({ panel: { tab: 'playoffs', stages: [bracket] } });
    const text = squash(rendered.panel);
    const headings = findAll(rendered.panel, tag('h3')).map(squash);
    expect(headings).toEqual(['Semifinals', 'Finals']);
    expect(
      findAll(rendered.panel, (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${P}/matches/sf1`),
    ).toHaveLength(1);
    expect(
      findAll(rendered.panel, (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${P}/matches/sf2`),
    ).toHaveLength(1);
    // The unplayed final is a slot skeleton fed by both semifinals.
    expect(text).toContain('Winner of M1');
    expect(text).toContain('Winner of M2');
    expect(text).toContain('Single elimination · Bo5 · 4 players');
    expect(
      findAll(rendered.panel, (el) => el.tag === 'a' && el.attrs.href === `/tournaments/${P}`),
    ).toHaveLength(1);
    expectNoSection(rendered);
  });

  it('shows the pending notice for a phase without rounds', () => {
    const rendered = renderHub({ panel: { tab: 'playoffs', stages: [bracket, pending] } });
    expect(squash(rendered.panel)).toContain('The bracket appears once the pairings are generated.');
    expect(squash(rendered.panel)).toContain('Double elimination · Bo3 · 1 player');
    const de = renderHub({ locale: 'de', panel: { tab: 'playoffs', stages: [pending] } });
    expect(squash(de.panel)).toContain('Der Turnierbaum erscheint, sobald die Paarungen stehen.');
    expect(squash(de.panel)).toContain('Doppel-K.-o. · Bo3 · 1 Spieler');
  });

  it('says so when the league has no playoff phase', () => {
    const rendered = renderHub({ panel: { tab: 'playoffs', stages: [] } });
    expect(squash(rendered.panel)).toBe('This league has no playoff phase yet.');
  });
});

// ─── Phases ───────────────────────────────────────────────────────────────

describe('phases panel', () => {
  const groups: TournamentGroupWithMembers[] = [
    {
      id: 'grp-a',
      tournament_id: GROUP_STAGE.id,
      name: 'Group A',
      group_number: 1,
      created_at: STAMP,
      updated_at: STAMP,
      members: [
        { player_id: 'p1', player_name: 'Ash', seed: 1, gym_type: 'Fire' },
        { player_id: 'p2', player_name: 'Brock', seed: 0, gym_type: null },
      ],
    },
    {
      id: 'grp-b',
      tournament_id: GROUP_STAGE.id,
      name: 'Group B',
      group_number: 2,
      created_at: STAMP,
      updated_at: STAMP,
      members: [],
    },
  ];
  const PHASES: HubPhase[] = [
    { stage: GROUP_STAGE, groups, showAdvancement: true },
    { stage: PLAYOFF_STAGE, groups: [], showAdvancement: false },
    { stage: { ...DOUBLE_ELIM_STAGE, status: 'completed' }, groups: [], showAdvancement: false },
  ];

  function cards(panel: HtmlElement): HtmlElement[] {
    const list = findOne(panel, tag('ol'), 'phase list');
    return list.children.filter((c): c is HtmlElement => typeof c !== 'string');
  }

  it('lists one numbered card per phase, in order, each opening the phase page', () => {
    const rendered = renderHub({ panel: { tab: 'phases', phases: PHASES } });
    const items = cards(rendered.panel);
    expect(items).toHaveLength(3);
    const titles = items.map((li) => findAll(li, tag('p'))[0]);
    expect(titles.map((p) => squash(findOne(p, tag('span'), 'phase number')))).toEqual(['1.', '2.', '3.']);
    expect(titles.map(squash)).toEqual(['1.Group Stage', '2.Playoffs', '3.Last Chance']);
    expect(items.map((li) => findOne(li, tag('a'), 'card link').attrs.href)).toEqual([
      `/tournaments/${GROUP_STAGE.id}`,
      `/tournaments/${PLAYOFF_STAGE.id}`,
      `/tournaments/${DOUBLE_ELIM_STAGE.id}`,
    ]);
    expectNoSection(rendered);
  });

  it('shows format, best-of, players, status and advancement per card', () => {
    const rendered = renderHub({ panel: { tab: 'phases', phases: PHASES } });
    const [group, playoff, last] = cards(rendered.panel).map(squash);
    expect(group).toContain('Round robin · Bo3 · 8 players');
    expect(group).toContain('In progress');
    expect(group).toContain('Top 2 per group advance');
    expect(playoff).toContain('Single elimination · Bo5 · 4 players');
    expect(playoff).toContain('Upcoming');
    expect(playoff).not.toContain('advance');
    expect(last).toContain('Double elimination · Bo3 · 1 player');
    expect(last).toContain('Completed');
  });

  it('prints no advancement line where the loader says the phase shows none (final or knockout phase)', () => {
    const rule = { type: 'top_n' as const, count: 4, per_group: false };
    const rendered = renderHub({
      panel: {
        tab: 'phases',
        phases: [
          { stage: { ...GROUP_STAGE, advancement_rule: rule }, groups: [], showAdvancement: true },
          { stage: { ...PLAYOFF_STAGE, advancement_rule: rule }, groups: [], showAdvancement: false },
        ],
      },
    });
    const [group, playoff] = cards(rendered.panel).map(squash);
    expect(group).toContain('Top 4 overall advance');
    expect(playoff).not.toContain('advance');
  });

  it('lists group members with their seed, and says when a group is empty', () => {
    const rendered = renderHub({ panel: { tab: 'phases', phases: PHASES } });
    const [group] = cards(rendered.panel);
    const members = findAll(group, tag('li')).map(squash);
    expect(members).toEqual(['#1Ash', 'Brock']);
    expect(squash(group)).toContain('Group A');
    expect(squash(group)).toContain('Group B');
    expect(squash(group)).toContain('No members');
    expect(findAll(group, (el) => el.tag === 'img' && el.attrs.alt === 'Fire type')).toHaveLength(1);
  });

  it('renders German labels and the empty state', () => {
    const rendered = renderHub({ locale: 'de', panel: { tab: 'phases', phases: PHASES } });
    const [group] = cards(rendered.panel).map(squash);
    expect(group).toContain('Jeder gegen jeden · Bo3 · 8 Spieler');
    expect(group).toContain('Top 2 je Gruppe kommen weiter');
    expect(group).toContain('Keine Mitglieder');
    const empty = renderHub({ panel: { tab: 'phases', phases: [] } });
    expect(squash(empty.panel)).toBe('No phases configured yet.');
  });
});

// ─── Insights ─────────────────────────────────────────────────────────────

describe('insights panel', () => {
  it('links to the full league insights and renders the scoped usage view', () => {
    const rendered = renderHub({
      panel: {
        tab: 'insights',
        isDoubles: false,
        killRanking: [],
        usageRows: [
          {
            pokemon_name: 'Garchomp',
            usage_percent: 50,
            total_appearances: 4,
            total_games: 8,
            kos_dealt: 6,
            koed_rate: 0.25,
            efficiency: 1.5,
            bring_rate: null,
            lead_rate: null,
            win_rate: null,
          },
        ],
      },
    });
    const link = findOne(
      rendered.panel,
      (el) => el.tag === 'a' && el.attrs.href === `/insights?scope=league&id=${LEAGUE_ID}&tab=usage`,
      'insights link',
    );
    expect(squash(link)).toBe('Full insights →');
    const text = squash(rendered.panel);
    expect(text).toContain('Pokémon usage, kill ranking and move usage across every phase.');
    expect(text).toContain('Pokémon Usage');
    expect(text).toContain('Garchomp');
    expectNoSection(rendered);
  });

  it('renders the German note and link label', () => {
    const rendered = renderHub({
      locale: 'de',
      panel: { tab: 'insights', usageRows: [], killRanking: [], isDoubles: false },
    });
    const link = findOne(
      rendered.panel,
      (el) => el.tag === 'a' && el.attrs.href === `/insights?scope=league&id=${LEAGUE_ID}&tab=usage`,
      'insights link',
    );
    expect(squash(link)).toBe('Alle Insights →');
    expect(squash(rendered.panel)).toContain('Pokémon-Nutzung, Kill-Rangliste und Attacken über alle Phasen.');
  });

  it("labels the insights table's pagination in the world's language", () => {
    const usageRows = [
      {
        pokemon_name: 'Garchomp',
        usage_percent: 50,
        total_appearances: 4,
        total_games: 8,
        kos_dealt: 6,
        koed_rate: 0.25,
        efficiency: 1.5,
        bring_rate: null,
        lead_rate: null,
        win_rate: null,
      },
    ];
    const panel = { tab: 'insights' as const, usageRows, killRanking: [], isDoubles: false };
    const ariaLabels = (root: HtmlElement) =>
      findAll(root, (el) => 'aria-label' in el.attrs).map((el) => el.attrs['aria-label']);

    const de = renderHub({ locale: 'de', panel }).panel;
    const deText = squash(de);
    expect(deText).toContain('1–1 von 1');
    expect(deText).toContain('Zeilen');
    expect(ariaLabels(de)).toEqual(
      expect.arrayContaining(['Zeilen pro Seite', 'Seitennavigation', 'Vorherige Seite', 'Nächste Seite', 'Seite 1']),
    );
    for (const english of ['Showing', 'Rows']) expect(deText).not.toContain(english);
    expect(ariaLabels(de)).not.toContain('Previous page');

    const en = renderHub({ panel }).panel;
    expect(squash(en)).toContain('Showing 1–1 of 1');
    expect(ariaLabels(en)).toEqual(
      expect.arrayContaining(['Rows per page', 'Pagination', 'Previous page', 'Next page', 'Page 1']),
    );
  });
});

// ─── Rules ────────────────────────────────────────────────────────────────

describe('rules panel', () => {
  const CORES: CoreTriple = ['Fire', 'Water', 'Grass'];

  it('shows the league description when it has text', () => {
    const rendered = renderHub({
      league: makeLeague({ description: 'Weekly games, Sunday deadline.' }),
      panel: { tab: 'rules', ruleset: null },
    });
    const text = squash(rendered.panel);
    expect(text).toContain('About this league');
    expect(text).toContain('Weekly games, Sunday deadline.');
  });

  it('hides the description block when the description is blank', () => {
    const rendered = renderHub({ league: makeLeague({ description: '   ' }), panel: { tab: 'rules', ruleset: null } });
    expect(squash(rendered.panel)).not.toContain('About this league');
  });

  it('says "No ruleset assigned." without a ruleset', () => {
    const rendered = renderHub({ panel: { tab: 'rules', ruleset: null } });
    const text = squash(rendered.panel);
    expect(text).toContain('Ruleset');
    expect(text).toContain('No ruleset assigned.');
    expectNoSection(rendered);
    const de = renderHub({ locale: 'de', panel: { tab: 'rules', ruleset: null } });
    expect(squash(de.panel)).toContain('Kein Regelwerk zugewiesen.');
  });

  it('renders the ruleset detail under a "Ruleset · <name>" heading', () => {
    const ruleset = makeRuleset({
      clauses: ['Species Clause', 'Sleep Clause Mod'],
      bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] },
    });
    const rendered = renderHub({ panel: { tab: 'rules', ruleset } });
    const text = squash(rendered.panel);
    expect(findAll(rendered.panel, tag('h4')).map(squash)).toContain('Ruleset · Spring OU Rules');
    expect(text).toContain(getFormatName('gen9ou'));
    expect(text).toContain('Species Clause');
    expect(text).toContain('Sleep Clause Mod');
    expect(text).toContain('Koraidon');
    expect(text).not.toContain('No ruleset assigned.');
  });

  it('adds no <section> for a ruleset with content (route-live CSS sizes every world <section> to 100vh)', () => {
    const ruleset = makeRuleset({
      clauses: ['Species Clause'],
      bans: { pokemon: ['Koraidon'], moves: ['Baton Pass'], items: [], abilities: [] },
      custom_rules_string: 'No legendaries.',
    });
    expectNoSection(renderHub({ panel: { tab: 'rules', ruleset } }));
  });

  it('prints custom rules on the themed surface, wrapping and keeping line breaks', () => {
    const custom = 'No legendaries.\nItem clause: one of each.';
    const rendered = renderHub({ panel: { tab: 'rules', ruleset: makeRuleset({ custom_rules_string: custom }) } });
    const pre = findOne(rendered.panel, tag('pre'), 'custom rules');
    const classes = classList(pre);
    expect(classes).toEqual(
      expect.arrayContaining(['bg-poke-elevated', 'text-poke-text-primary', 'border-poke-border', 'whitespace-pre-wrap']),
    );
    expect(classes).not.toContain('bg-gray-800');
    expect(classes.filter((c) => /(^|:)(bg|text)-gray-/.test(c))).toEqual([]);
    expect(textOf(pre)).toBe(custom);
    expect(squash(rendered.panel)).toContain('Custom Rules');
  });

  it('gives every ruleset chip a light and a dark colour', () => {
    const ruleset = makeRuleset({
      is_doubles: true,
      clauses: ['Species Clause'],
      bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] },
      additions: { pokemon: ['Pikachu'] },
      min_shared_type_pct: 50,
    });
    const rendered = renderHub({ panel: { tab: 'rules', ruleset } });
    const chip = (text: string) =>
      findOne(rendered.panel, (el) => el.tag === 'span' && squash(el).startsWith(text), `chip ${text}`);
    const expected: [string, string][] = [
      [getFormatName('gen9ou'), 'indigo'],
      ['Doubles', 'purple'],
      ['Species Clause', 'blue'],
      ['Koraidon', 'red'],
      ['Pikachu', 'green'],
      ['50% of team', 'yellow'],
    ];
    for (const [text, colour] of expected) {
      expect(classList(chip(text))).toEqual(
        expect.arrayContaining([
          `bg-${colour}-100`,
          `text-${colour}-800`,
          `dark:bg-${colour}-900/30`,
          `dark:text-${colour}-400`,
        ]),
      );
    }
    expectNoSection(rendered);
  });

  it('shows the Core Liga block for a type-core format when participants have cores', () => {
    const participants = [makeParticipant('p1', { core_types: CORES }), makeParticipant('p2')];
    const rendered = renderHub({ participants, panel: { tab: 'rules', ruleset: null } });
    const text = squash(rendered.panel);
    expect(text).toContain('Core Liga assignments');
    expect(text).toContain('Ash');
    expect(findAll(rendered.panel, (el) => el.tag === 'img' && el.attrs.alt === 'Water type')).toHaveLength(1);
  });

  it('hides the Core Liga block when no participant has a core', () => {
    const rendered = renderHub({ panel: { tab: 'rules', ruleset: null } });
    expect(squash(rendered.panel)).not.toContain('Core Liga');
  });

  it('never shows the Core Liga block for EPB, which has no type cores', () => {
    const participants = [makeParticipant('p1', { core_types: CORES })];
    const rendered = renderHub({
      participants,
      league: makeLeague({ format_type: 'evolution_point_buy' }),
      panel: { tab: 'rules', ruleset: null },
    });
    expect(squash(rendered.panel)).not.toContain('Core Liga');
  });

  it('links the format rules plaque only for EPB', () => {
    const epb = renderHub({
      locale: 'de',
      league: makeLeague({ format_type: 'evolution_point_buy' }),
      panel: { tab: 'rules', ruleset: null },
    });
    const link = findOne(epb.panel, (el) => el.tag === 'a' && el.attrs.href === '#rules', 'format rules link');
    expect(squash(link)).toBe('Formatregeln');
    for (const format of ['singles', 'doubles', 'draft'] as const) {
      const other = renderHub({ league: makeLeague({ format_type: format }), panel: { tab: 'rules', ruleset: null } });
      expect(findAll(other.panel, (el) => el.tag === 'a' && el.attrs.href === '#rules')).toHaveLength(0);
      expect(squash(other.panel)).not.toContain('Format rules');
    }
  });
});

// ─── Reports ──────────────────────────────────────────────────────────────

describe('reports panel', () => {
  const tabs = availableLeagueHubTabs(STAGES, { reports: true });

  it('shows the empty notice when no phase has a report', () => {
    const rendered = renderHub({
      tabs,
      panel: { tab: 'reports', reports: [{ stage: GROUP_STAGE, reports: [] }, { stage: PLAYOFF_STAGE, reports: [] }] },
    });
    expect(squash(rendered.panel)).toBe('No reports yet.');
    const de = renderHub({ tabs, locale: 'de', panel: { tab: 'reports', reports: [] } });
    expect(squash(de.panel)).toBe('Noch keine Berichte.');
  });

  it('groups reports by phase, newest first, skipping phases without reports', () => {
    const rendered = renderHub({
      tabs,
      panel: {
        tab: 'reports',
        reports: [
          {
            stage: GROUP_STAGE,
            reports: [
              makeReport('rep-old', 'Round 1: Ash starts strong', '2026-03-10T10:00:00Z', GROUP_STAGE.id),
              makeReport('rep-new', 'Round 2: Brock bounces back', '2026-03-17T10:00:00Z', GROUP_STAGE.id),
              makeReport('rep-mid', 'Preview: Round 2', '2026-03-12T10:00:00Z', GROUP_STAGE.id),
            ],
          },
          { stage: SWISS_STAGE, reports: [] },
        ],
      },
    });
    expect(findAll(rendered.panel, tag('h4')).map(squash)).toEqual(['Group Stage']);
    const text = squash(rendered.panel);
    const order = ['Round 2: Brock bounces back', 'Preview: Round 2', 'Round 1: Ash starts strong'].map((h) =>
      text.indexOf(h),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('Swiss Stage');
    expectNoSection(rendered);
  });
});

// ─── Every panel, every locale: no <section> ─────────────────────────────

describe('hub markup inside the world', () => {
  const PANELS: LeagueHubPanelData[] = [
    STANDINGS_PANEL,
    { tab: 'matches', stages: [] },
    { tab: 'groups', stages: [], isEvolutionPointBuy: false },
    { tab: 'playoffs', stages: [] },
    { tab: 'phases', phases: [] },
    { tab: 'insights', usageRows: [], killRanking: [], isDoubles: true },
    { tab: 'rules', ruleset: null },
    { tab: 'reports', reports: [] },
  ];

  it.each(PANELS.flatMap((panel) => (['en', 'de'] as Locale[]).map((locale) => [panel.tab, locale, panel] as const)))(
    'renders the %s tab (%s) without a <section> and with exactly one active tab',
    (_tab, locale, panel) => {
      const tabs = availableLeagueHubTabs(STAGES, { reports: true });
      const rendered = renderHub({ locale, tabs, panel });
      expectNoSection(rendered);
      expect(tabLinks(rendered.hub).filter((a) => a.attrs['aria-current'] === 'page')).toHaveLength(1);
      expect(rendered.hub.attrs['data-league-hub']).toBe(panel.tab);
      // Copy comes from the locale's table, never the other one.
      expect(squash(findOne(rendered.hub, withId('league-hub-heading'), 'heading'))).toBe(
        leagueHubCopy(locale).heading,
      );
    },
  );
});

// ─── PR #65 test-pass follow-ups ──────────────────────────────────────────

describe('anchor landing and the tab strip', () => {
  it('clears the sticky navs when #league-hub is the anchor target', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    expect(classList(hub)).toContain('scroll-mt-24');
  });

  it('marks the tab strip and keeps the active-tab scroller inside the tab nav', () => {
    const { hub } = renderHub({ panel: STANDINGS_PANEL });
    const nav = navOf(hub);
    expect(findAll(nav, (el) => el.tag === 'ul' && 'data-hub-tab-strip' in el.attrs)).toHaveLength(1);
    // The scroller's marker: an empty hidden span, so the nav adds no visible text.
    const markers = nav.children.filter(
      (c): c is HtmlElement => typeof c !== 'string' && c.tag === 'span' && 'hidden' in c.attrs,
    );
    expect(markers).toHaveLength(1);
    expect(textOf(markers[0])).toBe('');
  });
});

describe('a tab whose reads failed', () => {
  it.each(['en', 'de'] as const)('shows a notice in the panel and keeps the hub (%s)', (locale) => {
    const tabs = availableLeagueHubTabs(STAGES, { reports: false });
    const rendered = renderHub({ locale, tabs, panel: { tab: 'unavailable', requested: 'groups' } });
    const notice = findOne(rendered.panel, (el) => el.attrs['data-hub-unavailable'] === 'groups', 'notice');
    expect(squash(notice)).toBe(leagueHubCopy(locale).tabUnavailable);
    // The requested tab stays the active one; the rest of the hub renders.
    expect(rendered.hub.attrs['data-league-hub']).toBe('groups');
    const active = tabLinks(rendered.hub).filter((a) => a.attrs['aria-current'] === 'page');
    expect(active.map((a) => a.attrs['data-hub-tab'])).toEqual(['groups']);
    expectNoSection(rendered);
  });
});

describe('German plaza: the shared components the hub embeds', () => {
  const P = PLAYOFF_STAGE.id;
  const seeds: PublicTournamentParticipant[] = ['p1', 'p2', 'p3', 'p4'].map((id, index) => ({
    id,
    name: NAMES[id],
    avatar_url: null,
    seed: index + 1,
    starting_bracket: 'winners',
  }));
  const bracket: HubBracketStage = {
    stage: PLAYOFF_STAGE,
    rounds: [
      makeRound({ id: 'pr2', tournament_id: P, name: 'Finals', round_number: 2, bracket_side: 'winners' }),
      makeRound({ id: 'pr1', tournament_id: P, name: 'Semifinals', round_number: 1, bracket_side: 'winners' }),
    ],
    matches: [
      makeMatch('sf1', {
        round_id: 'pr1',
        tournament_id: P,
        player_1_id: 'p1',
        player_2_id: 'p4',
        status: 'completed',
        winner_id: 'p1',
        bracket_side: 'winners',
        bracket_pos: 0,
        games: [game(1, 'p1'), game(2, 'p1')],
      }),
    ],
    participants: seeds,
  };

  it('draws the bracket in German: round names, feeder labels, status chips', () => {
    const de = renderHub({ locale: 'de', panel: { tab: 'playoffs', stages: [bracket] } });
    const text = squash(de.panel);
    expect(findAll(de.panel, tag('h3')).map(squash)).toEqual(['Halbfinale', 'Finale']);
    expect(text).toContain('Sieger aus M1');
    expect(text).toContain('Beendet');
    for (const english of ['Semifinals', 'Finals', 'Winner of', 'Completed', 'TBD']) expect(text).not.toContain(english);
  });

  it('keeps the English bracket exactly as the phase page draws it', () => {
    const en = renderHub({ panel: { tab: 'playoffs', stages: [bracket] } });
    const text = squash(en.panel);
    expect(findAll(en.panel, tag('h3')).map(squash)).toEqual(['Semifinals', 'Finals']);
    expect(text).toContain('Winner of M1');
    expect(text).toContain('Completed');
  });

  it('labels the results grid in German, in the table letters', () => {
    const G = GROUP_STAGE.id;
    const table: HubTableStage = {
      stage: GROUP_STAGE,
      scoring: 'round_robin',
      advancementRule: null,
      tables: [
        {
          key: 'g',
          name: null,
          standings: [makeStanding('p1'), makeStanding('p2')],
          members: [
            { id: 'p1', name: 'Ash' },
            { id: 'p2', name: 'Brock' },
          ],
          matches: [
            makeMatch('rr1', {
              round_id: 'r1',
              tournament_id: G,
              player_1_id: 'p1',
              player_2_id: 'p2',
              status: 'completed',
              winner_id: 'p1',
            }),
          ],
          advanceCount: null,
        },
      ],
    };
    const gridOf = (rendered: Rendered) =>
      findOne(rendered.panel, (el) => el.tag === 'details' && /Results grid|Ergebnismatrix/.test(squash(el)), 'grid');
    const de = gridOf(renderHub({ locale: 'de', panel: { tab: 'groups', stages: [table], isEvolutionPointBuy: false } }));
    expect(squash(findAll(de, tag('th'))[0])).toBe('Spieler');
    expect(findAll(de, tag('td')).map(squash)).toEqual(['Ash', '—', 'S', 'Brock', 'N', '—']);
    const en = gridOf(renderHub({ panel: { tab: 'groups', stages: [table], isEvolutionPointBuy: false } }));
    expect(squash(findAll(en, tag('th'))[0])).toBe('Player');
    expect(findAll(en, tag('td')).map(squash)).toEqual(['Ash', '—', 'W', 'Brock', 'L', '—']);
  });

  it('labels the ruleset and the Core Liga block in German, English unchanged', () => {
    const ruleset = makeRuleset({
      clauses: ['Species Clause'],
      bans: { pokemon: ['Koraidon'], moves: ['Baton Pass'], items: ['Choice Band', 'Kings Rock'], abilities: [] },
    });
    const participants = [makeParticipant('p1', { core_types: ['Fire', 'Water', 'Grass'] })];
    const de = squash(renderHub({ locale: 'de', participants, panel: { tab: 'rules', ruleset } }).panel);
    for (const label of ['Klauseln', 'Gebannte Pokémon (1)', 'Gebannte Attacken (1)', 'Gebannte Items (2)', 'Core-Liga-Typen']) {
      expect(de).toContain(label);
    }
    for (const english of ['Clauses', 'Banned', 'Core Liga assignments']) expect(de).not.toContain(english);
    const en = squash(renderHub({ participants, panel: { tab: 'rules', ruleset } }).panel);
    for (const label of ['Clauses', 'Banned Pokémon (1)', 'Banned Moves (1)', 'Banned Items (2)', 'Core Liga assignments']) {
      expect(en).toContain(label);
    }
  });

  it('labels the insights view in German', () => {
    const panel: LeagueHubPanelData = {
      tab: 'insights',
      isDoubles: false,
      killRanking: [
        {
          pokemon_name: 'Garchomp',
          kos_dealt: 3,
          times_koed: 1,
          kill_differential: 2,
          participations: 2,
          times_in_team: 3,
          efficiency: 1.5,
        },
      ],
      usageRows: [
        {
          pokemon_name: 'Garchomp',
          usage_percent: 50,
          total_appearances: 3,
          total_games: 6,
          kos_dealt: 3,
          koed_rate: 0.25,
          efficiency: 1.5,
          bring_rate: null,
          lead_rate: null,
          win_rate: null,
        },
      ],
    };
    const de = squash(renderHub({ locale: 'de', panel }).panel);
    for (const label of ['Pokémon-Nutzung', 'Kill-Rangliste', 'Attacken-Nutzung', 'Nutzung %', 'Im Team']) {
      expect(de).toContain(label);
    }
    for (const english of ['Pokémon Usage', 'Move Usage', 'Usage%', 'Battles']) expect(de).not.toContain(english);
    const en = squash(renderHub({ panel }).panel);
    expect(en).toContain('Pokémon Usage');
    // The usage table's count of games on a team reads "Teams" (as in the
    // kill ranking), never the ambiguous "Battles".
    expect(en).toContain('Teams');
    expect(en).not.toContain('Battles');
  });
});

describe('groups panel: advancement shown only where the loader allows it', () => {
  it('prints no advancement line or zone when the phase shows no rule', () => {
    const table: HubTableStage = {
      stage: GROUP_STAGE,
      scoring: 'round_robin',
      advancementRule: null,
      tables: [
        {
          key: 'g',
          name: null,
          standings: [makeStanding('p1'), makeStanding('p2'), makeStanding('p3')],
          members: [],
          matches: [],
          advanceCount: null,
        },
      ],
    };
    // GROUP_STAGE stores a rule; the hub still prints none for this phase.
    expect(GROUP_STAGE.advancement_rule).not.toBeNull();
    const rendered = renderHub({ panel: { tab: 'groups', stages: [table], isEvolutionPointBuy: false } });
    expect(squash(rendered.panel)).not.toContain('advance');
    expect(findAll(rendered.panel, (el) => el.attrs['data-advancing'] === 'true')).toHaveLength(0);
  });
});
