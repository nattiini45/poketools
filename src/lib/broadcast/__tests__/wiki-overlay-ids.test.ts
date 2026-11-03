import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Dex } from '@pkmn/dex';
import { getAbilityNatDex, getItemNatDex, getMoveNatDex, getSpeciesNatDex } from '@/lib/pkmn/dex';
import { collectHiddenPowerTypes, collectWikiOverlayIds } from '../../../../scripts/generate-wiki-overlay-ids.mjs';
import { isUnknownWikiDetailName, isUnknownWikiOverlayName, WIKI_OVERLAY_TERA_TYPES } from '../wiki-overlay-lookup';

const base = '/broadcast/wiki';

describe('wiki overlay id list', () => {
  it('is what the generator writes from the installed @pkmn data', () => {
    const ids = collectWikiOverlayIds();
    const file = readFileSync(new URL('../wiki-overlay-ids.generated.ts', import.meta.url), 'utf8');
    expect(file).toContain(JSON.stringify(ids.moves.join('|')));
    expect(file).toContain(JSON.stringify(ids.items.join('|')));
    expect(file).toContain(JSON.stringify(ids.abilities.join('|')));
    expect(file).toContain(JSON.stringify(ids.species.join('|')));
    expect(file).toContain(JSON.stringify(collectHiddenPowerTypes().join('|')));
  });

  it('agrees with the NatDex move resolver for every Hidden Power spelling', () => {
    const types = [...Dex.types.all()].map((type) => type.id);
    const spellings = ['hiddenpower', 'hiddenpower60', 'hiddenpowerx', 'hiddenpowerfire60x', 'hiddenpowerfirex', 'hiddenpowerstellar'];
    for (const type of ['', ...types]) for (const power of ['', '60', '70', '30']) spellings.push(`hiddenpower${type}${power}`);
    const mismatches = spellings.filter(
      (id) => isUnknownWikiOverlayName(`/broadcast/wiki/moves/${id}`) !== (getMoveNatDex(id) === null),
    );
    expect(mismatches).toEqual([]);
  });

  it('agrees with the NatDex resolvers the pages use for every id and alias the dex knows', () => {
    const candidates = new Set<string>(Object.keys(Dex.data.Aliases));
    for (const key of Object.keys(Dex.data.Moves)) candidates.add(key);
    for (const key of Object.keys(Dex.data.Items)) candidates.add(key);
    for (const key of Object.keys(Dex.data.Abilities)) candidates.add(key);

    const mismatches: string[] = [];
    for (const id of candidates) {
      const unknownMove = isUnknownWikiOverlayName(`${base}/moves/${id}`);
      const unknownItem = isUnknownWikiOverlayName(`${base}/items/${id}`);
      const unknownAbility = isUnknownWikiOverlayName(`${base}/abilities/${id}`);
      if (unknownMove !== (getMoveNatDex(id) === null)) mismatches.push(`moves/${id}`);
      if (unknownItem !== (getItemNatDex(id) === null)) mismatches.push(`items/${id}`);
      if (unknownAbility !== (getAbilityNatDex(id) === null)) mismatches.push(`abilities/${id}`);
    }
    expect(mismatches).toEqual([]);
  });
});

