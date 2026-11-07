/** @vitest-environment jsdom */
/**
 * A kit league's teambuilder: the verdict panel says which league rules are advisory only and which are checked again
 * after the match, and the "Your pools this week" card lists the player's own gifts and which of the league's pools are
 * open (from the live `me` view; the New Year pool is in no action step, so the card reads `pools`, not the steps).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n';
import type { TeamValidationResult } from '@/types/team';
import { ltext } from '@/lib/studio-core/ltext';
import { item, runningView, ANNA } from '@/components/format-runtime/player/__tests__/fixtures';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/client-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/format-engine/runtime/client-api')>()),
  loadMyFormatView: mocks.load,
}));

import ValidationPanel from '../ValidationPanel';

const SEASON = '5e150000-0000-4000-8000-000000000001';

const plain: TeamValidationResult = { valid: true, issues: [], team_issues: [] };
const kitIssue: TeamValidationResult = {
  valid: false,
  issues: [],
  team_issues: ['Pikachu is not allowed'],
  team_issue_details: [{ issue: 'Pikachu is not allowed', code: 'kit_not_allowed', params: { species: 'Pikachu' } }],
};

const view = runningView({
  items: [
    item({ item_id: 'pikachu' }),
    item({ item_id: 'charizard', resource: 'premium', resource_label: ltext('en', 'Premium gift', 'Premium-Geschenk') }),
    item({ item_id: 'eevee', holder: { id: ANNA, name: 'Anna' } }),
    item({ item_id: null, amount: 3 }),
  ],
  // The real shape of the shipped cup: its only action steps draw from the junk and premium pools, which are open; the
  // New Year pool is locked until a calendar mark and is in no step.
  pools: [
    { key: 'junk', label: ltext('en', 'Junk pool', 'Schrott-Pool'), unlocked: true },
    { key: 'new_year', label: ltext('en', 'New Year pool', 'Neujahrs-Pool'), unlocked: false },
  ],
});

beforeEach(() => vi.clearAllMocks());

describe('ValidationPanel in a kit league', () => {
  it('lists own gifts and pool status, and says the league rules are advisory', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: view });
    render(withI18n(<ValidationPanel validation={plain} seasonId={SEASON} />));
    await waitFor(() => expect(screen.getByText('Your pools this week')).toBeTruthy());
    expect(mocks.load).toHaveBeenCalledWith(SEASON);
    // A verdict without a stage-rule issue promises no re-check: a stage may have no rules, and ruleset breaks are never audited.
    expect(screen.getByText(/League rules are advisory here/)).toBeTruthy();
    expect(screen.queryByText(/checked again after the match/)).toBeNull();
    const card = document.querySelector('[data-pools-card]')!.textContent!;
    expect(card).toContain('Gift: Pikachu');
    expect(card).toContain('Premium gift: Charizard');
    // Another player's item and counters are not the viewer's pool.
    expect(card).not.toContain('Eevee');
    expect(card).toContain('Junk pool: open');
    expect(card).toContain('New Year pool: not open yet');
  });

  it('lists a locked pool that no action step draws from, and shows it open once the server reports it unlocked', async () => {
    const week4 = runningView({ pools: view.pools.map((pool) => ({ ...pool, unlocked: true })) });
    mocks.load.mockResolvedValue({ ok: true, data: week4 });
    render(withI18n(<ValidationPanel validation={plain} seasonId={SEASON} />));
    await waitFor(() => expect(screen.getByText('Your pools this week')).toBeTruthy());
    expect(document.querySelector('[data-pools-card]')!.textContent).toContain('New Year pool: open');
  });

  it('renders the card and note in German', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: view });
    render(withI18n(<ValidationPanel validation={plain} seasonId={SEASON} />, { locale: 'de' }));
    await waitFor(() => expect(screen.getByText('Deine Pools diese Woche')).toBeTruthy());
    expect(screen.getByText(/Die Ligaregeln sind hier ein Hinweis/)).toBeTruthy();
    expect(document.querySelector('[data-pools-card]')!.textContent).toContain('Neujahrs-Pool: noch nicht offen');
  });

  it('shows nothing extra for a league that does not run a kit format', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { running: false } });
    render(withI18n(<ValidationPanel validation={plain} seasonId={SEASON} />));
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(document.querySelector('[data-pools-card]')).toBeNull();
    expect(document.querySelector('[data-audit-note]')).toBeNull();
  });

  it('shows nothing extra when the view cannot be read, and keeps the verdict', async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { code: 'format_not_participant' }, status: 403 });
    render(withI18n(<ValidationPanel validation={plain} seasonId={SEASON} />));
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(document.querySelector('[data-pools-card]')).toBeNull();
    expect(screen.getByText('Team is valid')).toBeTruthy();
  });

  it('does not read the view without a season, and still notes a kit verdict', () => {
    render(withI18n(<ValidationPanel validation={kitIssue} />));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(document.querySelector('[data-audit-note]')).not.toBeNull();
  });

  it('promises the re-check only for a stage-rule (kit_*) issue, and says ruleset breaks are not re-checked', async () => {
    mocks.load.mockResolvedValue({ ok: true, data: view });
    render(withI18n(<ValidationPanel validation={kitIssue} seasonId={SEASON} />));
    await waitFor(() => expect(screen.getByText('Your pools this week')).toBeTruthy());
    expect(document.querySelector('[data-audit-note]')!.getAttribute('data-audit-note')).toBe('audited');
    expect(screen.getByText(/checked again after the match\. Banned Pokémon, items and formes are not re-checked/)).toBeTruthy();
  });

  it('never claims a ruleset break (a banned item) is re-checked', async () => {
    const banned: TeamValidationResult = {
      valid: false,
      issues: [{ pokemon_index: 0, species: 'Pikachu', issue_id: 'i1', issue: 'Light Ball is banned', severity: 'error', code: 'item_banned' } as never],
      team_issues: [],
    };
    mocks.load.mockResolvedValue({ ok: true, data: view });
    render(withI18n(<ValidationPanel validation={banned} seasonId={SEASON} />));
    await waitFor(() => expect(screen.getByText('Your pools this week')).toBeTruthy());
    expect(document.querySelector('[data-audit-note]')!.getAttribute('data-audit-note')).toBe('advisory');
    expect(screen.queryByText(/checked again after the match/)).toBeNull();
  });

  it('does not note a plain league verdict', () => {
    render(withI18n(<ValidationPanel validation={plain} />));
    expect(document.querySelector('[data-audit-note]')).toBeNull();
  });
});
