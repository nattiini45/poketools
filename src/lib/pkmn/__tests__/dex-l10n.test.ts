import { describe, it, expect } from 'vitest';

// Real @pkmn data (no mocks): bilingual server search (design pkmn-l10n.md §4.1, §7) and the language-aware
// description wrappers of dex-l10n.server.ts (§3.6). `dex.test.ts` keeps the mocked unit tests.
import {
  searchSpecies,
  searchMoves,
  searchItems,
  searchAbilities,
  searchSpeciesRich,
  searchMovesRich,
  searchMovesForSpecies,
  searchAbilitiesForSpecies,
  searchBaseFormSpecies,
} from '../dex';
import * as l10n from '../dex-l10n.server';
import { toID } from '../i18n/id';

describe('bilingual name search (dex.ts)', () => {
  it('finds Charizard by its German name, in any case, ranked first', () => {
    expect(searchSpecies('Glurak')[0].name).toBe('Charizard');
    expect(searchSpecies('glurak')[0].name).toBe('Charizard');
    expect(searchSpecies('Charizard')[0].name).toBe('Charizard');
  });

  it('ranks an exact match before prefix matches and applies limit after ranking', () => {
    // Charizard's formes ("Mega-Glurak X", "Gigadynamax-Glurak") match "glurak" only by word prefix; the
    // exact match comes first even when only one result is requested.
    expect(searchSpecies('Glurak', 9, 1)).toEqual([{ name: 'Charizard', id: 'charizard' }]);
    const names = searchSpecies('pika').map((r) => r.name);
    expect(names[0]).toBe('Pikachu');
  });

  it('matches umlaut, transliteration and accent variants', () => {
    for (const q of ['Brüllschweif', 'brullschweif', 'bruellschweif']) {
      expect(searchSpecies(q).map((r) => r.name), q).toContain('Scream Tail');
    }
    // Compare ids: the dex name's é may be composed differently from this source file's.
    expect(searchSpecies('Flabébé', 9).map((r) => r.id)).toContain('flabebe');
    expect(searchSpecies('flabebe', 9).map((r) => r.id)).toContain('flabebe');
  });

  it('searchMoves finds Ceaseless Edge by "klingenschwall" and U-turn by "kehrtwende"', () => {
    expect(searchMoves('klingenschwall').map((r) => r.name)).toContain('Ceaseless Edge');
    expect(searchMoves('kehrtwende')[0].name).toBe('U-turn');
    expect(searchMoves('u-turn')[0].name).toBe('U-turn');
    expect(searchMoves('uturn')[0].name).toBe('U-turn');
  });

  it('searchItems / searchAbilities match German names', () => {
    expect(searchItems('Wahlschal')[0].name).toBe('Choice Scarf');
    expect(searchItems('Überreste')[0].name).toBe('Leftovers');
    expect(searchAbilities('Statik')[0].name).toBe('Static');
  });

  it('keeps English matching (old substring behaviour still finds results)', () => {
    expect(searchMoves('thunder').map((r) => r.name)).toContain('Thunderbolt');
    expect(searchMoves('bolt').map((r) => r.name)).toContain('Thunderbolt');
  });

  it('searchSpeciesRich and searchMovesRich return English rows for a German query', () => {
    const [species] = searchSpeciesRich('Glurak');
    expect(species).toMatchObject({ name: 'Charizard', types: ['Fire', 'Flying'] });
    const [move] = searchMovesRich('Kehrtwende');
    expect(move).toMatchObject({ name: 'U-turn', category: 'Physical' });
    expect(move.shortDesc).toMatch(/switch/i);
  });

  it('searchMovesForSpecies("Kehrt", "Landorus-Therian") contains U-turn', async () => {
    const results = await searchMovesForSpecies('Kehrt', 'Landorus-Therian');
    expect(results.map((r) => r.name)).toContain('U-turn');
  });

  it('searchAbilitiesForSpecies ids equal toID(name) (Mind\'s Eye → mindseye)', () => {
    const results = searchAbilitiesForSpecies('', 'Ursaluna-Bloodmoon');
    expect(results.map((r) => r.name)).toContain("Mind's Eye");
    for (const r of results) expect(r.id).toBe(toID(r.name));
  });

  it('searchAbilitiesForSpecies matches German ability names and keeps slot order for an empty query', () => {
    expect(searchAbilitiesForSpecies('Geistiges', 'Ursaluna-Bloodmoon').map((r) => r.name)).toEqual(["Mind's Eye"]);
    // Pikachu: 0 = Static, H = Lightning Rod.
    expect(searchAbilitiesForSpecies('', 'Pikachu').map((r) => r.name)).toEqual(['Static', 'Lightning Rod']);
  });

  it('searchBaseFormSpecies("Glumanda") gives the Charmander line', () => {
    const results = searchBaseFormSpecies('Glumanda');
    expect(results[0]).toMatchObject({ name: 'Charmander', stage2: 'Charmeleon', stage3: 'Charizard' });
  });
});

