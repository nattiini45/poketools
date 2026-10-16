import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aceExclusions, castSeed, castSlots, NO_CAST_EXCLUSIONS, slotAccepts } from '../casting';
import { FigureIndex, figureHeightM, WORLD_MANIFEST_FILE, type WorldManifest } from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';
import { pickAceTracker } from '@/components/world/route/teams/teams-roster';
import { buildPreviewSakuraWorld } from '@/app/(public)/route-preview/fixtures';
import type { EvolutionTracker } from '@/types/evolution';
import {
  CORE_PROBE_ROLES,
  CORE_PROBE_SLOTS,
  CORE_PROBE_SLOT_IDS,
  CORE_PROBE_WORLD,
  coreProbeCastFor,
  coreProbeEnvelopeWarnings,
  coreProbeSlot,
  coreProbeSlotRole,
  parseCoreCastFile,
  parseCoreCastSeed,
  resolveCoreProbeCast,
  type CoreProbeRole,
} from '@/components/world/route/figures/core-actor-probe.data';

/**
 * INTEGRATE (POKEMON-CORE-PLAN §4; D step 6, L3–L5): the core actor probe's
 * cast comes from ONE `castSlots` batch over the real `CORE_PROBE_SLOTS`,
 * computed once before reveal and latched; the routeDebug `?coreCastFile=`
 * pin overrides a role; an empty or no-type-data pick leaves the slot empty
 * (disclosed), never a literal fallback. Species-free: files and dexIds only.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const { manifest: TRACKED, present: HAS_MANIFEST } = readMirrorManifest(WORLD_MANIFEST_FILE);
const SEED = castSeed(CORE_PROBE_WORLD, 'route-preview-fixture');
const NO_PIN: Record<CoreProbeRole, string | null> = { floater: null, wader: null, surfacer: null, flyer: null };

function fixtureExclusions() {
  const { participants, trackers } = buildPreviewSakuraWorld('epb').data;
  const aces = participants
    .map((p) => pickAceTracker(trackers.filter((t) => t.player_id === p.id)))
    .filter((t): t is EvolutionTracker => t !== null)
    .map((t) => ({ currentForm: t.current_form, baseSpecies: t.base_pokemon }));
  return aceExclusions(aces, new FigureIndex(TRACKED));
}

describe.skipIf(!HAS_MANIFEST)('core actor probe cast: castSlots over CORE_PROBE_SLOTS', () => {
  it('is exactly the world-level castSlots batch when nothing is pinned', () => {
    const exclude = fixtureExclusions();
    const cast = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude, pin: NO_PIN });
    const batch = castSlots(CORE_PROBE_SLOTS, TRACKED, SEED, { exclude });
    expect(cast.slots.map((s) => s.slotId)).toEqual(CORE_PROBE_SLOTS.map((s) => s.id));
    for (const pick of batch.picks) {
      const row = coreProbeCastFor(cast, pick.slotId);
      expect(row.source).toBe('cast');
      expect(row.entry?.file ?? null).toBe(pick.entry?.file ?? null);
      expect(row.reason).toBe(pick.entry ? null : pick.reason);
      expect(row.rank).toBe(pick.rank);
    }
    expect(cast.seed).toBe(SEED);
  });

  it('is deterministic and species-free in its readout', () => {
    const a = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: fixtureExclusions(), pin: NO_PIN });
    const b = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: fixtureExclusions(), pin: NO_PIN });
    expect(a).toEqual(b);
  });

  it('every cast pick fits its slot envelope, is unique by dexId and avoids the live aces', () => {
    const exclude = fixtureExclusions();
    const cast = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude, pin: NO_PIN });
    const dex = new Set<number>();
    for (const row of cast.slots) {
      if (!row.entry) continue;
      // R31: a relaxed pick (the surfacer's `relax-clips`) keeps the envelope; only its clips are relaxed.
      expect(slotAccepts(coreProbeSlot(row.slotId), row.entry, row.relaxed)).toBe(true);
      expect(exclude.dexIds.has(row.entry.dexId)).toBe(false);
      expect(dex.has(row.entry.dexId)).toBe(false);
      dex.add(row.entry.dexId);
    }
    const heights: Record<CoreProbeRole, number | null> = { floater: null, wader: null, surfacer: null, flyer: null };
    for (const row of cast.slots) if (row.entry) heights[row.role] = Math.max(heights[row.role] ?? 0, figureHeightM(row.entry));
    expect(coreProbeEnvelopeWarnings(heights)).toEqual([]);
    // The load set is the cast entries, deduped.
    const files = cast.slots.flatMap((s) => (s.entry ? [s.entry.file] : []));
    expect(cast.loadEntries.map((e) => e.file)).toEqual([...new Set(files)]);
  });

  it('an ace exclusion moves the slot it topped, by dexId', () => {
    const base = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: NO_PIN });
    const topped = base.slots.find((s) => s.entry !== null);
    expect(topped).toBeDefined();
    const dexId = topped!.entry!.dexId;
    const moved = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: { dexIds: new Set([dexId]) }, pin: NO_PIN });
    for (const row of moved.slots) expect(row.entry?.dexId).not.toBe(dexId);
  });

  it('a manifest without type data leaves every slot EMPTY with no-type-data (no literal fallback)', () => {
    const v2: WorldManifest = { ...TRACKED, version: 2 };
    const untyped: WorldManifest = { ...TRACKED, figures: TRACKED.figures.map(({ types: _types, primaryType: _primary, ...rest }) => rest) };
    for (const manifest of [v2, untyped]) {
      const cast = resolveCoreProbeCast({ manifest, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: NO_PIN });
      for (const row of cast.slots) {
        expect(row.entry).toBeNull();
        expect(row.reason).toBe('no-type-data');
        expect(row.source).toBe('cast');
      }
      expect(cast.loadEntries).toEqual([]);
    }
  });

  it('a slot with no candidate stays empty and says why', () => {
    const wader = coreProbeSlot(CORE_PROBE_SLOT_IDS.wader);
    const manifest: WorldManifest = { ...TRACKED, figures: TRACKED.figures.filter((e) => !slotAccepts(wader, e)) };
    const cast = resolveCoreProbeCast({ manifest, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: NO_PIN });
    const row = coreProbeCastFor(cast, CORE_PROBE_SLOT_IDS.wader);
    expect(row.entry).toBeNull();
    expect(row.reason).toBe('no-candidate');
  });
});

describe.skipIf(!HAS_MANIFEST)('R31: the probe surfacer relaxes clips, never its envelope', () => {
  it('the surfacer slot is relax-clips with its envelope intact; the other slots are unchanged', () => {
    const surfacer = coreProbeSlot(CORE_PROBE_SLOT_IDS.surfacer);
    expect(surfacer.fallback).toBe('relax-clips');
    expect(surfacer.height).toEqual({ min: 1.8, max: 2.2 });
    expect(surfacer.maxWidthM).toBe(1.0);
    expect(surfacer.habitat).toBe('aquatic');
    expect(surfacer.needs.require).toEqual(['idle', 'idle2']);
    for (const slot of CORE_PROBE_SLOTS) if (slot.id !== surfacer.id) expect(slot.fallback).toBeUndefined();
  });

  /** A synthetic in-envelope aquatic figure: the tracked manifest's first water-typed entry, resized and stripped. */
  function inEnvelopeAquatic(clips: string[]): WorldManifest['figures'][number] {
    const surfacer = coreProbeSlot(CORE_PROBE_SLOT_IDS.surfacer);
    const base = TRACKED.figures.find((e) => slotAccepts({ ...surfacer, height: { max: 99 }, maxWidthM: 99 }, e, true));
    expect(base).toBeDefined();
    const figure = { ...base!, clips, dexId: 99001, file: 'models/regular/r31-probe.glb', heightm: 2.0 };
    // Bounds: 1 unit tall, 0.4 wide, so figureScale gives 2.0 m tall and 0.8 m wide.
    figure.bounds = { min: [-0.2, 0, -0.2], max: [0.2, 1, 0.2] };
    return figure;
  }

  it('a clip-less in-envelope aquatic figure fills the slot RELAXED (static pose); a strict one wins over it', () => {
    const clipless = inEnvelopeAquatic([]);
    expect(figureHeightM(clipless)).toBeCloseTo(2.0, 6);
    const surfacer = coreProbeSlot(CORE_PROBE_SLOT_IDS.surfacer);
    expect(slotAccepts(surfacer, clipless)).toBe(false);
    expect(slotAccepts(surfacer, clipless, true)).toBe(true);
    const relaxed = resolveCoreProbeCast({ manifest: { ...TRACKED, figures: [...TRACKED.figures, clipless] }, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: NO_PIN });
    const row = coreProbeCastFor(relaxed, CORE_PROBE_SLOT_IDS.surfacer);
    expect(row.entry?.file).toBe(clipless.file);
    expect(row.relaxed).toBe(true);
    expect(row.reason).toBeNull();
    const strict = { ...inEnvelopeAquatic(['idle', 'idle2']), dexId: 99002, file: 'models/regular/r31-strict.glb' };
    const both = resolveCoreProbeCast({ manifest: { ...TRACKED, figures: [...TRACKED.figures, clipless, strict] }, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: NO_PIN });
    const strictRow = coreProbeCastFor(both, CORE_PROBE_SLOT_IDS.surfacer);
    expect(strictRow.entry?.file).toBe(strict.file);
    expect(strictRow.relaxed).toBe(false);
  });

  it('relaxing never admits a figure outside the envelope: an over-wide clip-less aquatic figure leaves the slot empty', () => {
    const wide = inEnvelopeAquatic([]);
    wide.bounds = { min: [-0.4, 0, -0.4], max: [0.4, 1, 0.4] }; // 1.6 m wide at 2.0 m tall
    const cast = resolveCoreProbeCast({
      manifest: { ...TRACKED, figures: TRACKED.figures.filter((e) => !slotAccepts(coreProbeSlot(CORE_PROBE_SLOT_IDS.surfacer), e, true)).concat(wide) },
      seed: SEED,
      exclude: NO_CAST_EXCLUSIONS,
      pin: NO_PIN,
    });
    const row = coreProbeCastFor(cast, CORE_PROBE_SLOT_IDS.surfacer);
    expect(row.entry).toBeNull();
    expect(row.reason).toBe('no-candidate');
  });
});

