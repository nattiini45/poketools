/**
 * The phase form preselects the league's default ruleset (FA-4): a point-buy league gets the
 * pack's battle ruleset as its default on creation, so a new phase needs no manual ruleset.
 *
 * It also carries the phase's doubles flag: a labelled checkbox that a new phase
 * seeds from the selected ruleset until the admin touches it, and that an existing phase shows
 * as stored. Rendered with react-dom/server (vitest 'node' env, no @testing-library), so the
 * pure resolver carries the interaction rules.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { Ruleset } from '@/types/ruleset';
import PhaseForm, { resolveIsDoubles } from '../PhaseForm';

function ruleset(id: string, name: string, isDoubles = false): Ruleset {
  return {
    id,
    name,
    base_format: 'gen9',
    is_doubles: isDoubles,
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

const PACK = ruleset('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Evolution Point Buy');
const OTHER = ruleset('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Gen 9 RU');
const SINGLES = ruleset('rs-singles', 'Ruleset rs-singles', false);
const DOUBLES = ruleset('rs-doubles', 'Ruleset rs-doubles', true);
const noopSubmit = vi.fn(async () => {});

/** The ids of the selected `<option>`s in the markup. */
function selectedOptionValues(html: string): string[] {
  return [...html.matchAll(/<option value="([^"]*)" selected="">/g)].map((m) => m[1]);
}

/** The doubles checkbox `<input>` (the one inside the doubles label), as HTML. */
function doublesInput(html: string, label: string): string {
  const match = html.match(new RegExp(`<label[^>]*>(<input[^>]*type="checkbox"[^>]*>)${label}</label>`));
  expect(match).not.toBeNull();
  return match ? match[1] : '';
}

describe('PhaseForm default ruleset', () => {
  it("preselects the league's default ruleset and enables submit", () => {
    const html = renderToStaticMarkup(
      <PhaseForm rulesets={[OTHER, PACK]} onSubmit={noopSubmit} defaultRulesetId={PACK.id} />,
    );

    expect(selectedOptionValues(html)).toContain(PACK.id);
    expect(selectedOptionValues(html)).not.toContain(OTHER.id);
  });

  it('selects nothing without a default', () => {
    const html = renderToStaticMarkup(<PhaseForm rulesets={[OTHER, PACK]} onSubmit={noopSubmit} />);

    expect(selectedOptionValues(html)).not.toContain(PACK.id);
    expect(selectedOptionValues(html)).not.toContain(OTHER.id);
  });

  it('ignores a default that is not among the offered rulesets', () => {
    const html = renderToStaticMarkup(
      <PhaseForm rulesets={[OTHER]} onSubmit={noopSubmit} defaultRulesetId={PACK.id} />,
    );

    expect(selectedOptionValues(html)).not.toContain(PACK.id);
    expect(selectedOptionValues(html)).not.toContain(OTHER.id);
  });

  it("keeps an existing phase's own ruleset over the league default", () => {
    const html = renderToStaticMarkup(
      <PhaseForm
        rulesets={[OTHER, PACK]}
        onSubmit={noopSubmit}
        defaultRulesetId={PACK.id}
        initialData={{ name: 'Groups', ruleset_id: OTHER.id }}
      />,
    );

    expect(selectedOptionValues(html)).toContain(OTHER.id);
    expect(selectedOptionValues(html)).not.toContain(PACK.id);
  });
});

describe('PhaseForm unsaved marker (league admin tab guard)', () => {
  it('renders no data-unsaved marker while the fields equal what it loaded', () => {
    const fresh = renderToStaticMarkup(
      <PhaseForm rulesets={[OTHER, PACK]} onSubmit={noopSubmit} defaultRulesetId={PACK.id} />,
    );
    const existing = renderToStaticMarkup(
      <PhaseForm
        rulesets={[OTHER, PACK]}
        onSubmit={noopSubmit}
        initialData={{ name: 'Groups', ruleset_id: OTHER.id, bo_overrides: { '2': 5 } }}
      />,
    );

    expect(fresh).not.toContain('data-unsaved');
    expect(existing).not.toContain('data-unsaved');
  });

  it('renders no data-unsaved marker for a stored doubles flag', () => {
    const html = renderToStaticMarkup(
      <PhaseForm
        rulesets={[SINGLES, DOUBLES]}
        onSubmit={noopSubmit}
        initialData={{ name: 'Groups', ruleset_id: 'rs-singles', is_doubles: true }}
      />,
    );

    expect(html).not.toContain('data-unsaved');
  });
});

describe('resolveIsDoubles', () => {
  const rulesets = [SINGLES, DOUBLES];

  it('follows the selected ruleset until the admin touches the checkbox', () => {
    expect(resolveIsDoubles(false, false, 'rs-doubles', rulesets)).toBe(true);
    expect(resolveIsDoubles(false, false, 'rs-singles', rulesets)).toBe(false);
  });

  it('is unchecked while no ruleset is selected or the id is unknown', () => {
    expect(resolveIsDoubles(false, false, '', rulesets)).toBe(false);
    expect(resolveIsDoubles(false, false, 'missing', rulesets)).toBe(false);
  });

  it('keeps the admin choice over the ruleset once the checkbox was touched', () => {
    expect(resolveIsDoubles(true, false, 'rs-doubles', rulesets)).toBe(false);
    expect(resolveIsDoubles(true, true, 'rs-singles', rulesets)).toBe(true);
  });
});

describe('PhaseForm doubles checkbox', () => {
  it('renders a labelled checkbox with a hint, unchecked for a new phase', () => {
    const html = renderWithI18n(<PhaseForm rulesets={[SINGLES, DOUBLES]} onSubmit={noopSubmit} />);

    expect(html).toContain('Doubles phase');
    expect(html).toContain('A new phase follows the selected ruleset');
    expect(doublesInput(html, 'Doubles phase')).not.toContain('checked');
  });

  it('seeds a new phase from a doubles ruleset', () => {
    const html = renderWithI18n(
      <PhaseForm rulesets={[SINGLES, DOUBLES]} onSubmit={noopSubmit} initialData={{ ruleset_id: 'rs-doubles' }} />,
    );

    expect(doublesInput(html, 'Doubles phase')).toContain('checked');
  });

  it('shows the stored value when editing, whatever the ruleset says', () => {
    const stored = renderWithI18n(
      <PhaseForm
        rulesets={[SINGLES, DOUBLES]}
        onSubmit={noopSubmit}
        initialData={{ ruleset_id: 'rs-singles', is_doubles: true }}
      />,
    );
    const storedOff = renderWithI18n(
      <PhaseForm
        rulesets={[SINGLES, DOUBLES]}
        onSubmit={noopSubmit}
        initialData={{ ruleset_id: 'rs-doubles', is_doubles: false }}
      />,
    );

    expect(doublesInput(stored, 'Doubles phase')).toContain('checked');
    expect(doublesInput(storedOff, 'Doubles phase')).not.toContain('checked');
  });

  it('renders the label in German', () => {
    const html = renderWithI18n(<PhaseForm rulesets={[SINGLES]} onSubmit={noopSubmit} />, { locale: 'de' });

    expect(html).toContain('Doppel-Phase');
    expect(html).not.toContain('Doubles phase');
  });
});
