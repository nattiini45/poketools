/**
 * AdminMatchFilters (server render): the bar renders the URL state it is given. The client-only
 * behaviour (fetches, the pickers' searches, clicks) needs a DOM and is not rendered here; the
 * state transitions it relies on are the pure helpers of `src/lib/admin/__tests__/match-list.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

import AdminMatchFilters, { type AdminMatchFiltersProps } from '../AdminMatchFilters';
import { EMPTY_MATCH_LIST_STATE, type MatchListUrlState } from '@/lib/admin/match-list';
import type { AdminMatchFilterOptions } from '@/lib/supabase/queries/matches';

const LEAGUE = '11111111-1111-4111-8111-111111111111';
const PHASE = '22222222-2222-4222-8222-222222222222';
const ROUND = '33333333-3333-4333-8333-333333333333';
const RULESET = '44444444-4444-4444-8444-444444444444';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const OPTIONS: AdminMatchFilterOptions = {
  leagues: [
    {
      id: LEAGUE,
      name: 'Spring League',
      status: 'active',
      archived: false,
      is_test_season: false,
      phases: [{ id: PHASE, name: 'Group Stage', stage_order: 0, archived: false, ruleset_id: RULESET }],
    },
  ],
  tournaments: [],
  rulesets: [{ id: RULESET, name: 'Gen 9 OU' }],
};

function state(overrides: Partial<MatchListUrlState> = {}): MatchListUrlState {
  return { ...EMPTY_MATCH_LIST_STATE, ...overrides };
}

function props(url: MatchListUrlState, overrides: Partial<AdminMatchFiltersProps> = {}): AdminMatchFiltersProps {
  return {
    url,
    update: vi.fn(),
    searchInput: url.q,
    onSearchChange: vi.fn(),
    options: OPTIONS,
    optionsFailed: false,
    rounds: [
      { id: ROUND, name: 'Round 2', round_number: 2, bracket_side: null },
      { id: '55555555-5555-4555-8555-555555555555', name: '', round_number: 9, bracket_side: null },
    ],
    roundsPending: false,
    playerNames: {},
    playersPending: false,
    ...overrides,
  };
}

const render = (url: MatchListUrlState, overrides: Partial<AdminMatchFiltersProps> = {}, locale: 'en' | 'de' = 'en') =>
  renderWithI18n(<AdminMatchFilters {...props(url, overrides)} />, { locale });

/** The opening `<select ...>` tag with this aria-label. */
function selectTag(html: string, label: string): string {
  const tag = new RegExp(`<select[^>]*aria-label="${label}"[^>]*>`).exec(html);
  if (!tag) throw new Error(`no select labelled ${label}`);
  return tag[0];
}

const removeLabels = (html: string) => [...html.matchAll(/aria-label="(Remove filter: [^"]*|Filter entfernen: [^"]*)"/g)].map((m) => m[1]);

