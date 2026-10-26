import { describe, expect, it } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { buildFixtureCatalog, buildFixtureIndex, stubNames } from '@/lib/draft-finder/__tests__/fixture-index';
import { TYPES } from '@/lib/pkmn/type-chart';
import TeamWeaknessTable, { weaknessRows, type TeamWeaknessTableProps } from '../left/TeamWeaknessTable';
import styles from '../draft-tool.module.css';

const catalog = buildFixtureCatalog();
const ix = prepareIndex(buildFixtureIndex(), stubNames);
const line = (id: string): DraftLineCatalogEntry => catalog.lines.find((l) => l.lineId === id)!;

const GENGAR = line('gastly--gengar');
const URSALUNA = line('teddiursa--ursaluna');
const noop = () => {};

function render(patch: Partial<TeamWeaknessTableProps> = {}, locale: 'en' | 'de' = 'en'): string {
  return renderWithI18n(
    <TeamWeaknessTable owned={[GENGAR, URSALUNA]} ix={ix} indexFailed={false} stage="final" onStageChange={noop} onPin={noop} {...patch} />,
    { locale },
  );
}

/** The body rows (`<tr>` of `<tbody>`) as HTML. */
const bodyRows = (html: string) => /<tbody>([\s\S]*)<\/tbody>/.exec(html)![1].split('</tr>').filter((r) => r.includes('<tr'));
/** The cell texts of one row (without the row header). */
const cells = (row: string) => [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

describe('weaknessRows', () => {
  it('reads each owned line at the selected stage: Normal at base, Ground / Normal at final', () => {
    const [base] = weaknessRows([URSALUNA], ix, 'base');
    const [final] = weaknessRows([URSALUNA], ix, 'final');
    expect(base.name).toBe('Teddiursa');
    expect(final.name).toBe('Ursaluna');
    expect(base.profile![TYPES.indexOf('Water')]).toBe(1);
    expect(final.profile![TYPES.indexOf('Water')]).toBe(2);
  });

  it('has no profile (no data) for a line the index does not know', () => {
    const lonely = { ...GENGAR, lineId: 'unindexed--line' };
    expect(weaknessRows([lonely], ix, 'final')[0].profile).toBeNull();
  });

  it('has no profile for a stage whose types the index could not resolve', () => {
    const raw = buildFixtureIndex();
    const line = raw.lines.find((l) => l.lineId === 'gastly--gengar')!;
    line.stages[2].types = [];
    const row = weaknessRows([GENGAR], prepareIndex(raw, stubNames), 'final')[0];
    expect(row.profile).toBeNull();
    expect(weaknessRows([GENGAR], prepareIndex(raw, stubNames), 'base')[0].profile).not.toBeNull();
  });
});

describe('TeamWeaknessTable', () => {
  it('is a collapsed disclosure titled "Team weaknesses"', () => {
    const html = render();
    expect(html).toMatch(/^<details [^>]*>/);
    expect(html).not.toContain('<details open');
    expect(html).toMatch(/<summary [^>]*>Team weaknesses<\/summary>/);
  });

  it('switches Base | Final with the persisted stage (Final checked by default)', () => {
    const html = render();
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Typing of"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Final</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Base</);
    expect(render({ stage: 'base' })).toMatch(/aria-checked="true"[^>]*>Base</);
  });

  it('has the Pokémon as rows, the 18 attacking types as vertical column heads, and a caption', () => {
    const html = render();
    expect(html).toContain('<caption class="sr-only">Damage your roster takes, by attacking type</caption>');
    expect(bodyRows(html)).toHaveLength(2);
    const heads = /<thead>([\s\S]*)<\/thead>/.exec(html)![1];
    expect([...heads.matchAll(/<th scope="col"/g)]).toHaveLength(1 + TYPES.length);
    expect(heads.match(new RegExp(styles.weaknessTypeHead, 'g'))).toHaveLength(TYPES.length);
    for (const type of TYPES) expect(heads).toContain(`>${type}</span>`);
  });

  it('names each row by the selected stage’s Pokémon: sprite button, accessible name, title', () => {
    expect(render()).toMatch(/<th scope="row"[^>]*><button type="button" aria-label="Gengar" title="Gengar"/);
    const base = render({ stage: 'base' });
    expect(base).toContain('aria-label="Gastly"');
    expect(base).toContain('aria-label="Teddiursa"');
  });

  it('shows the multiplier text in the cells, blank for 1×, with tone classes (never red)', () => {
    const html = render();
    const [gengar, ursaluna] = bodyRows(html).map(cells);
    const col = (type: (typeof TYPES)[number]) => TYPES.indexOf(type);
    // Gengar (Ghost / Poison): Ground 2×, Psychic 2×, Ghost 2×, Dark 2×; Normal and Fighting 0×; Bug ¼×.
    expect(gengar[col('Ground')]).toBe('2×');
    expect(gengar[col('Normal')]).toBe('0×');
    expect(gengar[col('Fighting')]).toBe('0×');
    expect(gengar[col('Bug')]).toBe('¼×');
    expect(gengar[col('Water')]).toBe('');
    // Ursaluna (Ground / Normal): Water 2×, Electric 0×, Poison ½×.
    expect(ursaluna[col('Water')]).toBe('2×');
    expect(ursaluna[col('Electric')]).toBe('0×');
    expect(ursaluna[col('Poison')]).toBe('½×');
    expect(html).toContain(styles.weaknessWeak);
    expect(html).toContain(styles.weaknessResist);
    expect(html).toContain(styles.weaknessImmune);
    expect(html).not.toMatch(/danger|red-/);
  });

  it('marks a 4× weakness stronger than a 2× one', () => {
    // Gengar (Ghost / Poison) and Ursaluna (Ground / Normal) have no 4× weakness.
    expect(render()).not.toContain(styles.weaknessQuad);
    const raw = buildFixtureIndex();
    raw.lines.find((l) => l.lineId === 'gastly--gengar')!.stages[2].types = ['Ground', 'Rock'];
    const html = render({ ix: prepareIndex(raw, stubNames) });
    expect(html).toContain(styles.weaknessQuad);
    expect(cells(bodyRows(html)[0])[TYPES.indexOf('Water')]).toBe('4×');
  });

  it('counts Weak / Resist / Immune per attacking type under the table', () => {
    const html = render();
    const foot = /<tfoot>([\s\S]*)<\/tfoot>/.exec(html)![1];
    const rows = foot.split('</tr>').filter((r) => r.includes('<tr'));
    expect(rows.map((r) => />([^<]*)<\/th>/.exec(r)![1])).toEqual(['Weak', 'Resist', 'Immune']);
    const [weak, resist, immune] = rows.map(cells);
    const col = (type: (typeof TYPES)[number]) => TYPES.indexOf(type);
    // Ground: Gengar 2×, Ursaluna 1× -> 1 weak. Water: Ursaluna 2×. Electric: Ursaluna immune. Normal: Gengar immune.
    expect(weak[col('Ground')]).toBe('1');
    expect(weak[col('Water')]).toBe('1');
    expect(immune[col('Electric')]).toBe('1');
    expect(immune[col('Normal')]).toBe('1');
    expect(resist[col('Poison')]).toBe('2'); // Gengar ½×, Ursaluna ½×
    expect(weak).toHaveLength(TYPES.length);
  });

  it('follows the stage: the base typing of a line that changes type', () => {
    const base = bodyRows(render({ owned: [URSALUNA], stage: 'base' })).map(cells)[0];
    expect(base[TYPES.indexOf('Water')]).toBe('');
    expect(base[TYPES.indexOf('Fighting')]).toBe('2×');
    expect(base[TYPES.indexOf('Ghost')]).toBe('0×');
    const final = bodyRows(render({ owned: [URSALUNA], stage: 'final' })).map(cells)[0];
    expect(final[TYPES.indexOf('Water')]).toBe('2×');
  });

  it('shows "no data" for a line without types and leaves it out of the counts', () => {
    const raw = buildFixtureIndex();
    raw.lines.find((l) => l.lineId === 'gastly--gengar')!.stages[2].types = [];
    const html = render({ ix: prepareIndex(raw, stubNames) });
    expect(html).toContain('No type data for this line.');
    expect(html).toContain(`colSpan="${TYPES.length}"`);
    const foot = /<tfoot>([\s\S]*)<\/tfoot>/.exec(html)![1];
    const weak = cells(foot.split('</tr>')[0]);
    expect(weak[TYPES.indexOf('Ground')]).toBe('0'); // only Ursaluna counts, and it is not weak to Ground
  });

  it('says it is typing only', () => {
    expect(render()).toContain('Typing only: abilities are not counted.');
  });

  it('shows a loading line, not a table, while the index loads', () => {
    const html = render({ ix: null });
    expect(html).toContain('Loading types …');
    expect(html).not.toContain('<table');
    expect(html).toMatch(/<summary [^>]*>Team weaknesses<\/summary>/);
  });

  it('is hidden when the index failed', () => {
    expect(render({ ix: null, indexFailed: true })).toBe('');
  });

  it('renders in German with the German type names', () => {
    const html = renderWithI18n(
      <TeamWeaknessTable owned={[GENGAR, URSALUNA]} ix={ix} indexFailed={false} stage="base" onStageChange={noop} onPin={noop} />,
      { locale: 'de' },
    );
    expect(html).toMatch(/<summary [^>]*>Team-Schwächen<\/summary>/);
    expect(html).toContain('aria-label="Typen der"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Basis</);
    expect(html).toMatch(/aria-checked="false"[^>]*>Endstufe</);
    expect(html).toContain('>Feuer</span>');
    expect(html).toContain('>Unlicht</span>');
    for (const label of ['Schwach', 'Resistent', 'Immun']) expect(html).toContain(`>${label}</th>`);
    expect(html).toContain('Nur Typen: Fähigkeiten zählen nicht.');
  });
});
