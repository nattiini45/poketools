import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import { toID } from '../id';
// The generator's copy of the same body (design pkmn-l10n.md §1.4): the two must never drift.
import { toID as generatorToID } from '../../../../../scripts/pkmn-i18n/build.mjs';

function dexNames(): { kind: string; name: string; id: string }[] {
  const out: { kind: string; name: string; id: string }[] = [];
  for (const s of Dex.species.all()) out.push({ kind: 'species', name: s.name, id: s.id });
  for (const i of Dex.items.all()) out.push({ kind: 'item', name: i.name, id: i.id });
  for (const a of Dex.abilities.all()) out.push({ kind: 'ability', name: a.name, id: a.id });
  for (const n of Dex.natures.all()) out.push({ kind: 'nature', name: n.name, id: n.id });
  for (const t of Dex.types.all()) out.push({ kind: 'type', name: t.name, id: t.id });
  for (const m of Dex.moves.all()) out.push({ kind: 'move', name: m.name, id: m.id });
  return out;
}

const isTypedHiddenPower = (e: { kind: string; name: string }) =>
  e.kind === 'move' && /^Hidden Power \w+$/.test(e.name);

describe('toID', () => {
  it.each([
    ['Flabébé', 'flabebe'],
    ['Nidoran♀', 'nidoranf'],
    ['Nidoran♂', 'nidoranm'],
    ['Farfetch’d', 'farfetchd'],
    ['Type: Null', 'typenull'],
    ['Porygon-Z', 'porygonz'],
    ['Jangmo-o', 'jangmoo'],
    ['Ursaluna-Bloodmoon', 'ursalunabloodmoon'],
    ['Poké Ball', 'pokeball'],
    ['', ''],
    ['???', ''],
  ])('%s -> %s', (input, expected) => {
    expect(toID(input)).toBe(expected);
  });

  it('equals the @pkmn id for every Dex species, item, ability, nature, type and move (except typed Hidden Power)', () => {
    const entries = dexNames();
    expect(entries.length).toBeGreaterThan(3000);
    const typedHiddenPower = entries.filter(isTypedHiddenPower);
    expect(typedHiddenPower).toHaveLength(16);
    expect(new Set(typedHiddenPower.map((e) => e.id))).toEqual(new Set(['hiddenpower']));
    const mismatches = entries
      .filter((e) => !isTypedHiddenPower(e))
      .filter((e) => toID(e.name) !== e.id)
      .map((e) => `${e.kind}:${e.name} -> ${toID(e.name)} (expected ${e.id})`);
    expect(mismatches).toEqual([]);
  });

  it('matches the generator copy in scripts/pkmn-i18n/build.mjs on every Dex name and the vectors', () => {
    const names = [...dexNames().map((e) => e.name), 'Flabébé', 'Nidoran♀', 'Farfetch’d', 'Ünïcödé ß', '???'];
    const drift = names.filter((n) => toID(n) !== generatorToID(n));
    expect(drift).toEqual([]);
  });

  it('id.ts has no imports at all (line identity uses it without pulling dictionaries)', () => {
    const src = readFileSync(join(__dirname, '..', 'id.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/^\s*export\s+(\*|\{[^}]*\})\s+from\b/m);
  });
});
