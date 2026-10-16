import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aceExclusions,
  boundsSane,
  castRole,
  castSeed,
  castSlot,
  castSlotProblems,
  castSlots,
  DEFAULT_CAST_BUDGET,
  NO_CAST_EXCLUSIONS,
  rankCandidates,
  roleEntries,
  scaledWidthM,
  slotEnvelope,
  type CastExclusions,
  type CastResult,
  type CastSlot,
} from '../casting';
import { CAST_DEFECT_FILES } from '../cast-defects';
import { hashText } from '../clip-phase';
import { HABITAT_TYPES, POKEMON_TYPES } from '../habitat-types';
import { FigureIndex, figureHeightM, WORLD_MANIFEST_FILE, type FigureEntry, type FigureForm, type WorldManifest } from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';
import type { WorldId } from '../data-surfaces';
import { pickAceTracker } from '@/components/world/route/teams/teams-roster';
import {
  buildPreviewCloudsWorld,
  buildPreviewMountainWorld,
  buildPreviewRoute,
  buildPreviewSakuraWorld,
} from '@/app/(public)/route-preview/fixtures';
import type { EvolutionTracker } from '@/types/evolution';
import { CORE_PROBE_SLOTS } from '@/components/world/route/figures/core-actor-probe.data';

/**
 * Casting (D35 core round, SEAT B step 2). Synthetic manifests use invented
 * names (`Fx…`) and types read from the vocabulary by index, so this file
 * names no species and no type. The snapshot block runs the TRACKED manifest.
 */

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const WATER = cap(HABITAT_TYPES.aquatic.primary[0]);
const GRASS = cap(HABITAT_TYPES.grove.primary[1]);
const FIRE = cap(POKEMON_TYPES[1]);

interface FigSpec {
  dexId: number;
  form?: FigureForm;
  types?: string[];
  primaryType?: string;
  clips?: string[];
  heightm?: number;
  /** Rest bounds: height units and width units. */
  hUnits?: number;
  wUnits?: number;
  kb?: number;
  triangles?: number;
  roles?: string[];
}

function fig(s: FigSpec): FigureEntry {
  const form = s.form ?? 'regular';
  const h = s.hUnits ?? 1;
  const w = s.wUnits ?? 0.5;
  const types = s.types;
  return {
    dexId: s.dexId,
    form,
    species: `Fx${s.dexId}${form === 'regular' ? '' : `-${form}`}`,
    aliases: [],
    file: `models/${form}/${s.dexId}.glb`,
    sourceForm: form,
    kb: s.kb ?? 400,
    heightm: s.heightm ?? 1,
    bounds: { min: [-w / 2, 0, -w / 2], max: [w / 2, h, w / 2] },
    clips: s.clips ?? ['idle'],
    ...(s.primaryType ?? types?.[0] ? { primaryType: s.primaryType ?? types![0] } : {}),
    ...(types ? { types } : {}),
    ...(s.roles ? { roles: s.roles } : {}),
    triangles: s.triangles ?? 10_000,
  };
}

function manifestOf(figures: FigureEntry[], version = 3): WorldManifest {
  return { version, generatedAt: '', figures, props: [], environment: [], missingForms: [], pool: null };
}

function slot(partial: Partial<CastSlot> & Pick<CastSlot, 'id'>): CastSlot {
  return {
    world: 'sakura',
    habitat: 'aquatic',
    role: 'floater',
    station: 0,
    height: { max: 3 },
    maxWidthM: 3,
    needs: {},
    ...partial,
  };
}

const FULL = ['idle', 'idle2', 'walk', 'run'];
const opts = (exclude: CastExclusions = NO_CAST_EXCLUSIONS) => ({ exclude });