describe('AdminMatchFilters: the always-visible bar', () => {
  it('renders the search box, League, Phase, Round, status tabs, quick filters and sort', () => {
    const html = render(state());
    expect(html).toContain('aria-label="Search matches"');
    for (const label of ['League', 'Phase', 'Round']) expect(selectTag(html, label)).toContain('<select');
    for (const label of ['All', 'Scheduled', 'In Progress', 'Pending', 'Completed', 'Disputed']) {
      expect(html).toContain(`>${label}</button>`);
    }
    for (const label of [
      'Awaiting confirmation',
      'Auto-confirms within 24 h',
      'Stale in progress (3+ days)',
      'Overdue',
    ]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('>Sort</span>');
    expect(html).toContain('<option value="created_desc" selected="">Newest first</option>');
    expect(html).toContain('aria-label="Match filters"');
  });

  it('disables the Round select without a phase and enables it with one', () => {
    expect(selectTag(render(state()), 'Round')).toContain('disabled=""');
    expect(selectTag(render(state({ league: LEAGUE })), 'Round')).toContain('disabled=""');
    expect(selectTag(render(state({ league: LEAGUE, phase: PHASE })), 'Round')).not.toContain('disabled=""');
  });

  it('lists the rounds of the phase, translated, with the round number for an unnamed one', () => {
    const html = render(state({ league: LEAGUE, phase: PHASE }));
    expect(html).toContain('>All rounds</option>');
    expect(html).toContain(`<option value="${ROUND}">Round 2</option>`);
    expect(html).toContain('>Round 9</option>');
    const german = render(state({ league: LEAGUE, phase: PHASE }), {}, 'de');
    expect(german).toContain(`<option value="${ROUND}">Runde 2</option>`);
    expect(german).toContain('>Alle Runden</option>');
  });

  it('keeps a deep-linked round selected under a neutral label until the rounds load', () => {
    const url = state({ league: LEAGUE, phase: PHASE, round: ROUND });
    const loading = render(url, { rounds: null, roundsPending: true });
    expect(loading).toContain(`<option value="${ROUND}" selected="">Loading...</option>`);
    expect(loading).not.toContain(`>${ROUND}</option>`);
    const loaded = render(url);
    expect(loaded).toContain(`<option value="${ROUND}" selected="">Round 2</option>`);
  });

  it('presses the quick filter named by the URL, and only that one', () => {
    const html = render(state({ preset: 'overdue' }));
    // The same preset is a toggle in the quick-filter row and in the Date group.
    expect(html.match(/aria-pressed="true"[^>]*>Overdue<\/button>/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Awaiting confirmation<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Auto-confirms within 24 h<\/button>/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All<\/button>/);
  });
});

describe('AdminMatchFilters: the More filters panel', () => {
  it('is collapsed on first render, with the panel wired to its button', () => {
    const html = render(state());
    const button = /<button[^>]*aria-expanded="false"[^>]*>More filters/.exec(html)?.[0];
    expect(button).toBeDefined();
    const controls = /aria-controls="([^"]+)"/.exec(button ?? '')?.[1];
    expect(controls).toBeTruthy();
    expect(html).toMatch(new RegExp(`<div id="${controls}" hidden="" class="hidden">`));
  });

  it('shows no count when nothing inside it is active', () => {
    expect(render(state({ status: 'disputed', preset: 'overdue', q: 'mara' }))).toContain('More filters<');
  });

  it('counts the active filters inside the panel (not the ones on the bar)', () => {
    const url = state({
      status: 'disputed',
      format: 'draft',
      replay: 'has',
      showTest: true,
      player: P1,
      player2: P2,
      range: 'today',
    });
    // date, format, player (with its opponent), replay, showTest.
    expect(render(url, { playerNames: { [P1]: 'Mara', [P2]: 'Joel' } })).toContain('More filters (5)');
    expect(render(url, { playerNames: { [P1]: 'Mara', [P2]: 'Joel' } }, 'de')).toContain('Weitere Filter (5)');
  });

  it('holds the Date, Format, Player, Content and Visibility groups with labelled controls', () => {
    const html = render(state());
    for (const legend of ['Date', 'Format', 'Player', 'Content', 'Visibility']) {
      expect(html).toMatch(new RegExp(`<fieldset[^>]*><legend[^>]*>${legend}</legend>`));
    }
    for (const label of [
      'Date field',
      'From',
      'To',
      'League format',
      'Bracket type',
      'Best of',
      'Ruleset',
      'Replay',
    ]) {
      expect(html).toMatch(new RegExp(`<label[^>]*><span[^>]*>${label}</span>`));
    }
    for (const label of ['Hand-edited stats', 'Has admin notes', 'No games recorded', 'Show test leagues', 'Show archived leagues and tournaments']) {
      expect(html).toMatch(new RegExp(`<label[^>]*><input type="checkbox"[^>]*/><span>${label}</span></label>`));
    }
    for (const label of ['Today', 'Next 7 days', 'Last 7 days', 'No date set']) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('>Player</label>');
  });

  it('lists the league formats, bracket types, best-of choices and the rulesets in scope', () => {
    const html = render(state());
    for (const label of ['Singles', 'Doubles', 'Draft', 'Evolution Point Buy']) expect(html).toContain(`>${label}</option>`);
    for (const label of ['Single elimination', 'Double elimination', 'Round robin', 'Swiss']) {
      expect(html).toContain(`>${label}</option>`);
    }
    for (const label of ['Bo1', 'Bo3', 'Bo5']) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain(`<option value="${RULESET}">Gen 9 OU</option>`);
  });

  it('keeps a deep-linked best-of outside 1 / 3 / 5 selectable', () => {
    expect(render(state({ bestOf: 7 }))).toContain('<option value="7" selected="">Bo7</option>');
    expect(render(state({ bestOf: 3 }))).not.toContain('value="7"');
  });

  it('disables the format select for standalone tournaments', () => {
    /** The opening tag of the select whose first option is "Any format". */
    const formatSelect = (url: MatchListUrlState) =>
      /<select[^>]*>(?=<option value=""(?: selected="")?>Any format<\/option>)/.exec(render(url))?.[0] ?? '';
    expect(formatSelect(state({ league: 'standalone' }))).toContain('disabled=""');
    expect(formatSelect(state())).not.toContain('disabled=""');
    expect(formatSelect(state())).toContain('<select');
  });

  it('shows the second player picker only once a first player is picked', () => {
    expect(render(state())).not.toContain('Head-to-head opponent');
    const html = render(state({ player: P1 }), { playerNames: { [P1]: 'Mara' } });
    expect(html).toContain('Head-to-head opponent');
    expect(html).toContain('value="Mara"');
  });

  it('disables the pickers and says why when nothing in scope can anchor the search', () => {
    const none = render(state({ player: P1 }), {
      options: { leagues: [], tournaments: [], rulesets: [] },
      playerNames: { [P1]: 'Mara' },
    });
    expect(none).toContain('No leagues or tournaments in your scope to search from.');
    expect(none.match(/role="combobox"[^>]*disabled=""/g)).toHaveLength(2);
    // While the options load there is no verdict yet.
    expect(render(state(), { options: null })).not.toContain('No leagues or tournaments in your scope');
    expect(render(state())).not.toContain('No leagues or tournaments in your scope');
  });
});

