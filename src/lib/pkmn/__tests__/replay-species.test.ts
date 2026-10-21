import { describe, it, expect } from 'vitest';
import {
  isSameReplayPokemonEntity,
  replaySpeciesEntityKey,
  stripHiddenPreviewSuffix,
} from '../replay-species';

describe('stripHiddenPreviewSuffix', () => {
  it('removes Showdown hidden preview suffix', () => {
    expect(stripHiddenPreviewSuffix('Greninja-*')).toBe('Greninja');
    expect(stripHiddenPreviewSuffix('Zamazenta-*')).toBe('Zamazenta');
  });

  it('leaves normal species names unchanged', () => {
    expect(stripHiddenPreviewSuffix('Mimikyu')).toBe('Mimikyu');
    expect(stripHiddenPreviewSuffix('Rotom-Wash')).toBe('Rotom-Wash');
  });
});

describe('isSameReplayPokemonEntity', () => {
  it('treats Mimikyu and Mimikyu-Busted as the same entity', () => {
    expect(isSameReplayPokemonEntity('Mimikyu', 'Mimikyu-Busted')).toBe(true);
  });

  it('does not merge distinct species on different slots', () => {
    expect(isSameReplayPokemonEntity('Rotom-Wash', 'Rotom-Heat')).toBe(false);
  });

  it('merges hidden preview with revealed species', () => {
    expect(isSameReplayPokemonEntity('Greninja-*', 'Greninja')).toBe(true);
  });
});

describe('replaySpeciesEntityKey', () => {
  it('maps formes to base species', () => {
    expect(replaySpeciesEntityKey('Mimikyu-Busted')).toBe('Mimikyu');
  });
});
