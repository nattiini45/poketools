/**
 * The league details form on the Settings tab: stored values, the league type lock (started and
 * point-buy), the ruleset field and the German render. Rendered with react-dom/server (vitest 'node'
 * env, no @testing-library), so the pure helpers (settings-patch, form-dirty) carry the interaction rules.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { Ruleset } from '@/types/ruleset';
import type { LeagueSettingsValues } from '@/lib/league-admin/settings-patch';
import LeagueSettingsForm from '../LeagueSettingsForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function ruleset(id: string, name: string): Ruleset {
  return {
    id,
    name,
    base_format: 'gen9ru',
    is_doubles: false,
    clauses: [],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

const RULESETS = [ruleset('rs-1', 'Gen 9 RU'), ruleset('rs-2', 'Gen 9 OU')];

const CLASSIC: LeagueSettingsValues = {
  name: 'Spring League',
  formatType: 'singles',
  rulesetId: 'rs-2',
  startDate: '2026-03-01',
  endDate: '2026-06-01',
};

const POINT_BUY: LeagueSettingsValues = { ...CLASSIC, formatType: 'evolution_point_buy', rulesetId: 'rs-1' };

/** The league-type `<select>`, as HTML. */
function leagueTypeSelect(html: string): string {
  const match = html.match(/<select[^>]*id="league-type"[^>]*>.*?<\/select>/s);
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

/** The save button's opening tag. */
function submitButton(html: string): string {
  const match = html.match(/<button[^>]*type="submit"[^>]*>/);
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

function render(initial: LeagueSettingsValues, formatLock: 'started' | 'point_buy' | null, locale?: 'de') {
  return renderWithI18n(
    <LeagueSettingsForm seasonId="s1" initial={initial} rulesets={RULESETS} formatLock={formatLock} />,
    { locale },
  );
}

describe('LeagueSettingsForm', () => {
  it('shows the stored name, ruleset and dates', () => {
    const html = render(CLASSIC, null);

    expect(html).toContain('value="Spring League"');
    expect(html).toContain('value="2026-03-01"');
    expect(html).toContain('value="2026-06-01"');
    expect(html).toMatch(/<option value="rs-2" selected="">Gen 9 OU<\/option>/);
    expect(html).toContain('Battle ruleset (optional)');
    expect(html).toContain('Existing phases keep theirs.');
  });

  it('offers the classic league types without point buy, and lets an unstarted league change it', () => {
    const select = leagueTypeSelect(render(CLASSIC, null));

    expect(select).toMatch(/<option value="singles" selected="">Classic: Singles<\/option>/);
    expect(select).toContain('value="doubles"');
    expect(select).toContain('value="draft"');
    expect(select).not.toContain('evolution_point_buy');
    expect(select).not.toContain(' disabled=""');
  });

  it('locks the league type with the started hint once the league started', () => {
    const html = render(CLASSIC, 'started');
    const select = leagueTypeSelect(html);

    expect(select).toContain(' disabled=""');
    expect(select).toMatch(/aria-describedby="([^"]+)"/);
    const hintId = select.match(/aria-describedby="([^"]+)"/)?.[1] ?? '';
    expect(html).toContain(`id="${hintId}"`);
    expect(html).toContain('The league type can no longer be changed: the league has started');
  });

  it('fixes a point-buy league: auto ruleset note, no ruleset select, locked type with the point-buy hint', () => {
    const html = render(POINT_BUY, 'point_buy');
    const select = leagueTypeSelect(html);

    expect(html).toContain('data-testid="league-auto-ruleset"');
    expect(html).not.toContain('Battle ruleset (optional)');
    expect(html).not.toContain('Gen 9 RU');
    expect(select).toContain(' disabled=""');
    expect(select).toMatch(/<option value="evolution_point_buy" selected="">/);
    expect(select).not.toContain('value="singles"');
    expect(html).toContain('A point-buy league keeps its league type');
  });

  it('starts with Save disabled and no unsaved marker', () => {
    const html = render(CLASSIC, null);

    expect(submitButton(html)).toContain(' disabled=""');
    expect(html).toContain('Save changes</button>');
    expect(html).not.toContain('data-unsaved');
    expect(html).not.toContain('The end date must not be before the start date.');
  });

  it('shows an end date before the start date as an error and keeps Save disabled', () => {
    const html = render({ ...CLASSIC, startDate: '2026-06-01', endDate: '2026-03-01' }, null);

    expect(html).toContain('The end date must not be before the start date.');
    expect(submitButton(html)).toContain(' disabled=""');
  });

  it('renders the German labels without English leftovers', () => {
    const de = render(CLASSIC, 'started', 'de');

    expect(de).toContain('Name der Liga');
    expect(de).toContain('Liga-Typ');
    expect(de).toContain('Klassisch: Einzel');
    expect(de).toContain('Startdatum');
    expect(de).toContain('Enddatum');
    expect(de).toContain('Änderungen speichern');
    expect(de).toContain('Der Liga-Typ lässt sich nicht mehr ändern');
    expect(de).toContain('Der Standard für neue Phasen');
    expect(de).not.toContain('Save changes');
    expect(de).not.toContain('League type');
    expect(de).not.toContain('Start Date');
  });

  it('matches the create form wording for the shared fields', () => {
    const html = renderToStaticMarkup(
      <LeagueSettingsForm seasonId="s1" initial={CLASSIC} rulesets={RULESETS} formatLock={null} />,
    );

    expect(html).toContain('League Name');
    expect(html).toContain('League type');
    expect(html).toContain('Start Date');
    expect(html).toContain('End Date');
  });
});
