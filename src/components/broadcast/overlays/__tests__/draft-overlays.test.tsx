/**
 * Broadcast draft overlays (draft-frontend §3.5, §8.4, DF9).
 *
 * - The overlay language comes from `resolveOverlayLocale`: `?lang=` beats the
 *   league language and the viewer cookie is never read.
 * - Line labels go through `localizeLineLabel`.
 * - Polling uses chained timeouts (`createVisiblePoller`), never a bare `setInterval`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isValidElement, type ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { localizeLineLabel } from '@/lib/pkmn/i18n/names/species';
import { snapshot, DAWN, MISTY } from '@/lib/draft-ui/__tests__/fixtures';

const { resolveContentLocale, cookies, getDraftPoolById, seasonRow, pointBuyEntries } = vi.hoisted(() => ({
  resolveContentLocale: vi.fn(),
  cookies: vi.fn(),
  getDraftPoolById: vi.fn(),
  seasonRow: vi.fn(),
  pointBuyEntries: vi.fn(),
}));

vi.mock('@/i18n/content-locale', () => ({ resolveContentLocale }));
// Any cookie read would go through next/headers; the spy proves there is none.
vi.mock('next/headers', () => ({ cookies, headers: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById }));
vi.mock('@/lib/cache/public-reads', () => ({ publicReads: { seasonRow, pointBuyEntries } }));

import DraftViewerPage from '@/app/(broadcast)/broadcast/draft/[did]/live/page';
import DraftPickRevealPage from '@/app/(broadcast)/broadcast/draft/[did]/pick/page';
import DraftReplayPage from '@/app/(broadcast)/broadcast/draft/[did]/replay/page';
import { loadDraftOverlayContext } from '@/app/(broadcast)/broadcast/draft/[did]/overlay-context';
import { DraftViewerBoard, overlayLineLabel, toOverlayBoard, type OverlayLines } from '../DraftViewer';
import { DraftPickRevealCard } from '../DraftPickReveal';

const LINES: OverlayLines = {
  'gastly--gengar': ['Gastly', 'Gengar'],
  'teddiursa--ursalunabloodmoon': ['Teddiursa', 'Ursaluna-Bloodmoon'],
};

const BOUND_LINES: OverlayLines = {
  'gastly--gengar': ['Gastly', 'Gengar'],
  'growlithe--arcanine': ['Growlithe', 'Arcanine'],
  tauros: ['Tauros', null],
};

const ENTRY_BASE = {
  id: 'e2',
  list_version_id: 'list-1',
  line_number: 2,
  price: 28,
  stage2_pokemon: 'Haunter',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveContentLocale.mockResolvedValue('de');
  cookies.mockImplementation(() => {
    throw new Error('overlays must never read the language cookie');
  });
  getDraftPoolById.mockResolvedValue({ id: 'pool-1', season_id: 'season-1', list_version_id: 'list-1' });
  seasonRow.mockResolvedValue({ id: 'season-1', point_buy_list_id: 'list-1' });
  pointBuyEntries.mockResolvedValue([
    { ...ENTRY_BASE, line_id: 'gastly--gengar', base_pokemon: 'Gastly', stage3_pokemon: 'Gengar' },
    {
      ...ENTRY_BASE,
      id: 'e3',
      line_number: 3,
      line_id: 'growlithe--arcanine',
      base_pokemon: 'Growlithe',
      stage2_pokemon: 'Arcanine',
      stage3_pokemon: null,
    },
    {
      ...ENTRY_BASE,
      id: 'e4',
      line_number: 4,
      line_id: 'tauros',
      base_pokemon: 'Tauros',
      stage2_pokemon: null,
      stage3_pokemon: null,
    },
  ]);
});

type ShellProps = { locale?: string; children: ReactElement<{ lines?: OverlayLines }> };

function shellOf(el: unknown): ShellProps {
  if (!isValidElement(el)) throw new Error('page did not return an element');
  return el.props as ShellProps;
}

const params = (did = 'pool-1') => Promise.resolve({ did });

describe('overlay locale (resolveOverlayLocale + nested provider)', () => {
  it('?lang=en beats the league language de', async () => {
    const shell = shellOf(await DraftViewerPage({ params: params(), searchParams: Promise.resolve({ lang: 'en' }) }));
    expect(shell.locale).toBe('en');
    expect(resolveContentLocale).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it('without ?lang= the overlay follows the pool’s league language', async () => {
    resolveContentLocale.mockResolvedValue('de');
    for (const Page of [DraftViewerPage, DraftPickRevealPage, DraftReplayPage]) {
      const shell = shellOf(await Page({ params: params(), searchParams: Promise.resolve({}) }));
      expect(shell.locale).toBe('de');
    }
    expect(resolveContentLocale).toHaveBeenCalledWith({ seasonId: 'season-1' });
    expect(cookies).not.toHaveBeenCalled();
  });

  it('an unknown pool falls back to the default content language and never throws', async () => {
    getDraftPoolById.mockRejectedValue(new Error('invalid input syntax for type uuid'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = await loadDraftOverlayContext('nope', {});
    expect(ctx.locale).toBe('de');
    expect(ctx.lines).toEqual({});
    spy.mockRestore();
  });

  it('passes the bound list lines as [base, final stage] (stage 3, else stage 2) to the overlay', async () => {
    const shell = shellOf(await DraftViewerPage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(shell.children.props.lines).toEqual(BOUND_LINES);
    // The real builder feeds the label: a two-stage line reads base → stage 2.
    expect(overlayLineLabel('growlithe--arcanine', 'Growlithe', shell.children.props.lines ?? {}, 'en').label).toBe(
      'Growlithe → Arcanine',
    );
    expect(seasonRow).not.toHaveBeenCalled();
  });

  it('the replay overlay passes the bound list lines too, so replay picks are labelled as lines', async () => {
    const shell = shellOf(await DraftReplayPage({ params: params(), searchParams: Promise.resolve({}) }));
    expect(pointBuyEntries).toHaveBeenCalledWith('list-1');
    expect(shell.children.props.lines).toEqual(BOUND_LINES);
  });
});

describe('line labels via localizeLineLabel', () => {
  it('a two-stage line is labelled base → final stage (stage 2) through the pkmn layer', () => {
    const lines: OverlayLines = { 'oshawott--samurott': ['Oshawott', 'Samurott'] };
    expect(overlayLineLabel('oshawott--samurott', 'Oshawott', lines, 'de')).toEqual({
      label: localizeLineLabel('Oshawott', 'Samurott', 'de'),
      sprite: 'Oshawott',
    });
    expect(overlayLineLabel('oshawott--samurott', 'Oshawott', lines, 'en').label).toBe('Oshawott → Samurott');
    // Without a known line the pick's species is localized.
    expect(overlayLineLabel(null, 'Gastly', lines, 'de')).toEqual({ label: 'Nebulak', sprite: 'Gastly' });
  });

  it('maps queue picks to localized line labels, in pick order', () => {
    const board = toOverlayBoard(snapshot(), LINES, 'de', 0);
    expect(board?.picks.map((p) => p.label)).toEqual([
      localizeLineLabel('Teddiursa', 'Ursaluna-Bloodmoon', 'de'),
      localizeLineLabel('Gastly', 'Gengar', 'de'),
    ]);
    expect(board?.picks[1].label).toBe('Nebulak → Gengar');
    expect(board?.picks[1].sprite).toBe('Gastly');
    expect(board?.onClock).toEqual({ playerId: DAWN, name: 'Dawn' });
  });

  it('legacy picks use the line when they carry a line id, else the localized species', () => {
    const legacy = {
      pool: { status: 'active', point_budget: 180 },
      picks: [
        { player_id: MISTY, player_name: 'Misty', pokemon_name: 'Gastly', pick_number: 1, round: 1, points_spent: 28, line_id: 'gastly--gengar' },
        { player_id: DAWN, player_name: 'Dawn', pokemon_name: 'Charizard', pick_number: 2, round: 1, points_spent: null },
      ],
      rosters: { [MISTY]: ['Gastly'], [DAWN]: ['Charizard'] },
      budgets: null,
      current_picker: DAWN,
      current_round: 2,
      next_pick_number: 3,
    };
    const board = toOverlayBoard(legacy, LINES, 'de', 0);
    expect(board?.picks.map((p) => p.label)).toEqual(['Nebulak → Gengar', 'Glurak']);
    expect(board?.columns.map((c) => c.roster.map((r) => r.label))).toEqual([['Nebulak → Gengar'], ['Glurak']]);
  });

  it('legacy: the next picker is on the clock only while the pool runs with enforced turns', () => {
    const legacy = {
      pool: { status: 'in_progress', point_budget: null },
      picks: [],
      rosters: { [MISTY]: [], [DAWN]: [] },
      budgets: null,
      current_picker: DAWN,
      turn_enforced: true,
      current_round: 1,
      next_pick_number: 1,
    };
    expect(toOverlayBoard(legacy, LINES, 'de', 0)?.onClock?.playerId).toBe(DAWN);
    // Free order: the suggestion is nobody's turn.
    expect(toOverlayBoard({ ...legacy, turn_enforced: false }, LINES, 'de', 0)?.onClock).toBeNull();
    expect(toOverlayBoard({ ...legacy, pool: { status: 'pending', point_budget: null } }, LINES, 'de', 0)?.onClock).toBeNull();
  });

  it('renders the board in German with the line label and the player on the clock', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const board = toOverlayBoard(snapshot(), LINES, 'de', 0);
    if (!board) throw new Error('no board');
    const html = renderWithI18n(
      <DraftViewerBoard config={config} board={board} serverOffsetMs={0} latest={null} showBudget showTiers />,
      { locale: 'de' },
    );
    expect(html).toContain('Nebulak → Gengar');
    expect(html).toContain('Dawn ist am Zug');
    expect(html).toContain('Runde 2');
    expect(html).not.toContain('Kill Token');
  });

  it('renders the paused state in English and German', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const dto = snapshot({
      pool: { ...snapshot().pool, paused: true, paused_at: '2026-10-09T12:00:00.000Z', pause_reason: 'admin' },
    });
    const board = toOverlayBoard(dto, LINES, 'en', 0);
    if (!board) throw new Error('no board');
    const el = <DraftViewerBoard config={config} board={board} serverOffsetMs={0} latest={null} showBudget showTiers />;
    const en = renderWithI18n(el, { locale: 'en' });
    expect(en).toMatch(/class="uppercase[^"]*"[^>]*>Draft paused</);
    expect(en).not.toContain('is on the clock');
    expect(renderWithI18n(el, { locale: 'de' })).toContain('Draft pausiert');
  });

  it('the pick reveal shows the localized line label', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const board = toOverlayBoard(snapshot(), LINES, 'de', 0);
    if (!board) throw new Error('no board');
    const html = renderWithI18n(
      <DraftPickRevealCard config={config} board={board} pick={board.picks[1]} revealKey={board.picks[1].key} />,
      { locale: 'de' },
    );
    expect(html).toContain('Nebulak → Gengar');
    expect(html).toContain('Misty');
    expect(html).toContain('28 P');
  });
});

describe('idle text and replay controls (message keys)', () => {
  it('the pick reveal shows the idle line before any pick, in English and German', () => {
    const config = parseOverlayConfig(new URLSearchParams());
    const el = <DraftPickRevealCard config={config} board={null} pick={null} revealKey="" />;
    expect(renderWithI18n(el, { locale: 'en' })).toContain('Waiting for the next pick…');
    expect(renderWithI18n(el, { locale: 'de' })).toContain('Warte auf den nächsten Pick …');
  });

  it('the replay player labels its icon buttons with overlay.replay.* keys', () => {
    const source = readFileSync(path.resolve(__dirname, '..', 'DraftReplayPlayer.tsx'), 'utf8');
    for (const key of ['back', 'play', 'pause', 'skip']) {
      expect(source, key).toMatch(new RegExp(String.raw`aria-label=\{[^}]*ts\('overlay\.replay\.${key}'\)`));
    }
  });
});

describe('polling', () => {
  it('no draft overlay uses a bare setInterval', () => {
    for (const file of ['DraftViewer.tsx', 'DraftPickReveal.tsx', 'DraftReplayPlayer.tsx']) {
      const source = readFileSync(path.resolve(__dirname, '..', file), 'utf8');
      expect(source, file).not.toMatch(/\bsetInterval\s*\(/);
    }
    const viewer = readFileSync(path.resolve(__dirname, '..', 'DraftViewer.tsx'), 'utf8');
    expect(viewer).toMatch(/createVisiblePoller\(/);
    expect(viewer).toMatch(/visibility:\s*null/);
  });
});