describe('castSlots: rules', () => {
  it('is deterministic and seed-sensitive', () => {
    const m = manifestOf(Array.from({ length: 20 }, (_, i) => fig({ dexId: 100 + i, types: [WATER] })));
    const slots = [slot({ id: 'w:a:0' }), slot({ id: 'w:a:1' }), slot({ id: 'w:a:2' })];
    const a = castSlots(slots, m, 7, opts());
    expect(castSlots(slots, m, 7, opts())).toEqual(a);
    const seeds = [1, 2, 3, 4, 5].map((s) => castSlots(slots, m, s, opts()).picks.map((p) => p.entry?.file).join());
    expect(new Set(seeds).size).toBeGreaterThan(1);
    // Declaration order, unique dexIds.
    expect(a.picks.map((p) => p.slotId)).toEqual(slots.map((s) => s.id));
    expect(new Set(a.picks.map((p) => p.entry?.dexId)).size).toBe(3);
    expect(a.loadSet).toHaveLength(3);
  });

  it('rendezvous ranking: removing one entry keeps every other entry in the same relative order', () => {
    const figs = Array.from({ length: 30 }, (_, i) => fig({ dexId: 200 + i, types: [WATER] }));
    const s = slot({ id: 'sakura:floater:0' });
    const before = rankCandidates(s, manifestOf(figs), 11, NO_CAST_EXCLUSIONS).map((e) => e.file);
    for (const removed of [before[0], before[5], before[29]]) {
      const after = rankCandidates(s, manifestOf(figs.filter((f) => f.file !== removed)), 11, NO_CAST_EXCLUSIONS).map((e) => e.file);
      expect(after).toEqual(before.filter((f) => f !== removed));
    }
  });

  it('re-bake stable: an entry no slot accepts changes nothing; a picked entry moves only its own slot', () => {
    const figs = [
      ...Array.from({ length: 12 }, (_, i) => fig({ dexId: 300 + i, types: [WATER] })),
      ...Array.from({ length: 12 }, (_, i) => fig({ dexId: 400 + i, types: [GRASS] })),
    ];
    const slots = [
      slot({ id: 'sakura:float:0' }),
      slot({ id: 'sakura:grove:0', habitat: 'grove' }),
      slot({ id: 'sakura:grove:1', habitat: 'grove' }),
    ];
    const base = castSlots(slots, manifestOf(figs), 5, opts());
    const unrelated = castSlots(slots, manifestOf([...figs, fig({ dexId: 900, types: [FIRE] })]), 5, opts());
    expect(unrelated).toEqual(base);
    const topped = base.picks[0].entry!.file;
    const recast = castSlots(slots, manifestOf(figs.filter((f) => f.file !== topped)), 5, opts());
    expect(recast.picks[0].entry!.file).not.toBe(topped);
    expect(recast.picks.slice(1)).toEqual(base.picks.slice(1));
  });

  it('excludes live aces by dexId across forms, and only aces', () => {
    const regular = fig({ dexId: 500, types: [WATER] });
    const regional = fig({ dexId: 500, form: 'hisuian', types: [WATER] });
    const other = fig({ dexId: 501, types: [WATER] });
    const m = manifestOf([regular, regional, other]);
    const ex = aceExclusions([{ currentForm: regional.species, baseSpecies: null }], new FigureIndex(m));
    expect([...ex.dexIds]).toEqual([500]);
    const ranked = rankCandidates(slot({ id: 'x:y:0' }), m, 1, ex).map((e) => e.file);
    expect(ranked).toEqual([other.file]);
    // Unresolvable aces add nothing.
    expect(aceExclusions([{ currentForm: 'Nothing', baseSpecies: null }], new FigureIndex(m)).dexIds.size).toBe(0);
    // All candidates are aces → excluded-all.
    const only = castSlots([slot({ id: 'x:y:0' })], manifestOf([regular, regional]), 1, opts(ex));
    expect(only.picks[0]).toMatchObject({ entry: null, reason: 'excluded-all' });
    // An ace taken first: rank > 0.
    const withAce = castSlots([slot({ id: 'x:y:0' })], manifestOf([regular, other]), 1, opts({ dexIds: new Set([500]) }));
    const top = rankCandidates(slot({ id: 'x:y:0' }), manifestOf([regular, other]), 1, NO_CAST_EXCLUSIONS)[0];
    expect(withAce.picks[0].entry!.file).toBe(other.file);
    expect(withAce.picks[0].rank).toBe(top.file === regular.file ? 1 : 0);
  });

  it('always merges the asset-defect files, and honours caller file exclusions', () => {
    const [defect] = [...CAST_DEFECT_FILES];
    const dexId = Number(/(\d+)\.glb$/.exec(defect)![1]);
    const bad = fig({ dexId, types: [WATER] });
    expect(bad.file).toBe(defect);
    const good = fig({ dexId: dexId + 1000, types: [WATER] });
    expect(rankCandidates(slot({ id: 'x:y:0' }), manifestOf([bad, good]), 3, NO_CAST_EXCLUSIONS)).toEqual([good]);
    expect(rankCandidates(slot({ id: 'x:y:0' }), manifestOf([bad, good]), 3, { dexIds: new Set(), files: new Set([good.file]) })).toEqual([]);
  });

  it('applies the budget and the bounds filters', () => {
    const heavy = fig({ dexId: 600, types: [WATER], kb: DEFAULT_CAST_BUDGET.maxKb + 1 });
    const dense = fig({ dexId: 601, types: [WATER], triangles: DEFAULT_CAST_BUDGET.maxTriangles + 1 });
    const degenerate = fig({ dexId: 602, types: [WATER], hUnits: 0.01 });
    const pancake = fig({ dexId: 603, types: [WATER], hUnits: 0.1, wUnits: 1 });
    const fine = fig({ dexId: 604, types: [WATER] });
    expect(boundsSane(degenerate)).toBe(false);
    expect(boundsSane(pancake)).toBe(false);
    expect(boundsSane(fine)).toBe(true);
    const m = manifestOf([heavy, dense, degenerate, pancake, fine]);
    expect(rankCandidates(slot({ id: 'x:y:0' }), m, 1, NO_CAST_EXCLUSIONS)).toEqual([fine]);
    expect(rankCandidates(slot({ id: 'x:y:0' }), m, 1, NO_CAST_EXCLUSIONS, { maxKb: 1e9, maxTriangles: 1e9 }).map((e) => e.dexId).sort()).toEqual([600, 601, 604]);
  });

  it('filters on the scaled height band and the scaled width cap', () => {
    const tall = fig({ dexId: 700, types: [WATER], heightm: 2.5 });
    const wide = fig({ dexId: 701, types: [WATER], heightm: 1, wUnits: 1.8 });
    const small = fig({ dexId: 702, types: [WATER], heightm: 0.4 });
    expect(figureHeightM(tall)).toBeCloseTo(2.5);
    expect(scaledWidthM(wide)).toBeCloseTo(1.8);
    const m = manifestOf([tall, wide, small]);
    const ids = (s: CastSlot) => rankCandidates(s, m, 1, NO_CAST_EXCLUSIONS).map((e) => e.dexId).sort();
    expect(ids(slot({ id: 'a', height: { max: 2 }, maxWidthM: 2 }))).toEqual([701, 702]);
    expect(ids(slot({ id: 'a', height: { min: 1.8, max: 3 }, maxWidthM: 2 }))).toEqual([700]);
    // tall is 0.5 units wide at scale 2.5 → 1.25 m; wide is 1.8 m.
    expect(ids(slot({ id: 'a', height: { max: 3 }, maxWidthM: 1.3 }))).toEqual([700, 702]);
    expect(ids(slot({ id: 'a', height: { max: 3 }, maxWidthM: 1.2 }))).toEqual([702]);
  });

  it('scarcity: the surfacer is filled before the wader (scarcest slot first)', () => {
    // One full-set tall candidate; two more walkers that only fit the wader.
    const big = fig({ dexId: 800, types: [WATER], clips: FULL, heightm: 2.3 });
    const walkerA = fig({ dexId: 801, types: [WATER], clips: ['idle', 'walk'], heightm: 0.4 });
    const walkerB = fig({ dexId: 802, types: [WATER], clips: FULL, heightm: 1.5 });
    const m = manifestOf([big, walkerA, walkerB]);
    const wader = slot({ id: 'sakura:wader:0', role: 'wader', height: { max: 2.5 } });
    const surfacer = slot({ id: 'sakura:surfacer:0', role: 'surfacer', height: { min: 1.8, max: 2.5 }, needs: { require: ['idle', 'idle2', 'walk'] } });
    for (let seed = 0; seed < 40; seed += 1) {
      const result = castSlots([wader, surfacer], m, seed, opts());
      expect(result.picks[1].entry?.dexId, `seed ${seed}`).toBe(800);
      expect(result.picks[0].entry?.dexId).not.toBe(800);
    }
  });

  it('roles: movers need walk; lane flyers never require it; clip-less only when allowed', () => {
    const still = fig({ dexId: 900, types: [WATER], clips: [] });
    const idler = fig({ dexId: 901, types: [WATER], clips: ['idle'] });
    const walker = fig({ dexId: 902, types: [WATER], clips: ['idle', 'walk'] });
    const m = manifestOf([still, idler, walker]);
    const ids = (s: CastSlot) => rankCandidates(s, m, 1, NO_CAST_EXCLUSIONS).map((e) => e.dexId).sort();
    expect(ids(slot({ id: 'a', role: 'walker' }))).toEqual([902]);
    expect(ids(slot({ id: 'a', role: 'wader', needs: { allowClipless: true } }))).toEqual([902]);
    expect(ids(slot({ id: 'a', role: 'floater' }))).toEqual([901, 902]);
    expect(ids(slot({ id: 'a', role: 'floater', needs: { allowClipless: true } }))).toEqual([900, 901, 902]);
    const flyer = slot({ id: 'a', role: 'lane-flyer', habitat: 'air', needs: { require: ['walk'] } });
    expect(castSlotProblems(flyer)).toContain('a lane-flyer never requires walk');
    expect(() => castSlots([flyer], m, 1, opts())).toThrow(/lane-flyer/);
    expect(() => castSlots([slot({ id: 'd' }), slot({ id: 'd' })], m, 1, opts())).toThrow(/duplicate/);
  });

  it('prefer ranks the fuller clip tier first', () => {
    const figs = [
      ...Array.from({ length: 6 }, (_, i) => fig({ dexId: 1000 + i, types: [WATER], clips: [] })),
      fig({ dexId: 1010, types: [WATER], clips: ['idle'] }),
      fig({ dexId: 1011, types: [WATER], clips: FULL }),
    ];
    const s = slot({ id: 'a', needs: { allowClipless: true, prefer: ['idle2', 'idle'] } });
    expect(rankCandidates(s, manifestOf(figs), 9, NO_CAST_EXCLUSIONS).map((e) => e.dexId).slice(0, 2)).toEqual([1011, 1010]);
  });

  it('relax-clips retries once with the slot requirement dropped, disclosed', () => {
    const still = fig({ dexId: 1100, types: [WATER], clips: [], heightm: 2 });
    const m = manifestOf([still]);
    const strict = slot({ id: 'a', role: 'surfacer', needs: { require: ['idle', 'idle2'] } });
    expect(castSlot(strict, m, 1, opts())).toMatchObject({ entry: null, reason: 'no-candidate', relaxed: false });
    const relaxed = castSlot({ ...strict, fallback: 'relax-clips' }, m, 1, opts());
    expect(relaxed).toMatchObject({ relaxed: true, reason: null });
    expect(relaxed.entry?.dexId).toBe(1100);
    // A mover keeps its own walk even relaxed.
    expect(castSlot(slot({ id: 'b', role: 'wader', fallback: 'relax-clips' }), m, 1, opts()).entry).toBeNull();
  });

  it('relax-clips retries run as a second pass: a strict slot keeps the entry a relaxed slot also wants (R35)', () => {
    // `shared` is the strict floater's ONLY candidate and the surfacer's only relaxed one.
    // The surfacer has 0 strict candidates, so it sorts first by scarcity; a one-pass
    // retry would hand it `shared` and starve the strict slot.
    const shared = fig({ dexId: 1400, types: [WATER], clips: ['idle'], heightm: 2 });
    const floater = slot({ id: 'sakura:strict:0', role: 'floater', height: { min: 1.9, max: 2.1 }, needs: { require: ['idle'] } });
    const surfacer = slot({
      id: 'sakura:relaxed:0',
      role: 'surfacer',
      height: { min: 1.9, max: 2.1 },
      needs: { require: ['idle', 'idle2'] },
      fallback: 'relax-clips',
    });
    for (let seed = 0; seed < 20; seed += 1) {
      for (const slots of [[surfacer, floater], [floater, surfacer]]) {
        const result = castSlots(slots, manifestOf([shared]), seed, opts());
        const byId = new Map(result.picks.map((p) => [p.slotId, p]));
        expect(byId.get(floater.id)).toMatchObject({ relaxed: false, reason: null, rank: 0 });
        expect(byId.get(floater.id)!.entry?.dexId).toBe(1400);
        expect(byId.get(surfacer.id)).toMatchObject({ entry: null, relaxed: false, reason: 'no-candidate' });
      }
    }
    // With a second, relaxed-only option, the relaxed slot takes that one instead.
    const still = fig({ dexId: 1401, types: [WATER], clips: [], heightm: 2 });
    const both = castSlots([surfacer, floater], manifestOf([shared, still]), 3, opts());
    expect(both.picks[0]).toMatchObject({ relaxed: true, reason: null });
    expect(both.picks[0].entry?.dexId).toBe(1401);
    expect(both.picks[1].entry?.dexId).toBe(1400);
  });

  it("'excluded-all' means roster aces only; defect-, file- or budget-only emptiness is 'no-candidate' (R35)", () => {
    const [defectFile] = [...CAST_DEFECT_FILES];
    const defectDex = Number(/(\d+)\.glb$/.exec(defectFile)![1]);
    const defect = fig({ dexId: defectDex, types: [WATER] });
    expect(defect.file).toBe(defectFile);
    const barred = fig({ dexId: 1501, types: [WATER] });
    const heavy = fig({ dexId: 1502, types: [WATER], kb: DEFAULT_CAST_BUDGET.maxKb + 1 });
    const ace = fig({ dexId: 1503, types: [WATER] });
    const s = slot({ id: 'sakura:float:0' });
    const reason = (figs: FigureEntry[], exclude: CastExclusions) => castSlot(s, manifestOf(figs), 1, opts(exclude)).reason;
    const aces: CastExclusions = { dexIds: new Set([1503]) };
    const files: CastExclusions = { dexIds: new Set(), files: new Set([barred.file]) };
    // Asset defects only (the always-merged defect list, caller file exclusions, the budget).
    expect(reason([defect], NO_CAST_EXCLUSIONS)).toBe('no-candidate');
    expect(reason([barred], files)).toBe('no-candidate');
    expect(reason([heavy], NO_CAST_EXCLUSIONS)).toBe('no-candidate');
    expect(reason([defect, barred, heavy], files)).toBe('no-candidate');
    // An ace took the only viable candidate: excluded-all, with defects alongside or not.
    expect(reason([ace], aces)).toBe('excluded-all');
    expect(reason([defect, heavy, ace], aces)).toBe('excluded-all');
    // An ace that is ALSO a defect counts as a defect: no-candidate.
    expect(reason([defect], { dexIds: new Set([defectDex]) })).toBe('no-candidate');
    // A relaxed slot is judged on its relaxed wishlist.
    const stillAce = fig({ dexId: 1503, types: [WATER], clips: [] });
    const relaxedSlot = slot({ id: 'sakura:relaxed:0', needs: { require: ['idle2'] }, fallback: 'relax-clips' });
    expect(castSlot(relaxedSlot, manifestOf([stillAce]), 1, opts(aces)).reason).toBe('excluded-all');
    expect(castSlot(relaxedSlot, manifestOf([{ ...stillAce, file: defectFile }]), 1, opts()).reason).toBe('no-candidate');
  });

  it('re-bake stable in ONE habitat: removing a picked entry moves its slot and only the slots it cascades into', () => {
    const figs = Array.from({ length: 16 }, (_, i) => fig({ dexId: 1600 + i, types: [WATER] }));
    // Same habitat and shape, explicit priority: the assignment order is a, b, c, d.
    const slots = ['a', 'b', 'c', 'd'].map((n, i) => slot({ id: `sakura:same:${n}`, priority: i }));
    let cascades = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const base = castSlots(slots, manifestOf(figs), seed, opts());
      for (let k = 0; k < slots.length; k += 1) {
        const topped = base.picks[k].entry!;
        const recast = castSlots(slots, manifestOf(figs.filter((f) => f.file !== topped.file)), seed, opts());
        // Slots assigned before k never move.
        for (let j = 0; j < k; j += 1) expect(recast.picks[j], `seed ${seed} k ${k} j ${j}`).toEqual(base.picks[j]);
        // Slot k moves to its best remaining candidate not taken by an earlier slot.
        const earlier = new Set(base.picks.slice(0, k).map((p) => p.entry!.dexId));
        const next = rankCandidates(slots[k], manifestOf(figs), seed, NO_CAST_EXCLUSIONS).find(
          (e) => e.file !== topped.file && !earlier.has(e.dexId),
        );
        expect(recast.picks[k].entry?.file).toBe(next?.file);
        // A later slot may move only when an earlier moved slot took its old pick.
        const takenByMoved = new Set<number>();
        for (let j = k; j < slots.length; j += 1) {
          const was = base.picks[j].entry!;
          const now = recast.picks[j].entry!;
          if (j > k && !takenByMoved.has(was.dexId)) expect(now, `seed ${seed} k ${k} j ${j}`).toEqual(was);
          if (j > k && now.dexId !== was.dexId) cascades += 1;
          if (now.dexId !== was.dexId) takenByMoved.add(now.dexId);
        }
      }
    }
    // The fixture must exercise the cascade at least once.
    expect(cascades).toBeGreaterThan(0);
  });

  it('fails closed on a v2 manifest or one without type data: no-type-data, never a literal fallback', () => {
    const typed = [fig({ dexId: 1200, types: [WATER] })];
    const slots = [slot({ id: 'a' }), slot({ id: 'b', habitat: 'street', role: 'walker' })];
    const v2 = castSlots(slots, manifestOf(typed, 2), 1, opts());
    expect(v2.picks.map((p) => p.reason)).toEqual(['no-type-data', 'no-type-data']);
    expect(v2.loadSet).toEqual([]);
    const untyped = manifestOf([fig({ dexId: 1201 })]);
    expect(castSlots(slots, untyped, 1, opts()).picks.every((p) => p.reason === 'no-type-data' && p.entry === null)).toBe(true);
    expect(rankCandidates(slots[0], manifestOf(typed, 2), 1, NO_CAST_EXCLUSIONS)).toEqual([]);
  });

  it('castSeed is league + world + epoch, no date', () => {
    expect(castSeed('sakura', 'L1')).toBe(castSeed('sakura', 'L1'));
    expect(castSeed('sakura', 'L1')).not.toBe(castSeed('mountain', 'L1'));
    expect(castSeed('sakura', 'L1')).not.toBe(castSeed('sakura', 'L2'));
  });

  describe('castSeed is pinned to its documented string (R35)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("castSeed(w, l) === hashText('cast|v1|<w>|<l>'), on either side of midnight", () => {
      const worlds: WorldId[] = ['plaza', 'sakura', 'mountain', 'clouds'];
      const pinned = () => worlds.map((w) => [castSeed(w, 'league-7'), hashText(`cast|v1|${w}|league-7`)]);
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-01T23:59:59.000Z'));
      const before = pinned();
      vi.setSystemTime(new Date('2026-03-02T00:00:01.000Z'));
      const after = pinned();
      for (const [seed, expected] of [...before, ...after]) expect(seed).toBe(expected);
      expect(after).toEqual(before);
    });
  });

  it('slotEnvelope is the slot caps standing on the root', () => {
    const box = slotEnvelope(slot({ id: 'sakura:float:0', height: { max: 1.6 }, maxWidthM: 2 }), { x: 1, y: 0.06, z: -8 });
    expect(box).toEqual({ id: 'sakura:float:0', center: [1, 0.06 + 0.8, -8], half: [1, 0.8, 1] });
  });

  it('castRole casts by the baked role, regular form first, and fails closed without roles', () => {
    const m = manifestOf([
      fig({ dexId: 1300, types: [FIRE] }),
      fig({ dexId: 1302, form: 'galarian', types: [FIRE], roles: ['nurse'] }),
      fig({ dexId: 1301, types: [FIRE], roles: ['nurse'] }),
    ]);
    expect(roleEntries(m, 'nurse').map((e) => e.dexId)).toEqual([1302, 1301]);
    expect(castRole(m, 'nurse')?.dexId).toBe(1301);
    expect(castRole(manifestOf([fig({ dexId: 1 })]), 'nurse')).toBeNull();
  });
});