describe.skipIf(!HAS_MANIFEST)('core actor probe cast: the ?coreCastFile= pin (routeDebug override)', () => {
  const file = TRACKED.figures[0]?.file ?? '';

  it('overrides its role (both floaters) and leaves the other roles to castSlots over the rest', () => {
    const pin = { ...NO_PIN, floater: file };
    const cast = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin });
    for (const id of CORE_PROBE_SLOT_IDS.floaters) {
      const row = coreProbeCastFor(cast, id);
      expect(row.source).toBe('pin');
      expect(row.entry?.file).toBe(file);
      expect(row.reason).toBeNull();
    }
    const rest = CORE_PROBE_SLOTS.filter((s) => coreProbeSlotRole(s.id) !== 'floater');
    const batch = castSlots(rest, TRACKED, SEED, { exclude: NO_CAST_EXCLUSIONS });
    for (const pick of batch.picks) {
      const row = coreProbeCastFor(cast, pick.slotId);
      expect(row.source).toBe('cast');
      expect(row.entry?.file ?? null).toBe(pick.entry?.file ?? null);
    }
    expect(cast.loadEntries.filter((e) => e.file === file)).toHaveLength(1);
  });

  it('a pinned file absent from the manifest leaves its slots empty, never falls through', () => {
    const pin = parseCoreCastFile('?coreCastFile=surfacer:models/regular/not-a-figure.glb');
    const cast = resolveCoreProbeCast({ manifest: TRACKED, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin });
    const row = coreProbeCastFor(cast, CORE_PROBE_SLOT_IDS.surfacer);
    expect(row.source).toBe('pin');
    expect(row.entry).toBeNull();
    expect(row.reason).toBe('pin-not-in-manifest');
  });

  it('a pin applies even when the manifest has no type data (it is a file path, not a query)', () => {
    const v2: WorldManifest = { ...TRACKED, version: 2 };
    const cast = resolveCoreProbeCast({ manifest: v2, seed: SEED, exclude: NO_CAST_EXCLUSIONS, pin: { ...NO_PIN, flyer: file } });
    expect(coreProbeCastFor(cast, CORE_PROBE_SLOT_IDS.flyer).entry?.file).toBe(file);
    expect(coreProbeCastFor(cast, CORE_PROBE_SLOT_IDS.wader).reason).toBe('no-type-data');
  });

  it('every slot maps to a role', () => {
    const roles = new Set(CORE_PROBE_SLOTS.map((s) => coreProbeSlotRole(s.id)));
    expect([...roles].sort()).toEqual([...CORE_PROBE_ROLES].sort());
    expect(() => coreProbeSlotRole('sakura:nope:0')).toThrow();
  });
});

describe('core actor probe cast: ?castSeed= and the latch', () => {
  it('parses an unsigned 32-bit seed and rejects anything else', () => {
    expect(parseCoreCastSeed('?castSeed=7')).toBe(7);
    expect(parseCoreCastSeed('?castSeed=4294967295')).toBe(4294967295);
    expect(parseCoreCastSeed('?castSeed=4294967296')).toBeNull();
    expect(parseCoreCastSeed('?castSeed=-1')).toBeNull();
    expect(parseCoreCastSeed('?castSeed=abc')).toBeNull();
    expect(parseCoreCastSeed('')).toBeNull();
  });

  it('CoreActorProbe computes the cast once, in a useState initializer (latched for the session, D23)', () => {
    const src = readFileSync(join(ROOT, 'src/components/world/route/figures/CoreActorProbe.tsx'), 'utf8');
    expect(src).toMatch(/const \[cast\] = useState<CoreProbeCast>\(\(\) => \{[\s\S]*?resolveCoreProbeCast\(/);
    expect(src.match(/resolveCoreProbeCast\(/g)).toHaveLength(1);
    // No recast: nothing sets the cast after mount.
    expect(src).not.toMatch(/setCast/);
  });
});
