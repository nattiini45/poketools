/**
 * A view whose stats request failed renders a failure state: never the rows
 * still in state from the previous scope (shown under the newly selected
 * scope), and never the "No battle data yet" empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/components/ui/Table', () => ({ default: () => null }));

const seed = vi.hoisted(() => ({
  rows: [] as Array<{ pokemon_name: string; move_name: string; count: number }>,
  settled: null as { key: string; failed: boolean } | null,
  scopeType: 'all_time' as 'all_time' | 'league' | 'tournament',
}));

// Seeds the widget's state for one server render: the rows in state (the
// only array initial), the last settled view (the only null initial) and the
// scope (the 'all_time' initial).
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const value = typeof initial === 'function' ? (initial as () => T)() : initial;
      if (Array.isArray(value)) return [seed.rows, () => undefined];
      if (value === null) return [seed.settled, () => undefined];
      if (value === 'all_time') return [seed.scopeType, () => undefined];
      return [value, () => undefined];
    },
  };
});

import WikiMoveUsageStats from '../WikiMoveUsageStats';
import { renderWithI18n } from '@/test/i18n';

/** The view key of the widget's initial (all-time) scope for Earthquake. */
const ALL_TIME_KEY = 'Earthquake|all_time|';

const PREVIOUS_ROWS = [
  { pokemon_name: 'Garchomp', move_name: 'Earthquake', count: 9 },
  { pokemon_name: 'Lucario', move_name: 'Earthquake', count: 2 },
];

function render(): string {
  return renderToStaticMarkup(<WikiMoveUsageStats moveName="Earthquake" />);
}

describe('WikiMoveUsageStats render', () => {
  beforeEach(() => {
    seed.rows = [];
    seed.settled = null;
    seed.scopeType = 'all_time';
  });

  it('shows the failure, not the previous scope\'s rows, when the current view failed', () => {
    seed.rows = PREVIOUS_ROWS;
    seed.settled = { key: ALL_TIME_KEY, failed: true };
    const html = render();
    expect(html).toContain('Battle usage could not be loaded');
    expect(html).not.toContain('Used 11 times');
  });

  it('shows the failure, not "No battle data yet", when the first load failed', () => {
    seed.settled = { key: ALL_TIME_KEY, failed: true };
    const html = render();
    expect(html).toContain('Battle usage could not be loaded');
    expect(html).not.toContain('No battle data yet');
  });

  it('shows the rows when the current view loaded', () => {
    seed.rows = PREVIOUS_ROWS;
    seed.settled = { key: ALL_TIME_KEY, failed: false };
    const html = render();
    expect(html).toContain('Used 11 times across 2 Pokemon');
    expect(html).not.toContain('could not be loaded');
  });

  it('shows the empty state when the current view loaded with no rows', () => {
    seed.settled = { key: ALL_TIME_KEY, failed: false };
    expect(render()).toContain('No battle data yet for this move');
  });

  it('keeps the failure, not "No battle data yet", while a league scope waits for an id', () => {
    seed.scopeType = 'league';
    seed.settled = { key: ALL_TIME_KEY, failed: true };
    const html = render();
    expect(html).toContain('Battle usage could not be loaded');
    expect(html).not.toContain('No battle data yet');
  });

  it('renders the widget in German with a German provider', () => {
    seed.rows = PREVIOUS_ROWS;
    seed.settled = { key: ALL_TIME_KEY, failed: false };
    const html = renderWithI18n(<WikiMoveUsageStats moveName="Earthquake" />, { locale: 'de' });
    expect(html).toContain('Einsatz in Kämpfen');
    expect(html).toContain('Insgesamt 11-mal eingesetzt, von 2 Pokémon');
    expect(html).toMatch(/<option value="all_time"[^>]*>Gesamt<\/option>/);
    expect(html).not.toContain('Used 11 times');
  });

  it('uses the singular form for a single use (EN + DE)', () => {
    seed.rows = [{ pokemon_name: 'Garchomp', move_name: 'Earthquake', count: 1 }];
    seed.settled = { key: ALL_TIME_KEY, failed: false };
    expect(render()).toContain('Used once across 1 Pokemon');
    const de = renderWithI18n(<WikiMoveUsageStats moveName="Earthquake" />, { locale: 'de' });
    expect(de).toContain('Einmal eingesetzt, von 1 Pokémon');
  });

  it('renders the German failure state', () => {
    seed.settled = { key: ALL_TIME_KEY, failed: true };
    const html = renderWithI18n(<WikiMoveUsageStats moveName="Earthquake" />, { locale: 'de' });
    expect(html).toContain('Die Kampfdaten konnten nicht geladen werden');
    expect(html).not.toContain('Noch keine Kampfdaten');
  });

  it('keeps the previous rows while a league scope waits for an id', () => {
    seed.scopeType = 'league';
    seed.rows = PREVIOUS_ROWS;
    seed.settled = { key: ALL_TIME_KEY, failed: false };
    const html = render();
    expect(html).toContain('Used 11 times across 2 Pokemon');
    expect(html).not.toContain('could not be loaded');
  });
});