// ── Snapshots: the probe slots and a synthetic 4-world fixture, on the TRACKED manifest ──

const { manifest: TRACKED, present: HAS_MANIFEST } = readMirrorManifest(WORLD_MANIFEST_FILE);

/**
 * The sakura core-actor probe slots are D's exported `CORE_PROBE_SLOTS` (R33),
 * not a copy: the probe snapshot moves when the probe data does.
 */
const PROBE_SLOTS: readonly CastSlot[] = CORE_PROBE_SLOTS;

/**
 * The synthetic sakura core (2 floaters, a wader, a surfacer with relax-clips,
 * a lane flyer) for the 4-world fixture below. Synthetic on purpose: it keeps
 * the world snapshots independent of the probe's tuning.
 */
const SAKURA_SYNTHETIC_CORE: readonly CastSlot[] = [
  { id: 'sakura:floater:0', world: 'sakura', habitat: 'aquatic', role: 'floater', station: 0, height: { max: 1.6 }, maxWidthM: 2.2, needs: { allowClipless: true, prefer: ['idle2', 'idle'] } },
  { id: 'sakura:floater:1', world: 'sakura', habitat: 'aquatic', role: 'floater', station: 0, height: { max: 1.6 }, maxWidthM: 2.2, needs: { allowClipless: true, prefer: ['idle2', 'idle'] } },
  { id: 'sakura:wader:0', world: 'sakura', habitat: 'aquatic', role: 'wader', station: 0, height: { max: 2.4 }, maxWidthM: 2.4, needs: { require: ['walk'], prefer: ['idle2'] } },
  { id: 'sakura:surfacer:0', world: 'sakura', habitat: 'aquatic', role: 'surfacer', station: 0, height: { min: 1.8, max: 2.6 }, maxWidthM: 3, needs: { require: ['idle', 'idle2', 'walk'] }, fallback: 'relax-clips' },
  { id: 'sakura:flyer:0', world: 'sakura', habitat: 'air', role: 'lane-flyer', station: 0, height: { min: 1.2, max: 3.2 }, maxWidthM: 4, needs: { prefer: ['idle2', 'idle'] } },
];

