/**
 * The public, read-only view of a ruleset (`RulesetDetail`): what the team check enforces, in the viewer's language. This
 * file covers what the studio added to the old view: the version, clauses the check does not enforce marked as informational,
 * allowlists, sprite chips from icon-sheet cells, and the team rules in sentences. The old labels are in `ruleset-i18n.test`.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import { expectNoLeftovers, expectUniqueIds, stripMarkup } from '@/test/markup';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { ITEM_SHEET, POKEMON_SHEET } from '@/lib/pkmn/catalog-index';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import RulesetDetail from '../RulesetDetail';

const text = (html: string) => stripMarkup(html, ' ').replace(/\s+/g, ' ');

describe('RulesetDetail: the studio additions', () => {
  it('names the version of a stored ruleset, and none for one built in code', () => {
    const stored = makeRuleset({ version: { definition_id: 'd', version_no: 4 } });
    expect(text(renderToStaticMarkup(<RulesetDetail ruleset={stored} />))).toContain('Version 4');
    expect(text(renderToStaticMarkup(<RulesetDetail ruleset={makeRuleset()} />))).not.toContain('Version');
  });

  it('marks a clause the team check does not enforce as informational (dashed, and read out), the enforced one plain', () => {
    const html = renderToStaticMarkup(<RulesetDetail ruleset={makeRuleset({ clauses: ['Species Clause', 'Sleep Clause Mod'] })} />);
    expect(html).toMatch(/border-dashed[^>]*>Sleep Clause Mod<span class="sr-only"> \(informational\)<\/span>/);
    expect(html).toMatch(/bg-blue-100[^>]*>Species Clause<\/span>/);
    expect(html).toContain('Clauses marked as informational apply in the battle. The team check does not enforce them.');
  });

  it('prints no informational note when every clause is enforced', () => {
    const html = renderToStaticMarkup(<RulesetDetail ruleset={makeRuleset({ clauses: ['Species Clause'] })} />);
    expect(html).not.toContain('informational');
  });

  it('shows an allowlist as the only legal entries, with its own heading, instead of an empty ban list', () => {
    const ruleset = makeRuleset({ allow: { pokemon: ['Pikachu', 'Raichu'], moves: null, items: null, abilities: null } });
    const out = text(renderToStaticMarkup(<RulesetDetail ruleset={ruleset} />));
    expect(out).toContain('Only these Pokémon are allowed (2)');
    expect(out).toContain('Pikachu');
    expect(out).toContain('Raichu');
    expect(out).not.toContain('Banned Pokémon');
  });

  it('shows an allowlist even when it is empty, so a ruleset that allows nothing is not read as having no rules', () => {
    const ruleset = makeRuleset({ allow: { pokemon: null, moves: null, items: [], abilities: null } });
    expect(text(renderToStaticMarkup(<RulesetDetail ruleset={ruleset} />))).toContain('Only these items are allowed (0)');
  });

  it('draws Pokémon and item chips with their icon-sheet cell, one image for the whole list', () => {
    const ruleset = makeRuleset({ bans: { pokemon: ['Charizard'], moves: ['Flamethrower'], items: ['Leftovers'], abilities: [] } });
    const html = renderToStaticMarkup(<RulesetDetail ruleset={ruleset} />);
    expect(html).toContain(`url(${POKEMON_SHEET.url})`);
    expect(html).toContain(`url(${ITEM_SHEET.url})`);
    // A move has no icon: its chip is text only.
    expect(html).not.toMatch(/Flamethrower[^<]*<\/span>[^]*?aria-hidden="true"[^>]*>Flamethrower/);
    expect((html.match(/aria-hidden="true"/g) ?? []).length).toBe(2);
  });

  it('prints the team rules as sentences next to the shared-type rule', () => {
    const ruleset = makeRuleset({
      min_shared_type_pct: 0,
      team_constraints: { type_quotas: { source: 'fixed', fixed_types: ['Water'], min_per_type: 2, allow_multi_count: true }, tera_match: 'player_core' },
    });
    const out = text(renderToStaticMarkup(<RulesetDetail ruleset={ruleset} />));
    expect(out).toContain('Team rules');
    expect(out).toContain('Water');
    expect(out).toContain('Tera');
  });

  it('is German where the studio texts are new, and keeps ids unique and no placeholders', () => {
    const ruleset = makeRuleset({
      clauses: ['Sleep Clause'],
      version: { definition_id: 'd', version_no: 2 },
      allow: { pokemon: ['Pikachu'], moves: null, items: null, abilities: null },
      team_constraints: { tera_match: 'team_types' },
    });
    const html = renderWithI18n(<RulesetDetail ruleset={ruleset} />, { locale: 'de' });
    expectNoLeftovers(html);
    expectUniqueIds(html);
    const out = text(html);
    expect(out).toContain('Version 2');
    expect(out).toContain('Nur diese Pokémon sind erlaubt (1)');
    expect(out).toContain('Teamregeln');
    expect(out).toContain('nur zur Information');
  });

  it('keeps the route-world block tag for the new blocks too', () => {
    const ruleset = makeRuleset({ allow: { pokemon: ['Pikachu'], moves: null, items: null, abilities: null }, clauses: ['Sleep Clause'] });
    expect(renderWithI18n(<RulesetDetail ruleset={ruleset} blockTag="div" />)).not.toContain('<section');
  });
});
