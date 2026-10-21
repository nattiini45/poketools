import { describe, expect, it } from 'vitest';
import { computeLineUtility } from '../utility-matches.server';

// Flabébé's line learns Synthesis, a Recovery member of the example pack (the public suite's pack).
const RECOVERY_MOVE = 'synthesis';

describe('computeLineUtility species lookup', () => {
  it('resolves accented names without species_ids through the app toID fold (Flabébé → flabebe)', async () => {
    const matches = await computeLineUtility(
      { base_pokemon: 'Flabébé', stage2_pokemon: 'Floette', stage3_pokemon: 'Florges' },
      new Set(),
    );
    // Resolving Flabébé puts the earliest stage of the move at 1.
    expect(matches.find((m) => m.via.id === RECOVERY_MOVE)?.stage).toBe(1);
  });

  it('accepts a decomposed (NFD) name the same way', async () => {
    const nfd = 'Flabébé'.normalize('NFD');
    const matches = await computeLineUtility(
      { base_pokemon: nfd, stage2_pokemon: 'Floette', stage3_pokemon: 'Florges' },
      new Set(),
    );
    expect(matches.find((m) => m.via.id === RECOVERY_MOVE)?.stage).toBe(1);
  });

  it('prefers species_ids when given', async () => {
    const matches = await computeLineUtility(
      {
        base_pokemon: 'Flabébé',
        stage2_pokemon: 'Floette',
        stage3_pokemon: 'Florges',
        species_ids: { base: 'flabebe', stage2: 'floette', stage3: 'florges' },
      },
      new Set(),
    );
    expect(matches.find((m) => m.via.id === RECOVERY_MOVE)?.stage).toBe(1);
  });
});
