/**
 * The phase form preselects the league's default ruleset (FA-4): a point-buy league gets the
 * pack's battle ruleset as its default on creation, so a new phase needs no manual ruleset.
 * Static render (vitest 'node' env, no @testing-library).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Ruleset } from '@/types/ruleset';
import PhaseForm from '../PhaseForm';

function ruleset(id: string, name: string): Ruleset {
  return {
    id,
    name,
    base_format: 'gen9',
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

const PACK = ruleset('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Evolution Point Buy');
const OTHER = ruleset('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Gen 9 RU');
const noopSubmit = vi.fn(async () => {});

/** The ids of the selected `<option>`s in the markup. */
function selectedOptionValues(html: string): string[] {
  return [...html.matchAll(/<option value="([^"]*)" selected="">/g)].map((m) => m[1]);
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
});