describe('language-aware descriptions (dex-l10n.server.ts)', () => {
  it("searchItemsRich('wahl', 9, 100, { lang: 'de' }) gives German shortDesc and shortDescLang", () => {
    const rows = l10n.searchItemsRich('wahl', 9, 100, { lang: 'de' });
    const scarf = rows.find((r) => r.name === 'Choice Scarf');
    expect(scarf).toBeDefined();
    expect(scarf!.shortDescLang).toBe('de');
    expect(scarf!.shortDesc).toContain('Initiative');
  });

  it('without lang (or with en) the rows equal the dex.ts rows', () => {
    const plain = l10n.searchItemsRich('wahl', 9, 100);
    expect(plain.every((r) => r.shortDescLang === undefined)).toBe(true);
    expect(l10n.searchItemsRich('wahl', 9, 100, { lang: 'en' })).toEqual(plain);
  });

  it('marks an English fallback for SV-new entries (no German game text)', () => {
    const [edge] = l10n.searchMovesRich('Ceaseless Edge', 9, 1, { lang: 'de' });
    expect(edge.name).toBe('Ceaseless Edge');
    expect(edge.shortDescLang).toBe('en');
    expect(edge.shortDesc.length).toBeGreaterThan(0);
  });

  it('localizes the species-filtered and listing functions', async () => {
    const moves = await l10n.searchMovesForSpecies('Kehrt', 'Landorus-Therian', 9, 20, { lang: 'de' });
    const uturn = moves.find((m) => m.name === 'U-turn');
    expect(uturn?.shortDescLang).toBe('de');
    expect(uturn?.shortDesc).toMatch(/tauscht/);

    const listed = await l10n.listMovesForSpecies('Landorus-Therian', 9, { lang: 'de' });
    expect(listed.find((m) => m.name === 'U-turn')?.shortDescLang).toBe('de');

    const abilities = l10n.searchAbilitiesForSpecies('', 'Pikachu', 9, { lang: 'de' });
    expect(abilities[0]).toMatchObject({ name: 'Static', id: 'static', shortDescLang: 'de' });

    const items = l10n.getAllItems(9, { lang: 'de' });
    const leftovers = items.find((i) => i.name === 'Leftovers');
    expect(leftovers?.descLang).toBe('de');
    expect(leftovers?.desc).toMatch(/KP/);
    expect(l10n.getAllAbilities(9).every((a) => a.descLang === undefined)).toBe(true);
  });

  it('description search in German also matches German text and names', () => {
    const byGermanDesc = l10n.searchItemsByDescription('initiative schal', 9, 100, { lang: 'de' });
    expect(byGermanDesc.map((r) => r.name)).toContain('Choice Scarf');
    const byGermanName = l10n.searchItemsByDescription('ueberreste', 9, 100, { lang: 'de' });
    expect(byGermanName.map((r) => r.name)).toContain('Leftovers');
    expect(byGermanName.find((r) => r.name === 'Leftovers')?.shortDescLang).toBe('de');
    const ability = l10n.searchAbilitiesByDescription('boden immunität', 9, 100, { lang: 'de' });
    expect(ability.map((r) => r.name)).toContain('Levitate');
  });

  it('description search without lang is the English dex.ts search', () => {
    const rows = l10n.searchItemsByDescription('initiative', 9, 100);
    expect(rows.map((r) => r.name)).not.toContain('Choice Scarf');
  });
});
