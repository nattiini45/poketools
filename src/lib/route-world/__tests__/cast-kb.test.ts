import { describe, expect, it } from 'vitest';
import { castSlots, DEFAULT_CAST_BUDGET, NO_CAST_EXCLUSIONS, rankCandidates } from '../casting';
import { AMBIENT_MAX_KB, castAmbient, type AmbientCandidate } from '../ambient';
import { castKbOf, WORLD_MANIFEST_FILE, type FigureEntry, type WorldManifest } from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';
import { teamsRoster } from '@/components/world/route/teams/teams-roster';
import { CORE_PROBE_SLOTS } from '@/components/world/route/figures/core-actor-probe.data';
import type { EvolutionTracker } from '@/types/evolution';

/**
 * D42 commit G: every cast budget and roster sort reads `castKb ?? kb`. With
 * `castKb` absent (every manifest baked before D42) the cast is identical;
 * with `castKb` equal to `kb` (the frozen B manifest) it is identical too; only
 * a real `castKb` change moves it. No species names: entries are keyed by
 * file, and the mirror manifests (maintainer-only) are read as data.
 *
 * D42 commit P: `V2` is the published v2 `manifest.json` (no castKb; what
 * builds before commit P read), `SHIPPED` the shipped `WORLD_MANIFEST_FILE`
 * (d42m: castKb frozen at v2's kb, wire kb shrunk by meshopt).
 */

const V2_MIRROR = readMirrorManifest('manifest.json');
const SHIPPED_MIRROR = readMirrorManifest(WORLD_MANIFEST_FILE);
const V2: WorldManifest = V2_MIRROR.manifest;
const SHIPPED: WorldManifest = SHIPPED_MIRROR.manifest;
const HAS_MANIFESTS = V2_MIRROR.present && SHIPPED_MIRROR.present;

function withCastKb(manifest: WorldManifest, castKb: (entry: FigureEntry) => number | undefined): WorldManifest {
  return {
    ...manifest,
    figures: manifest.figures.map((entry) => {
      const value = castKb(entry);
      return value === undefined ? entry : { ...entry, castKb: value };
    }),
  };
}

describe('castKbOf', () => {
  it('reads castKb when baked, else kb', () => {
    expect(castKbOf({ kb: 900 })).toBe(900);
    expect(castKbOf({ kb: 180, castKb: 1071 })).toBe(1071);
    expect(castKbOf({ kb: 180, castKb: Number.NaN })).toBe(180);
  });
});

