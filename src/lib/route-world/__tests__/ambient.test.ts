import { describe, expect, it } from 'vitest';
import {
  AMBIENT_MAX_HEIGHT_M,
  AMBIENT_PATHS,
  castAmbient,
  clearOfHeroesAndDollies,
  dailySeed,
  DOLLY_CORRIDORS,
  headingYaw,
  HERO_CLEARS,
  HERO_SEGMENTS,
  LOITER_SPOTS,
  sampleTrack,
  trackFor,
  walkSpeed,
  type AmbientCandidate,
} from '../ambient';

function candidate(key: string, heightM: number, canWalk: boolean, kb = 400): AmbientCandidate<string> {
  return { key, entry: key, heightM, kb, canWalk };
}

describe('castAmbient', () => {
  const roster = [
    candidate('pikachu', 0.4, false),
    candidate('greninja', 1.5, true),
    candidate('torracat', 0.7, true),
    candidate('dragonite', 2.2, true),
    candidate('wailord', 14.5, true),
    candidate('charizard', 1.7, false),
    candidate('marill', 0.4, true),
  ];

  it('is deterministic for one seed and changes with another', () => {
    const a = castAmbient(roster, 4, 1234);
    const b = castAmbient(roster, 4, 1234);
    expect(a).toEqual(b);
    // Three of the four eligible walkers: which three depends on the day.
    const keys = (cast: typeof a) => [...cast.walkers, ...cast.loiterers].map((c) => c.key).sort();
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => keys(castAmbient(roster, 3, seed)).join(','));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('never casts a figure over the height cap and respects the head-count', () => {
    const cast = castAmbient(roster, 5, 42);
    const all = [...cast.walkers, ...cast.loiterers];
    expect(all).toHaveLength(5);
    for (const c of all) expect(c.heightM).toBeLessThanOrEqual(AMBIENT_MAX_HEIGHT_M);
    expect(all.map((c) => c.key)).not.toContain('wailord');
  });

  it('prefers walkers and keeps idle-only figures as loiterers', () => {
    const cast = castAmbient(roster, 4, 7);
    expect(cast.walkers.length).toBeGreaterThan(0);
    for (const c of cast.walkers) expect(c.canWalk).toBe(true);
    for (const c of cast.loiterers) expect(c.canWalk).toBe(false);
  });

  it('returns an empty cast for a zero head-count', () => {
    expect(castAmbient(roster, 0, 1)).toEqual({ walkers: [], loiterers: [] });
  });
});

describe('dailySeed', () => {
  it('is stable within a day and per season', () => {
    const day = new Date('2026-09-02T10:00:00Z');
    const later = new Date('2026-09-02T22:30:00Z');
    expect(dailySeed('season-a', day)).toBe(dailySeed('season-a', later));
    expect(dailySeed('season-a', day)).not.toBe(dailySeed('season-b', day));
    expect(dailySeed('season-a', day)).not.toBe(dailySeed('season-a', new Date('2026-09-03T10:00:00Z')));
  });
});

describe('sampleTrack', () => {
  it('wraps a closed loop and returns unit headings', () => {
    const loop = trackFor(AMBIENT_PATHS.find((p) => p.id === 'south-loop')!);
    const start = sampleTrack(loop, 0);
    const lap = sampleTrack(loop, loop.length);
    expect(lap.x).toBeCloseTo(start.x, 5);
    expect(lap.z).toBeCloseTo(start.z, 5);
    expect(Math.hypot(start.dx, start.dz)).toBeCloseTo(1, 6);
  });

  it('ping-pongs an open path and flips heading on the way back', () => {
    const crossing = trackFor(AMBIENT_PATHS.find((p) => p.id === 'crossing')!);
    const out = sampleTrack(crossing, crossing.length * 0.25);
    const back = sampleTrack(crossing, crossing.length * 1.75);
    expect(back.x).toBeCloseTo(out.x, 5);
    expect(back.z).toBeCloseTo(out.z, 5);
    expect(back.dx).toBeCloseTo(-out.dx, 5);
    expect(back.dz).toBeCloseTo(-out.dz, 5);
  });

  it('counts down the distance to the next vertex', () => {
    const loop = trackFor(AMBIENT_PATHS[0]);
    const firstLeg = loop.cumulative[1];
    expect(sampleTrack(loop, firstLeg - 0.5).toVertex).toBeCloseTo(0.5, 6);
  });
});

describe('plaza clearance (C-029)', () => {
  /** Dense sampling along every authored path and loiter spot. */
  it('never walks a figure into a hero clear or a dolly corridor', () => {
    const violations: string[] = [];
    for (const path of AMBIENT_PATHS) {
      const track = trackFor(path);
      const period = path.closed ? track.length : track.length * 2;
      for (let s = 0; s <= period; s += 0.2) {
        const sample = sampleTrack(track, s);
        if (!clearOfHeroesAndDollies(sample.x, sample.z)) {
          violations.push(`${path.id}@(${sample.x.toFixed(2)}, ${sample.z.toFixed(2)})`);
        }
      }
    }
    for (const spot of LOITER_SPOTS) {
      if (!clearOfHeroesAndDollies(spot.at[0], spot.at[1])) {
        violations.push(`loiter@(${spot.at[0]}, ${spot.at[1]})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps every hero and dolly inside the plaza the paths live in', () => {
    // Sanity on the authored data itself: heroes and corridors are finite and
    // the corridor endpoints are the frozen station cameras.
    expect(HERO_CLEARS.length).toBeGreaterThan(0);
    expect(HERO_SEGMENTS.length).toBeGreaterThan(0);
    expect(DOLLY_CORRIDORS.map((d) => d.station)).toEqual([
      'pulse',
      'roster',
      'teams',
      'schedule',
      'rules',
    ]);
    for (const dolly of DOLLY_CORRIDORS) {
      expect(dolly.halfWidth).toBeGreaterThan(0.5);
    }
  });
});

describe('headingYaw / walkSpeed', () => {
  it('turns a +Z-forward model toward the heading', () => {
    expect(headingYaw(0, 1)).toBeCloseTo(0, 6);
    expect(headingYaw(1, 0)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('scales speed with height but caps the big ones', () => {
    expect(walkSpeed(0.4)).toBeLessThan(walkSpeed(1.5));
    expect(walkSpeed(2)).toBe(walkSpeed(3));
  });
});
