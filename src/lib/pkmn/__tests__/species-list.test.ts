import { describe, it, expect } from 'vitest';
import { listSpeciesForFormat } from '../species-list';

// Real-dex tests (no mocks) — exercise the live @pkmn/dex data, like dex.test.ts.

function byName<T extends { name: string }>(list: T[], name: string): T | undefined {
  return list.find((p) => p.name === name);
}

describe('listSpeciesForFormat', () => {
  describe('no format', () => {
    const list = listSpeciesForFormat(9);

    it('marks every species legal', () => {
      expect(list.every((p) => p.legal)).toBe(true);
    });

    it('includes a display tier and base stats', () => {
      const garchomp = byName(list, 'Garchomp');
      expect(garchomp).toBeDefined();
      expect(garchomp!.tier).toBeTruthy();
      expect(garchomp!.baseStats.spe).toBeGreaterThan(0);
    });

    it('sorts alphabetically', () => {
      const names = list.map((p) => p.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });
  });

  describe('gen9ou', () => {
    const list = listSpeciesForFormat(9, 'gen9ou');
    const legalNames = new Set(list.filter((p) => p.legal).map((p) => p.name));

    it('hides Uber/AG Pokémon', () => {
      // Koraidon/Miraidon are restricted legendaries (Uber), never OU-legal.
      expect(legalNames.has('Koraidon')).toBe(false);
      expect(legalNames.has('Miraidon')).toBe(false);
      expect(legalNames.has('Zacian-Crowned')).toBe(false);
    });

    it('keeps lower-tier Pokémon legal (UU/RU/NFE/LC stay in OU)', () => {
      // An NFE mon and a low-tier mon should remain legal in OU.
      const haunter = byName(list, 'Haunter');
      expect(haunter?.legal).toBe(true);
      expect(haunter?.tier).toBe('NFE');
    });
  });

  describe('gen9uu', () => {
    const list = listSpeciesForFormat(9, 'gen9uu');
    const legalNames = new Set(list.filter((p) => p.legal).map((p) => p.name));

    it('hides OU and UUBL Pokémon', () => {
      // Anything classified strictly above UU (OU, UUBL, Uber, …) is illegal.
      const ouMons = list.filter((p) => p.tier === 'OU');
      expect(ouMons.length).toBeGreaterThan(0);
      expect(ouMons.every((p) => !p.legal)).toBe(true);
      const uublMons = list.filter((p) => p.tier === 'UUBL');
      expect(uublMons.every((p) => !p.legal)).toBe(true);
    });

    it('keeps UU and below legal', () => {
      const uuMons = list.filter((p) => p.tier === 'UU');
      expect(uuMons.length).toBeGreaterThan(0);
      expect(uuMons.every((p) => p.legal)).toBe(true);
      expect(legalNames.size).toBeGreaterThan(0);
    });
  });

  describe('gen9zu', () => {
    // Validates the TIER_KEY_TO_DEX `zu` fix — without it, ZU had an empty banlist.
    const list = listSpeciesForFormat(9, 'gen9zu');

    it('hides PU and everything above it', () => {
      const puMons = list.filter((p) => p.tier === 'PU');
      expect(puMons.length).toBeGreaterThan(0);
      expect(puMons.every((p) => !p.legal)).toBe(true);
      const ouMons = list.filter((p) => p.tier === 'OU');
      expect(ouMons.every((p) => !p.legal)).toBe(true);
    });
  });

  describe('gen9lc', () => {
    const list = listSpeciesForFormat(9, 'gen9lc');

    it('only LC-tier Pokémon are legal', () => {
      const legal = list.filter((p) => p.legal);
      expect(legal.length).toBeGreaterThan(0);
      expect(legal.every((p) => p.tier === 'LC')).toBe(true);
    });

    it('hides non-LC Pokémon', () => {
      const garchomp = byName(list, 'Garchomp');
      expect(garchomp?.legal).toBe(false);
    });

    it('respects the explicit LC banlist (Diglett)', () => {
      const diglett = byName(list, 'Diglett');
      expect(diglett?.legal).toBe(false);
    });
  });

  describe('gen9nfe', () => {
    const list = listSpeciesForFormat(9, 'gen9nfe');

    it('is legal only for Pokémon that can still evolve', () => {
      // Haunter evolves into Gengar → legal; Garchomp is fully evolved → illegal.
      expect(byName(list, 'Haunter')?.legal).toBe(true);
      expect(byName(list, 'Garchomp')?.legal).toBe(false);
    });
  });

  describe('gen9doublesou', () => {
    const list = listSpeciesForFormat(9, 'gen9doublesou');

    it('derives tier from the doubles hierarchy', () => {
      const douMons = list.filter((p) => p.tier === 'DOU');
      expect(douMons.length).toBeGreaterThan(0);
      expect(douMons.every((p) => p.legal)).toBe(true);
    });

    it('hides DUber Pokémon', () => {
      const duberMons = list.filter((p) => p.tier === 'DUber');
      expect(duberMons.every((p) => !p.legal)).toBe(true);
    });
  });

  describe('gen9vgc and unknown formats', () => {
    it('vgc leaves every species legal', () => {
      const list = listSpeciesForFormat(9, 'gen9vgc');
      expect(list.every((p) => p.legal)).toBe(true);
    });

    it('an unknown format leaves every species legal', () => {
      const list = listSpeciesForFormat(9, 'gen9notarealtier');
      expect(list.every((p) => p.legal)).toBe(true);
    });
  });
});