/** A synthetic per-world slot table (the real ones are the 4S/4M/4C/4P deliverables and gates, §7). */
const WORLD_SLOTS: Readonly<Record<WorldId, readonly CastSlot[]>> = {
  plaza: [
    { id: 'plaza:walker:0', world: 'plaza', habitat: 'street', role: 'walker', station: 0, height: { max: 2.2 }, maxWidthM: 2, needs: { prefer: ['idle2'] } },
    { id: 'plaza:walker:1', world: 'plaza', habitat: 'street', role: 'walker', station: 1, height: { max: 2.2 }, maxWidthM: 2, needs: { prefer: ['idle2'] } },
    { id: 'plaza:loiter:0', world: 'plaza', habitat: 'street', role: 'loiterer', station: 2, height: { max: 2.2 }, maxWidthM: 2, needs: { prefer: ['idle2', 'idle'] } },
    { id: 'plaza:flyer:0', world: 'plaza', habitat: 'air', role: 'lane-flyer', station: 3, height: { min: 1.2, max: 3 }, maxWidthM: 4, needs: { prefer: ['idle'] } },
  ],
  sakura: [
    ...SAKURA_SYNTHETIC_CORE,
    { id: 'sakura:sitter:0', world: 'sakura', habitat: 'aquatic', role: 'sitter', station: 1, height: { max: 1.2 }, maxWidthM: 1.5, needs: { allowClipless: true } },
    { id: 'sakura:grove:0', world: 'sakura', habitat: 'grove', role: 'loiterer', station: 4, height: { max: 1.4 }, maxWidthM: 1.6, needs: { allowClipless: true, prefer: ['idle'] } },
    { id: 'sakura:grove:1', world: 'sakura', habitat: 'grove', role: 'loiterer', station: 4, height: { max: 1.4 }, maxWidthM: 1.6, needs: { allowClipless: true, prefer: ['idle'] } },
  ],
  mountain: [
    { id: 'mountain:snow:0', world: 'mountain', habitat: 'snow', role: 'loiterer', station: 2, height: { max: 2.2 }, maxWidthM: 2.5, needs: { allowClipless: true, prefer: ['idle'] }, family: 'snow-line' },
    { id: 'mountain:snow:1', world: 'mountain', habitat: 'snow', role: 'loiterer', station: 2, height: { max: 2.2 }, maxWidthM: 2.5, needs: { allowClipless: true, prefer: ['idle'] }, family: 'snow-line' },
    { id: 'mountain:guardian:0', world: 'mountain', habitat: 'alpine', role: 'guardian', station: 3, height: { min: 1.6, max: 3.5 }, maxWidthM: 4, needs: { allowClipless: true } },
    { id: 'mountain:floe:0', world: 'mountain', habitat: 'aquatic', role: 'floater', station: 1, height: { max: 1.4 }, maxWidthM: 2, needs: { allowClipless: true } },
    { id: 'mountain:flyer:0', world: 'mountain', habitat: 'air', role: 'lane-flyer', station: 0, height: { min: 1.4, max: 3.2 }, maxWidthM: 4, needs: { prefer: ['idle2', 'idle'] } },
  ],
  clouds: [
    { id: 'clouds:hover:0', world: 'clouds', habitat: 'sky-isle', role: 'hover', station: 0, height: { max: 2 }, maxWidthM: 2.5, needs: { prefer: ['idle'] } },
    { id: 'clouds:hover:1', world: 'clouds', habitat: 'sky-isle', role: 'hover', station: 4, height: { max: 2 }, maxWidthM: 2.5, needs: { prefer: ['idle'] } },
    { id: 'clouds:rider:0', world: 'clouds', habitat: 'sky-isle', role: 'rider', station: 1, height: { max: 0.5 }, maxWidthM: 0.8, needs: { prefer: ['idle'] } },
    { id: 'clouds:flyer:0', world: 'clouds', habitat: 'air', role: 'lane-flyer', station: 2, height: { min: 1.4, max: 5.5 }, maxWidthM: 6, needs: { prefer: ['idle2', 'idle'] } },
  ],
};

