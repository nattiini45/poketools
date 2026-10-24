import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT, isUseClientFile, reachableFiles } from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * Bundle budget of the shared Pokémon-data chokepoints.
 * Each chokepoint imports only the per-kind name module it needs (`names/<kind>`), never the barrel, so a page
 * that renders a type badge does not pay for the species, move, item and ability maps.
 */

const NAME_MAPS = ['species', 'moves', 'items', 'abilities', 'misc'] as const;
type NameMap = (typeof NAME_MAPS)[number];

const DESC_JSON = /[\\/]lib[\\/]pkmn[\\/]i18n[\\/]data[\\/][a-z]+\.desc\.de\.json$/;
const BARREL = path.normalize(path.join(SRC_ROOT, 'lib/pkmn/i18n/names.ts'));

const src = (rel: string) => path.normalize(path.join(SRC_ROOT, rel));
const mapFile = (kind: NameMap) => src(`lib/pkmn/i18n/data/${kind}.de.json`);

/** Which name maps each chokepoint may reach. */
const CHOKEPOINTS: Record<string, readonly NameMap[]> = {
  'components/shared/TypeBadge.tsx': ['misc'],
  'components/shared/TypeIcon.tsx': ['misc'],
  'components/shared/TypeSprite.tsx': ['misc'],
  'components/shared/GymTypedName.tsx': ['misc'],
  'components/teambuilder/StatDisplay.tsx': ['misc'],
  'components/shared/PokemonSprite.tsx': ['species'],
  'components/shared/ItemSprite.tsx': ['items'],
};

describe('chokepoint import graphs', () => {
  for (const [rel, allowed] of Object.entries(CHOKEPOINTS)) {
    describe(rel, () => {
      const files = reachableFiles(src(rel));

      it(`reaches only the ${allowed.join(', ')} name map`, () => {
        const reached = NAME_MAPS.filter((kind) => files.has(mapFile(kind)));
        expect(reached).toEqual([...allowed]);
      });

      it('does not import the names barrel or any description map', () => {
        expect(files.has(BARREL)).toBe(false);
        expect([...files].filter((f) => DESC_JSON.test(f))).toEqual([]);
      });
    });
  }

  it("every chokepoint that calls a hook is a 'use client' module", () => {
    const clientOnly = Object.keys(CHOKEPOINTS).filter((rel) => !rel.endsWith('GymTypedName.tsx'));
    expect(clientOnly.filter((rel) => !isUseClientFile(src(rel)))).toEqual([]);
  });
});
