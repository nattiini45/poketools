/**
 * The league create form: the content-language select (i18n-core §6.1, T04)
 * defaults to German for new leagues, shows a stored value, and the form
 * renders in both UI languages (react-dom/server, vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import LeagueForm, { buildLeagueFormPayload, type LeagueFormValues } from '../LeagueForm';

const noopSubmit = vi.fn(async () => null);

/** The `<select>` that follows the content-language label, as HTML. */
function languageSelect(html: string): string {
  const match = html.match(/<select[^>]*id="league-content-language"[^>]*>.*?<\/select>/s);
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

describe('LeagueForm content language', () => {
  it('defaults new leagues to German and offers both languages by their own names', () => {
    const html = renderToStaticMarkup(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />);
    const select = languageSelect(html);

    expect(html).toContain('Content language (Discord, reports, overlays)');
    expect(select).toMatch(/<option value="de" selected="">Deutsch<\/option>/);
    expect(select).toMatch(/<option value="en">English<\/option>/);
  });

  it('shows the stored language of an existing league', () => {
    const html = renderToStaticMarkup(
      <LeagueForm rulesets={[]} onSubmit={noopSubmit} initialData={{ name: 'Example League', language: 'en' }} />,
    );

    expect(languageSelect(html)).toMatch(/<option value="en" selected="">English<\/option>/);
  });

  it('keeps the English labels and renders German ones under de', () => {
    const en = renderWithI18n(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />);
    const de = renderWithI18n(<LeagueForm rulesets={[]} onSubmit={noopSubmit} />, { locale: 'de' });

    expect(en).toContain('League Name');
    expect(en).toContain('Create League');
    expect(en).toContain('Auto (format default)');
    expect(en).toContain('Evolution Point Buy');

    expect(de).toContain('Inhaltssprache (Discord, Berichte, Overlays)');
    expect(de).toContain('Name der Liga');
    expect(de).toContain('Liga erstellen');
    expect(de).toContain('Automatisch (Standard des Formats)');
    expect(de).toContain('Einzel');
    expect(de).not.toContain('League Name');
  });
});

/** The league-type `<select>`, as HTML. */
function leagueTypeSelect(html: string): string {
  const match = html.match(/<select[^>]*id="league-type"[^>]*>.*?<\/select>/s);
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

const ruleset = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Gen 9 RU',
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

describe('LeagueForm league type and battle ruleset (FA-4)', () => {
  it('labels the field League type with form-local options; the point-buy label comes from the pack', () => {
    const html = renderToStaticMarkup(<LeagueForm rulesets={[ruleset]} onSubmit={noopSubmit} />);
    const select = leagueTypeSelect(html);

    expect(html).toContain('League type');
    expect(html).not.toContain('Format Type');
    expect(select).toMatch(/<option value="singles" selected="">Classic: Singles<\/option>/);
    expect(select).toMatch(/<option value="doubles">Classic: Doubles<\/option>/);
    expect(select).toMatch(/<option value="draft">Draft<\/option>/);
    // The example pack's `leagueAdmin.form.leagueTypeLabel`.
    expect(select).toMatch(/<option value="evolution_point_buy">Evolution Point Buy<\/option>/);
  });

  it('offers the battle ruleset select for a classic league, without a fixed battle format', () => {
    const html = renderToStaticMarkup(<LeagueForm rulesets={[ruleset]} onSubmit={noopSubmit} />);

    expect(html).toContain('Battle ruleset (optional)');
    expect(html).toContain('Gen 9 RU');
    expect(html).not.toContain('Battle format: Singles (fixed)');
    expect(html).not.toContain('data-testid="league-auto-ruleset"');
  });

  it('fixes singles and shows the automatic pack ruleset for a point-buy league', () => {
    const html = renderToStaticMarkup(
      <LeagueForm
        rulesets={[ruleset]}
        onSubmit={noopSubmit}
        initialData={{ format_type: 'evolution_point_buy' }}
      />,
    );

    expect(leagueTypeSelect(html)).toMatch(/<option value="evolution_point_buy" selected="">/);
    expect(html).toContain('Battle format: Singles (fixed)');
    expect(html).toContain('Battle ruleset: Evolution Point Buy (set automatically)');
    // No manual ruleset choice: the server sets the pack's ruleset as the league default.
    expect(html).not.toContain('Battle ruleset (optional)');
    expect(html).not.toContain('Gen 9 RU');
  });

  it('renders the point-buy wording in German', () => {
    const de = renderWithI18n(
      <LeagueForm rulesets={[ruleset]} onSubmit={noopSubmit} initialData={{ format_type: 'evolution_point_buy' }} />,
      { locale: 'de' },
    );

    expect(de).toContain('Liga-Typ');
    expect(de).toContain('Klassisch: Einzel');
    expect(de).toContain('Kampfformat: Einzel (fest)');
    expect(de).toContain('Battle-Regelwerk: Evolution Point Buy (wird automatisch gesetzt)');
  });
});

describe('buildLeagueFormPayload (FA-4)', () => {
  const values: LeagueFormValues = {
    name: 'League',
    description: '',
    formatType: 'singles',
    rulesetId: 'rs-picked',
    startDate: '',
    endDate: '',
    routeTheme: 'auto',
    language: 'de',
  };

  it('sends the picked ruleset for a classic league', () => {
    expect(buildLeagueFormPayload(values)).toEqual({
      name: 'League',
      description: undefined,
      format_type: 'singles',
      ruleset_id: 'rs-picked',
      start_date: null,
      end_date: null,
      route_theme: 'auto',
      language: 'de',
    });
  });

  it('sends ruleset_id null for a point-buy league, even with a ruleset picked before the switch', () => {
    const payload = buildLeagueFormPayload({ ...values, formatType: 'evolution_point_buy' });
    expect(payload.ruleset_id).toBeNull();
    expect(payload.format_type).toBe('evolution_point_buy');
  });

  it('sends ruleset_id null for a classic league with no ruleset picked', () => {
    expect(buildLeagueFormPayload({ ...values, rulesetId: '' }).ruleset_id).toBeNull();
  });
});
