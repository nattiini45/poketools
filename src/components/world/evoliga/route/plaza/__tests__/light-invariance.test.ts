import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HERO_PROPS, type HeroPropSeat } from '@/lib/route-world/layout';
import { heroLampLights } from '../HeroProps';

/**
 * D23 / LOOK-PLAN §2 seat R item 6: `NUM_POINT_LIGHTS` is a program key, so
 * the plaza's point-light count must be the same at the first compile as
 * after a full sweep, in both palettes. The lamp seats' pools mount at load
 * in BOTH palettes (gated by intensity, never by a conditional mount), and
 * no window-gated plaza component mounts a light conditionally any more.
 */

const LAMPS: readonly HeroPropSeat[] = [
  { prop: 'haussmann-lamp-post', at: { x: -2.4, y: 0, z: 17 }, yaw: 0, axis: 'y', sizeM: 4.2 },
  { prop: 'led-board-cabinet', at: { x: 4, y: 0, z: -14 }, yaw: Math.PI, axis: 'x', sizeM: 2.18 },
  { prop: 'haussmann-lamp-post', at: { x: 2.4, y: 0, z: 17 }, yaw: 0, axis: 'y', sizeM: 4.2 },
];

describe('plaza point lights are mounted at load for both palettes', () => {
  it('one pool per lamp seat in day and night alike', () => {
    const day = heroLampLights(LAMPS, false);
    const night = heroLampLights(LAMPS, true);
    expect(day).toHaveLength(2);
    expect(night).toHaveLength(2);
    expect(day.map((l) => l.key)).toEqual(night.map((l) => l.key));
    expect(day.map((l) => l.position)).toEqual(night.map((l) => l.position));
  });

  it('gates the palette by intensity only', () => {
    expect(heroLampLights(LAMPS, false).every((l) => l.intensity === 0)).toBe(true);
    expect(heroLampLights(LAMPS, true).every((l) => l.intensity > 0)).toBe(true);
  });

  it('the shipped seats give the same count in both palettes', () => {
    expect(heroLampLights(HERO_PROPS, false).length).toBe(heroLampLights(HERO_PROPS, true).length);
  });

  it('keeps the lights out of the GLB seat boundary and window gates', () => {
    const root = path.resolve(__dirname, '../../../../../../..');
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
    const hero = read('src/components/world/evoliga/route/plaza/HeroProps.tsx');
    // No night-conditional light mount anywhere in the file.
    expect(hero).not.toMatch(/&&\s*night\s*\?\s*\(\s*<pointLight/);
    expect(hero).not.toMatch(/night\s*&&\s*\(?\s*<pointLight/);
    // The windowed plaza components no longer return null on a window latch.
    for (const file of [
      'src/components/world/evoliga/route/plaza/HeroProps.tsx',
      'src/components/world/evoliga/route/plaza/ChallengeGate.tsx',
      'src/components/world/evoliga/route/plaza/StatueRow.tsx',
    ]) {
      expect(read(file)).not.toMatch(/if \(!mounted\) return null/);
      expect(read(file)).not.toMatch(/acesMounted \?/);
    }
  });
});