const SNAPSHOT_LEAGUE = 'route-preview-fixture';

function acesOf(participants: readonly { id: string }[], trackers: readonly EvolutionTracker[]) {
  return participants
    .map((p) => pickAceTracker(trackers.filter((t) => t.player_id === p.id)))
    .filter((t): t is EvolutionTracker => t !== null)
    .map((t) => ({ currentForm: t.current_form, baseSpecies: t.base_pokemon }));
}

function fixtureExclusions(world: WorldId): CastExclusions {
  const data =
    world === 'sakura'
      ? buildPreviewSakuraWorld('epb').data
      : world === 'mountain'
        ? buildPreviewMountainWorld('epb').data
        : world === 'clouds'
          ? buildPreviewCloudsWorld('epb').data
          : buildPreviewRoute();
  return aceExclusions(acesOf(data.participants, data.trackers), new FigureIndex(TRACKED));
}

/** Species-free readout: file, rank and flags per slot. */
function readout(result: CastResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pick of result.picks) {
    out[pick.slotId] = pick.entry
      ? `${pick.entry.file} r${pick.rank}${pick.relaxed ? ' relaxed' : ''}`
      : `— ${pick.reason}`;
  }
  return out;
}

describe.skipIf(!HAS_MANIFEST)('cast snapshots (tracked manifest × {empty roster, route-preview fixture roster})', () => {
  it('the tracked manifest carries baked types and the nurse role (Q1/Q2)', () => {
    expect(TRACKED.version).toBeGreaterThanOrEqual(3);
    expect(TRACKED.figures.every((f) => (f.types?.length ?? 0) > 0 && f.types![0] === f.primaryType)).toBe(true);
    expect(roleEntries(TRACKED, 'nurse').length).toBeGreaterThan(0);
    expect(castRole(TRACKED, 'nurse')?.roles).toContain('nurse');
  });

  it('the fixture rosters resolve aces to exclude, and some are real candidates of the fixture slots', () => {
    let candidates = 0;
    for (const world of ['plaza', 'sakura', 'mountain', 'clouds'] as const) {
      const aces = fixtureExclusions(world).dexIds;
      expect(aces.size, world).toBeGreaterThan(0);
      for (const s of WORLD_SLOTS[world]) {
        candidates += rankCandidates(s, TRACKED, castSeed(world, SNAPSHOT_LEAGUE), NO_CAST_EXCLUSIONS).filter((e) => aces.has(e.dexId)).length;
      }
    }
    expect(candidates).toBeGreaterThan(0);
  });

  it('probe slots', () => {
    const seed = castSeed('sakura', SNAPSHOT_LEAGUE);
    const empty = castSlots(PROBE_SLOTS, TRACKED, seed, opts());
    const fixture = castSlots(PROBE_SLOTS, TRACKED, seed, opts(fixtureExclusions('sakura')));
    expect({ empty: readout(empty), fixture: readout(fixture) }).toMatchSnapshot();
    // Stable across calls; the empty roster never leaves a slot excluded-all.
    expect(castSlots(PROBE_SLOTS, TRACKED, seed, opts())).toEqual(empty);
    expect(empty.picks.some((p) => p.reason === 'excluded-all')).toBe(false);
  });

  for (const world of ['plaza', 'sakura', 'mountain', 'clouds'] as const) {
    it(`synthetic world fixture: ${world}`, () => {
      const seed = castSeed(world, SNAPSHOT_LEAGUE);
      const slots = WORLD_SLOTS[world];
      const empty = castSlots(slots, TRACKED, seed, opts());
      const fixture = castSlots(slots, TRACKED, seed, opts(fixtureExclusions(world)));
      // A third arm that forces fall-through: the fixture aces plus every empty-roster pick as an ace.
      const displacedAces = new Set([...fixtureExclusions(world).dexIds, ...empty.picks.flatMap((p) => (p.entry ? [p.entry.dexId] : []))]);
      const displaced = castSlots(slots, TRACKED, seed, opts({ dexIds: displacedAces }));
      expect({ empty: readout(empty), fixture: readout(fixture), displaced: readout(displaced) }).toMatchSnapshot();
      for (const pick of displaced.picks) if (pick.entry) expect(displacedAces.has(pick.entry.dexId)).toBe(false);
      // No duplicate dexIds within a world, and aces never cast.
      for (const result of [empty, fixture]) {
        const dex = result.picks.filter((p) => p.entry).map((p) => p.entry!.dexId);
        expect(new Set(dex).size).toBe(dex.length);
      }
      const aces = fixtureExclusions(world).dexIds;
      for (const pick of fixture.picks) if (pick.entry) expect(aces.has(pick.entry.dexId)).toBe(false);
    });
  }
});