describe('AdminMatchFilters: the standalone league option', () => {
  const STANDALONE_OPTION = 'No league (standalone)';
  const withTournaments: AdminMatchFilterOptions = {
    ...OPTIONS,
    tournaments: [
      { id: '66666666-6666-4666-8666-666666666666', name: 'Open Cup', status: 'active', archived: false, ruleset_id: RULESET },
    ],
  };

  it('is offered while the options load and when the scope has a standalone tournament', () => {
    expect(render(state(), { options: null })).toContain(STANDALONE_OPTION);
    expect(render(state(), { options: withTournaments })).toContain(STANDALONE_OPTION);
  });

  it('is not offered when no standalone tournament is in scope', () => {
    expect(render(state())).not.toContain(STANDALONE_OPTION);
  });

  it('stays while it is the selected league', () => {
    expect(render(state({ league: 'standalone' }))).toContain(STANDALONE_OPTION);
  });
});

describe('AdminMatchFilters: the date inputs', () => {
  it('give the full date room: an auto-fit grid and a narrow side padding', () => {
    const html = render(state({ from: '2026-10-20', to: '2026-10-31' }));
    expect(html).toContain('grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]');
    const inputs = [...html.matchAll(/<input[^>]*type="date"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input).toContain('px-2');
      expect(input).not.toContain('px-3');
    }
  });
});