describe.skipIf(!HAS_MANIFESTS)('cast budgets read castKb ?? kb', () => {
  const opts = { exclude: NO_CAST_EXCLUSIONS };

  it('castKb absent → identical budgets and picks (the published v2 manifest.json has no castKb)', () => {
    expect(V2.figures.some((entry) => entry.castKb !== undefined)).toBe(false);
    for (const seed of [1, 7, 42]) {
      const before = castSlots(CORE_PROBE_SLOTS, V2, seed, opts);
      const frozen = castSlots(CORE_PROBE_SLOTS, withCastKb(V2, (e) => e.kb), seed, opts);
      const files = (r: typeof before) => ({ picks: r.picks.map((p) => [p.slotId, p.entry?.file ?? null, p.rank, p.relaxed, p.reason]), loadSet: [...r.loadSet] });
      expect(files(frozen)).toEqual(files(before));
    }
  });

  it('the frozen B arm (castKb = A kb, wire kb shrunk) casts exactly like A', () => {
    const b = withCastKb(
      { ...V2, figures: V2.figures.map((e) => ({ ...e, kb: Math.round(e.kb / 3) })) },
      (e) => V2.figures.find((a) => a.file === e.file)?.kb,
    );
    for (const slot of CORE_PROBE_SLOTS) {
      const files = (m: WorldManifest) => rankCandidates(slot, m, 3, NO_CAST_EXCLUSIONS, DEFAULT_CAST_BUDGET).map((e) => e.file);
      expect(files(b)).toEqual(files(V2));
    }
  });

  it('the shipped manifest (castKb frozen at v2 kb) casts exactly like the v2 manifest', () => {
    expect(SHIPPED.figures.every((entry) => typeof entry.castKb === 'number')).toBe(true);
    expect(SHIPPED.figures.some((entry) => entry.kb !== entry.castKb)).toBe(true);
    const files = (r: ReturnType<typeof castSlots>) => ({ picks: r.picks.map((p) => [p.slotId, p.entry?.file ?? null, p.rank, p.relaxed, p.reason]), loadSet: [...r.loadSet] });
    for (const seed of [1, 7, 42]) {
      expect(files(castSlots(CORE_PROBE_SLOTS, SHIPPED, seed, opts))).toEqual(files(castSlots(CORE_PROBE_SLOTS, V2, seed, opts)));
    }
    for (const slot of CORE_PROBE_SLOTS) {
      const ranked = (m: WorldManifest) => rankCandidates(slot, m, 3, NO_CAST_EXCLUSIONS, DEFAULT_CAST_BUDGET).map((e) => e.file);
      expect(ranked(SHIPPED)).toEqual(ranked(V2));
    }
  });

  it('a castKb over the budget bars the file (only a real castKb change moves the cast)', () => {
    const before = castSlots(CORE_PROBE_SLOTS, SHIPPED, 7, opts);
    const picked = before.picks.find((pick) => pick.entry !== null)?.entry ?? null;
    expect(picked).not.toBeNull();
    const barred = withCastKb(SHIPPED, (e) => (e.file === picked!.file ? DEFAULT_CAST_BUDGET.maxKb + 1 : undefined));
    const after = castSlots(CORE_PROBE_SLOTS, barred, 7, opts);
    expect(after.picks.some((pick) => pick.entry?.file === picked!.file)).toBe(false);
  });
});

describe('ambient budget reads the candidate cast size', () => {
  const candidate = (key: string, kb: number): AmbientCandidate<string> => ({ key, entry: key, heightM: 1, kb, canWalk: true });

  it('admits by the size the caller passes (castKbOf), never anything else', () => {
    const under = castAmbient([candidate('a.glb', AMBIENT_MAX_KB), candidate('b.glb', AMBIENT_MAX_KB + 1)], 2, 5);
    const keys = [...under.walkers, ...under.loiterers].map((c) => c.key);
    expect(keys).toEqual(['a.glb']);
  });
});

describe('teams roster sorts by castKb ?? kb', () => {
  const participants = [
    { id: 'p1', name: 'One' },
    { id: 'p2', name: 'Two' },
  ];
  const trackers = [
    { player_id: 'p1', base_pokemon: 'FxOne', current_form: null },
    { player_id: 'p2', base_pokemon: 'FxTwo', current_form: null },
  ] as unknown as EvolutionTracker[];
  const entry = (file: string, kb: number, castKb?: number) =>
    ({ file, kb, ...(castKb === undefined ? {} : { castKb }), heightm: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] } }) as unknown as FigureEntry;

  function budgeted(one: FigureEntry, two: FigureEntry): string[] {
    const index = { resolve: (form: string | null | undefined, base: string | null | undefined) => ((form ?? base) === 'FxOne' ? one : two) };
    return teamsRoster(participants, trackers, [], index, 1)
      .filter((row) => row.entry !== null)
      .map((row) => row.playerId);
  }

  it('castKb absent: the smaller kb gets the one hero slot (as before)', () => {
    expect(budgeted(entry('one.glb', 900), entry('two.glb', 300))).toEqual(['p2']);
  });

  it('castKb present: the cast currency decides, not the wire size', () => {
    expect(budgeted(entry('one.glb', 100, 900), entry('two.glb', 300))).toEqual(['p2']);
    expect(budgeted(entry('one.glb', 900, 200), entry('two.glb', 300))).toEqual(['p1']);
  });
});
