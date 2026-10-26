/**
 * The `custom` league type (Format Studio) through the surface seams: the doubles flag is derived in one place,
 * the capabilities match what the format kit derives, and the sakura park serves the type.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESETS, deriveCapabilities } from '@/lib/format-kit';
import { getRegisteredRouteThemeIds, getSeasonWorld, getWorldByRouteThemeId } from '@/lib/worlds/registry';
import { getFormatCapabilities } from '../format-capabilities';
import { isLeagueDoubles } from '../format-utils';

const ROOT = process.cwd();

/** The three places that used to read the doubles flag off the league type alone. */
const DOUBLES_SITES = [
  'src/app/(public)/leagues/[id]/page.tsx',
  'src/lib/league-hub/load.ts',
  'src/app/(public)/insights/page.tsx',
] as const;

describe('the doubles flag of a league', () => {
  it.each(DOUBLES_SITES)('%s derives it through isLeagueDoubles, not from the league type alone', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    expect(source).not.toMatch(/format_type\s*===\s*['"]doubles['"]/);
    expect(source).toContain('isLeagueDoubles(');
  });

  const doubles = { is_doubles: true };
  const singles = { is_doubles: false };
  const STAGES = [[], [singles], [doubles], [doubles, doubles], [doubles, singles]];

  it('matrix: four classic types x stage mixes follow the type, custom follows the stages', () => {
    for (const stages of STAGES) {
      expect(isLeagueDoubles('singles', stages)).toBe(false);
      expect(isLeagueDoubles('draft', stages)).toBe(false);
      expect(isLeagueDoubles('evolution_point_buy', stages)).toBe(false);
      expect(isLeagueDoubles('doubles', stages)).toBe(true);
      expect(isLeagueDoubles('custom', stages)).toBe(stages.length > 0 && stages.every((s) => s.is_doubles));
    }
  });
});

describe('custom capabilities', () => {
  it('equal what the kit derives for the shipped example formats (none declares a legacy module)', () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const { id, definition } of PRESETS) {
      expect(definition.modules, id).toEqual([]);
      expect(deriveCapabilities(definition), id).toEqual(getFormatCapabilities('custom'));
    }
  });

  it('turn nothing on, so no legacy draft, token or core section shows for a custom league', () => {
    expect(Object.values(getFormatCapabilities('custom')).every((flag) => flag === false)).toBe(true);
  });
});

describe('the world of a custom league', () => {
  it('is the sakura park: a registered world, not the default-world safety net', () => {
    const world = getSeasonWorld('custom');
    expect(world.id).toBe('sakura');
    expect(getRegisteredRouteThemeIds().map((id) => getWorldByRouteThemeId(id)?.id)).toContain(world.id);
  });

  it('is named by no match list, so the world payload of every league keeps its shape', () => {
    const claiming = getRegisteredRouteThemeIds()
      .map((id) => getWorldByRouteThemeId(id))
      .filter((world) => (world?.matchesFormats as readonly string[]).includes('custom'));
    expect(claiming).toEqual([]);
  });
});