describe('AdminMatchFilters: active filter chips', () => {
  const FULL = state({
    status: 'disputed',
    league: LEAGUE,
    phase: PHASE,
    round: ROUND,
    q: 'mara',
    format: 'draft',
    bracket: 'swiss',
    bestOf: 3,
    ruleset: RULESET,
    replay: 'has',
    edited: true,
    notes: true,
    showTest: true,
    showArchived: true,
  });

  it('renders one removable chip per active filter, plus Clear all', () => {
    const html = render(FULL);
    const labels = removeLabels(html);
    expect(labels).toEqual([
      'Remove filter: Disputed',
      'Remove filter: League: Spring League',
      'Remove filter: Phase: Group Stage',
      'Remove filter: Round: Round 2',
      'Remove filter: Search: mara',
      'Remove filter: League format: Draft',
      'Remove filter: Bracket type: Swiss',
      'Remove filter: Best of: Bo3',
      'Remove filter: Ruleset: Gen 9 OU',
      'Remove filter: Replay: Has replay',
      'Remove filter: Hand-edited stats',
      'Remove filter: Has admin notes',
      'Remove filter: Show test leagues',
      'Remove filter: Show archived leagues and tournaments',
    ]);
    expect(html).toContain('role="group" aria-label="Active filters"');
    expect(html).toContain('>Clear all</button>');
  });

  it('labels the preset, the date, the head-to-head and an unresolved player', () => {
    const preset = render(state({ preset: 'stale_in_progress' }));
    expect(removeLabels(preset)).toEqual(['Remove filter: Stale in progress (3+ days)']);

    const range = render(state({ range: 'next7', dateField: 'played' }));
    expect(removeLabels(range)).toEqual(['Remove filter: Played: Next 7 days']);

    const days = render(state({ from: '2026-10-01', to: '2026-10-08' }));
    expect(removeLabels(days)[0]).toMatch(/^Remove filter: Scheduled: .*2026.* – .*2026/);
    expect(removeLabels(render(state({ from: '2026-10-01' })))[0]).toMatch(/^Remove filter: Scheduled from .*2026/);
    expect(removeLabels(render(state({ to: '2026-10-08' })))[0]).toMatch(/^Remove filter: Scheduled until .*2026/);

    // Head-to-head is one chip: removing it clears both players.
    const h2h = render(state({ player: P1, player2: P2 }), { playerNames: { [P1]: 'Mara', [P2]: 'Joel' } });
    expect(removeLabels(h2h)).toEqual(['Remove filter: Mara vs Joel']);
    expect(removeLabels(render(state({ player: P1 }), { playerNames: { [P1]: 'Mara' } }))).toEqual([
      'Remove filter: Player: Mara',
    ]);
    // A player the response did not resolve: neutral while loading, then "unknown" (never the id).
    expect(removeLabels(render(state({ player: P1 }), { playersPending: true }))).toEqual(['Remove filter: Player: Loading...']);
    expect(removeLabels(render(state({ player: P1 })))).toEqual(['Remove filter: Player: Unknown player']);
  });

  it('uses a neutral label for a deep-linked league the options do not contain yet', () => {
    const html = render(state({ league: LEAGUE }), { options: null });
    expect(removeLabels(html)).toEqual(['Remove filter: League: Loading...']);
    expect(removeLabels(render(state({ league: LEAGUE }), { options: null, optionsFailed: true }))).toEqual([
      `Remove filter: League: ${LEAGUE}`,
    ]);
  });

  it('never shows the id of a phase the options do not contain', () => {
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const url = state({ league: LEAGUE, phase: other });
    expect(removeLabels(render(url, { options: null }))).toEqual([
      'Remove filter: League: Loading...',
      'Remove filter: Phase: Loading...',
    ]);
    for (const overrides of [{}, { options: null, optionsFailed: true }]) {
      const html = render(url, overrides);
      expect(html).not.toMatch(new RegExp(`>[^<]*${other}`));
      expect(removeLabels(html).at(-1)).toBe('Remove filter: Phase: Unavailable');
    }
    expect(removeLabels(render(url, {}, 'de')).at(-1)).toBe('Filter entfernen: Phase: Nicht verfügbar');
  });

  it('labels a league the loaded options do not contain as unavailable, not by its id', () => {
    const html = render(state({ league: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }));
    expect(removeLabels(html)).toEqual(['Remove filter: League: Unavailable']);
    expect(html).not.toMatch(/>[^<]*eeeeeeee-eeee/);
  });

  it('renders no chips and no Clear all when nothing is active (the sort and page are not filters)', () => {
    for (const url of [state(), state({ sort: 'status_priority', page: 3 })]) {
      const html = render(url);
      expect(html).not.toContain('Active filters');
      expect(html).not.toContain('Clear all');
      expect(html).not.toContain('Remove filter');
    }
  });
});

describe('AdminMatchFilters: German', () => {
  it('is translated with real umlauts', () => {
    const html = render(state({ preset: 'overdue', format: 'draft' }), {}, 'de');
    expect(html).toContain('Weitere Filter');
    expect(html).toContain('>Überfällig</button>');
    expect(html).toContain('Alle zurücksetzen');
    expect(html).toContain('Filter entfernen: Überfällig');
    expect(html).toContain('Filter entfernen: Liga-Format: Draft');
    expect(html).toContain('Spielfilter');
    expect(html).toContain('>Sortierung</span>');
    expect(html).toContain('Handlungsbedarf zuerst');
    expect(html).not.toMatch(/\u00c3|\u00e2\u20ac|\\u00/);
  });
});
