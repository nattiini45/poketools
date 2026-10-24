/**
 * The tournament form: create mode keeps its markup, edit mode (the standalone
 * settings editor) hides the description, relabels the button and disables
 * the controls a started tournament freezes. Best-of choices are the odd
 * values 1..15 plus a stored legacy value (react-dom/server, vitest 'node' env).
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderWithI18n } from '@/test/i18n';
import type { Ruleset } from '@/types/ruleset';
import TournamentForm from '../TournamentForm';

const RULESET_ID = '11111111-1111-4111-8111-111111111111';
const rulesets = [{ id: RULESET_ID, name: 'Standard Rules' }] as unknown as Ruleset[];
const noopSubmit = vi.fn(async () => {});

/** The option values of the select with the given id. */
function optionValues(html: string, id: string): number[] {
  const select = html.match(new RegExp(`<select[^>]*id="${escapeRe(id)}"[^>]*>(.*?)</select>`, 's'))?.[1] ?? '';
  return [...select.matchAll(/<option value="(\d+)"/g)].map((m) => Number(m[1]));
}

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether an opening tag carries the `disabled` attribute (not the `disabled:` utility classes). */
const isDisabled = (tag: string): boolean => /\sdisabled(=""|\s|>)/.test(tag);

/** The opening tag of the element with the given id. */
function tagWithId(html: string, id: string): string {
  const match = html.match(new RegExp(`<[a-z]+[^>]*id="${escapeRe(id)}"[^>]*>`));
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

const stored = {
  name: 'Spring Cup',
  bracket_type: 'double_elim' as const,
  ruleset_id: RULESET_ID,
  best_of_default: 3,
  is_doubles: false,
  team_visibility: 'hidden_until_match' as const,
};

describe('TournamentForm create mode', () => {
  it('keeps the create label, the description and enabled controls', () => {
    const html = renderToStaticMarkup(<TournamentForm rulesets={rulesets} onSubmit={noopSubmit} />);

    expect(html).toContain('Create Tournament');
    expect(html).toContain('Description (optional)');
    expect(html).not.toContain('Locked: the tournament has started.');
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(false);
  });

  it('disables the submit button for a whitespace-only name', () => {
    const html = renderToStaticMarkup(
      <TournamentForm rulesets={rulesets} onSubmit={noopSubmit} initialData={{ name: '   ', ruleset_id: RULESET_ID }} />,
    );
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(true);
  });

  it('offers the odd best-of values from 1 to 15', () => {
    const html = renderToStaticMarkup(<TournamentForm rulesets={rulesets} onSubmit={noopSubmit} />);
    expect(optionValues(html, 'best-of-(default)')).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });
});

describe('TournamentForm edit mode', () => {
  it('hides the description and uses the given submit label', () => {
    const html = renderToStaticMarkup(
      <TournamentForm
        rulesets={rulesets}
        onSubmit={noopSubmit}
        mode="edit"
        submitLabel="Save changes"
        initialData={stored}
      />,
    );

    expect(html).not.toContain('Description (optional)');
    expect(html).not.toContain('id="description"');
    expect(html).toContain('Save changes');
    expect(html).not.toContain('Create Tournament');
    expect(html).toContain('value="Spring Cup"');
  });

  it('enables the locked-capable controls when nothing is locked', () => {
    const html = renderToStaticMarkup(
      <TournamentForm rulesets={rulesets} onSubmit={noopSubmit} mode="edit" initialData={stored} />,
    );
    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(false);
    expect(isDisabled(tagWithId(html, 'ruleset'))).toBe(false);
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(false);
    expect(html).not.toContain('Locked: the tournament has started.');
  });

  it('disables the locked controls and explains why', () => {
    const html = renderToStaticMarkup(
      <TournamentForm
        rulesets={rulesets}
        onSubmit={noopSubmit}
        mode="edit"
        initialData={stored}
        lockedFields={{ bracketType: true, ruleset: true, doubles: true }}
      />,
    );

    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(true);
    expect(isDisabled(tagWithId(html, 'ruleset'))).toBe(true);
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(true);
    expect(html.match(/Locked: the tournament has started\./g)).toHaveLength(3);
    // Best-of, visibility and the name stay editable.
    expect(isDisabled(tagWithId(html, 'best-of-(default)'))).toBe(false);
    expect(isDisabled(tagWithId(html, 'team-visibility'))).toBe(false);
  });

  it('locks only the requested controls', () => {
    const html = renderToStaticMarkup(
      <TournamentForm
        rulesets={rulesets}
        onSubmit={noopSubmit}
        mode="edit"
        initialData={stored}
        lockedFields={{ doubles: true }}
      />,
    );
    expect(isDisabled(tagWithId(html, 'isDoubles'))).toBe(true);
    expect(isDisabled(tagWithId(html, 'bracket-type'))).toBe(false);
    expect(html.match(/Locked: the tournament has started\./g)).toHaveLength(1);
  });

  it('lists a stored legacy best-of in sorted position and selects it', () => {
    const html = renderToStaticMarkup(
      <TournamentForm
        rulesets={rulesets}
        onSubmit={noopSubmit}
        mode="edit"
        initialData={{ ...stored, best_of_default: 4 }}
      />,
    );
    expect(optionValues(html, 'best-of-(default)')).toEqual([1, 3, 4, 5, 7, 9, 11, 13, 15]);
    expect(html).toMatch(/<option value="4" selected="">Bo4<\/option>/);
  });

  it('renders German labels with umlauts intact', () => {
    const html = renderWithI18n(
      <TournamentForm
        rulesets={rulesets}
        onSubmit={noopSubmit}
        mode="edit"
        submitLabel="Änderungen speichern"
        initialData={stored}
        lockedFields={{ bracketType: true, ruleset: true, doubles: true }}
      />,
      { locale: 'de' },
    );

    expect(html).toContain('Änderungen speichern');
    expect(html).toContain('Gesperrt: Das Turnier ist gestartet.');
    expect(html).toContain('Turniermodus');
    expect(html).not.toContain('Locked:');
    expect(html).not.toMatch(/\u00c3|\u00e2\u20ac/);
  });
});
