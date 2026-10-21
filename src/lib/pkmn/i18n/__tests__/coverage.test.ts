// Coverage of the generated German dictionaries against the app's own @pkmn universe (design pkmn-l10n.md §1.3–§1.6, §7).
// Server-side test: it may import @pkmn/dex. Reads the committed data and the reviewed override tables from disk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { describe, expect, it } from 'vitest';
import species from '../data/species.de.json';
import moves from '../data/moves.de.json';
import items from '../data/items.de.json';
import abilities from '../data/abilities.de.json';
import misc from '../data/misc.de.json';
import movesDesc from '../data/moves.desc.de.json';
import abilitiesDesc from '../data/abilities.desc.de.json';
import itemsDesc from '../data/items.desc.de.json';
import meta from '../data/_meta.json';

type Kind = 'species' | 'moves' | 'items' | 'abilities' | 'natures' | 'types';
type NameMap = Readonly<Record<string, string>>;

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const OVERRIDES_DIR = join(REPO_ROOT, 'scripts', 'pkmn-i18n', 'overrides');
const PINNED_COMMIT = '2fe95532d27a9bf340575253aff50868319d8182';

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${path}: not an object`);
  const out = { ...(parsed as Record<string, unknown>) };
  delete out._comment;
  return out;
}

function stringMap(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object') throw new Error(`${label}: not an object`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') throw new Error(`${label}.${k}: not a string`);
    out[k] = v;
  }
  return out;
}

const DICTS: Record<Kind, NameMap> = {
  species,
  moves,
  items,
  abilities,
  natures: misc.natures,
  types: misc.types,
};

const gens = new Generations(Dex);
const KINDS: Kind[] = ['species', 'moves', 'items', 'abilities', 'natures', 'types'];

function gen9Ids(kind: Kind): string[] {
  return [...gens.get(9)[kind]].map((e) => e.id).filter(Boolean);
}

function natdexIds(kind: Kind): string[] {
  const ids = new Set<string>();
  for (let g = 1; g <= 9; g++) for (const e of gens.get(g)[kind]) if (e.id) ids.add(e.id);
  return [...ids].sort();
}

const allowlist = readJson(join(OVERRIDES_DIR, 'fallback-allowlist.json'));
const allowedFor = (kind: Kind): Record<string, string> =>
  allowlist[kind] === undefined ? {} : stringMap(allowlist[kind], `fallback-allowlist.${kind}`);

describe('German dictionary coverage', () => {
  it.each(KINDS)('every Gen 9 %s id has a non-empty German entry', (kind) => {
    const ids = gen9Ids(kind);
    expect(ids.length).toBeGreaterThan(0);
    const missing = ids.filter((id) => !DICTS[kind][id]?.trim());
    expect(missing).toEqual([]);
  });

  it.each(KINDS)('every NatDex %s id has an entry or a fallback-allowlist row', (kind) => {
    const allowed = allowedFor(kind);
    const missing = natdexIds(kind).filter((id) => !DICTS[kind][id] && !Object.hasOwn(allowed, id));
    expect(missing).toEqual([]);
  });

  it('allowlist rows are still missing, never Gen 9, and carry a reason', () => {
    for (const kind of Object.keys(allowlist)) {
      expect(KINDS).toContain(kind);
      const k = kind as Kind;
      const gen9 = new Set(gen9Ids(k));
      const natdex = new Set(natdexIds(k));
      for (const [id, reason] of Object.entries(allowedFor(k))) {
        expect(DICTS[k][id], `stale allowlist row ${kind}:${id}`).toBeUndefined();
        expect(gen9.has(id), `Gen 9 id allowlisted: ${kind}:${id}`).toBe(false);
        expect(natdex.has(id), `allowlist row outside the universe: ${kind}:${id}`).toBe(true);
        expect(reason.trim()).not.toBe('');
      }
    }
  });

  it('the 14 Gen-2 relic items are the only allowlisted ids', () => {
    expect(Object.keys(allowlist)).toEqual(['items']);
    expect(Object.keys(allowedFor('items'))).toHaveLength(14);
  });

  it('every override key is a real @pkmn id', () => {
    const real = (kind: 'species' | 'abilities' | 'items' | 'moves', id: string): boolean => {
      const e = Dex[kind].get(id);
      return e.exists && e.id === id;
    };
    const bad: string[] = [];
    for (const id of Object.keys(readJson(join(OVERRIDES_DIR, 'forms.de.json')))) if (!real('species', id)) bad.push(`forms:${id}`);
    for (const id of Object.keys(readJson(join(OVERRIDES_DIR, 'abilities.de.json')))) if (!real('abilities', id)) bad.push(`abilities:${id}`);
    for (const id of Object.keys(readJson(join(OVERRIDES_DIR, 'items.de.json')))) if (!real('items', id)) bad.push(`items:${id}`);
    const descKind = { move: 'moves', ability: 'abilities', item: 'items' } as const;
    for (const key of Object.keys(readJson(join(OVERRIDES_DIR, 'desc.de.json')))) {
      const m = /^(move|ability|item):([a-z0-9]+)$/.exec(key);
      if (!m || !real(descKind[m[1] as keyof typeof descKind], m[2])) bad.push(`desc:${key}`);
    }
    for (const [kind, rows] of Object.entries(allowlist)) {
      for (const id of Object.keys(stringMap(rows, kind))) {
        const dexKind = kind === 'natures' || kind === 'types' ? kind : (kind as 'species' | 'abilities' | 'items' | 'moves');
        if (!Dex[dexKind].get(id).exists) bad.push(`allowlist:${kind}:${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('override values reach the generated data', () => {
    const forms = stringMap(readJson(join(OVERRIDES_DIR, 'forms.de.json')), 'forms');
    for (const [id, name] of Object.entries(forms)) expect(species[id as keyof typeof species]).toBe(name);
    expect(species.pikachualola).toBe('Pikachu (Alola-Kappe)');
    expect(species.ursalunabloodmoon).toBe('Blutmond-Ursaluna');
  });

  it('_meta.json names the pinned commit, the license and the generator', () => {
    const source = readJson(join(REPO_ROOT, 'scripts', 'pkmn-i18n', 'source.json'));
    expect(meta.commit).toBe(PINNED_COMMIT);
    expect(source.commit).toBe(PINNED_COMMIT);
    expect(meta.source).toBe('PokeAPI/pokeapi');
    expect(meta.license).toBe('BSD-3-Clause');
    expect(meta.generator).toBe('scripts/pkmn-i18n/generate.mjs');
    expect(meta.csvSha256).toEqual(source.csvSha256);
    expect(meta.counts['species.de.json']).toBe(Object.keys(species).length);
    expect(meta).not.toHaveProperty('generatedAt');
  });

  it('no value is empty, "undefined" or padded, and no key is empty', () => {
    const files: Record<string, unknown> = {
      species, moves, items, abilities, misc, movesDesc, abilitiesDesc, itemsDesc,
    };
    const bad: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'string') {
        if (!value || value !== value.trim() || value.includes('undefined')) bad.push(path);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (!k) bad.push(`${path}.<empty key>`);
          walk(v, `${path}.${k}`);
        }
      } else bad.push(`${path} (${typeof value})`);
    };
    for (const [name, data] of Object.entries(files)) walk(data, name);
    expect(bad).toEqual([]);
  });

  it('descriptions carry no soft hyphens or line breaks', () => {
    const texts = [...Object.values(movesDesc), ...Object.values(abilitiesDesc), ...Object.values(itemsDesc)];
    expect(texts.length).toBeGreaterThan(1000);
    expect(texts.filter((t) => /[\u00ad\n\r\f]/.test(t))).toEqual([]);
  });
});