describe('isUnknownWikiOverlayName', () => {
  it('lets valid names through however they are spelled or encoded', () => {
    expect(isUnknownWikiOverlayName(`${base}/moves/Thunderbolt`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/moves/thunder-bolt`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/moves/Thunder%20Wave`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/items/Leftovers`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/items/Choice%20Specs/`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/abilities/Static`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/abilities/Intimidate`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/moves/Hidden%20Power%20Fire%2060`)).toBe(false);
  });

  it('flags names that resolve to nothing', () => {
    expect(isUnknownWikiOverlayName(`${base}/moves/NotAMove`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/abilities/NotAnAbility`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/items/NotAnItem`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/tera/NotAType`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/moves/%E0%A4%A`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/moves/---`)).toBe(true);
  });

  it('knows a move is not an item', () => {
    expect(isUnknownWikiOverlayName(`${base}/items/Thunderbolt`)).toBe(true);
    expect(isUnknownWikiOverlayName(`${base}/abilities/Leftovers`)).toBe(true);
  });

  it('accepts every tera type case-insensitively, as the page does', () => {
    for (const type of WIKI_OVERLAY_TERA_TYPES) {
      expect(isUnknownWikiOverlayName(`${base}/tera/${type}`)).toBe(false);
      expect(isUnknownWikiOverlayName(`${base}/tera/${type.toUpperCase()}`)).toBe(false);
    }
    expect(isUnknownWikiOverlayName(`${base}/tera/Fire!`)).toBe(true);
  });

  it('ignores every other path', () => {
    expect(isUnknownWikiOverlayName(`${base}/pokemon/NotAMon`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/moves`)).toBe(false);
    expect(isUnknownWikiOverlayName(`${base}/moves/a/b`)).toBe(false);
    expect(isUnknownWikiOverlayName('/wiki/moves/NotAMove')).toBe(false);
    expect(isUnknownWikiOverlayName('/broadcast/match/abc')).toBe(false);
  });
});

describe('isUnknownWikiDetailName', () => {
  it('404s an unknown species, move, ability and item and nothing the pages resolve', () => {
    expect(isUnknownWikiDetailName('/pokemon/not-a-real-pokemon')).toBe(true);
    expect(isUnknownWikiDetailName('/wiki/moves/not-a-move')).toBe(true);
    expect(isUnknownWikiDetailName('/wiki/abilities/nope')).toBe(true);
    expect(isUnknownWikiDetailName('/wiki/items/nope/')).toBe(true);
    expect(isUnknownWikiDetailName('/pokemon/%E0%A4%A')).toBe(true);

    expect(isUnknownWikiDetailName('/pokemon/Garchomp')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Mr.%20Mime')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Ho-Oh')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Mega-Charizard-X')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Nidoran%E2%99%80')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Nidoran%E2%99%82')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Flab%C3%A9b%C3%A9')).toBe(false);
    expect(isUnknownWikiDetailName('/pokemon/Farfetch%E2%80%99d')).toBe(false);
    expect(isUnknownWikiDetailName('/wiki/moves/Close%20Combat')).toBe(false);
  });

  it('404s an unknown species written with non-ASCII characters', () => {
    expect(isUnknownWikiDetailName('/pokemon/%E3%83%94%E3%82%AB%E3%83%81%E3%83%A5%E3%82%A6')).toBe(true);
    expect(isUnknownWikiDetailName('/pokemon/Pok%C3%A9mon')).toBe(true);
    expect(isUnknownWikiDetailName('/pokemon/Foo%E2%99%80')).toBe(true);
    expect(isUnknownWikiDetailName('/pokemon/%E2%99%80')).toBe(true);
  });

  it('ignores every other path, the tera pages included', () => {
    for (const path of ['/', '/pokemon', '/pokemon/a/b', '/wiki/tera/nope', '/wiki/moves', '/wiki/pokemon/nope', '/leagues/nope']) {
      expect(isUnknownWikiDetailName(path), path).toBe(false);
    }
  });

  it('never 404s a species the page resolves, for every id, alias and name the dex knows', () => {
    const candidates = new Set<string>(Object.keys(Dex.data.Aliases));
    for (const key of Object.keys(Dex.data.Species)) candidates.add(key);
    for (const species of Dex.species.all()) candidates.add(species.name);

    const falseNotFound: string[] = [];
    const missed: string[] = [];
    for (const name of candidates) {
      let resolves: boolean;
      try {
        resolves = getSpeciesNatDex(name) !== null;
      } catch {
        continue;
      }
      const gate = isUnknownWikiDetailName('/pokemon/' + encodeURIComponent(name));
      if (resolves && gate) falseNotFound.push(name);
      if (!resolves && !gate && !/^(mega|primal|gigantamax)/i.test(name.replace(/[^a-z]/gi, ''))) missed.push(name);
    }
    expect(falseNotFound).toEqual([]);
    expect(missed).toEqual([]);
  });
});