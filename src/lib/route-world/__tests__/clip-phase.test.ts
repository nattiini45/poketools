import { describe, expect, it } from 'vitest';
import {
  allocateClipPhases,
  circularDistance,
  clipKeyFor,
  FIDGET_DWELL_MAX_S,
  FIDGET_DWELL_MIN_S,
  fidgetClips,
  idleFidgetSchedule,
  phaseToClipTime,
  PHASE_JITTER,
  type ClipPhaseMember,
} from '../clip-phase';

/**
 * W2 phase law: no two figures looping the same clip of the same file share a
 * phase, and the idle/fidget alternation is seeded, bounded and a pure
 * function of accumulated seconds.
 */

function group(file: string, clip: string, n: number, prefix = file): ClipPhaseMember[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}#${i}`, clipKey: clipKeyFor(file, clip) }));
}

describe('allocateClipPhases', () => {
  it('spreads every same-clip group to a minimum circular distance of 0.5/N', () => {
    for (const n of [2, 3, 5, 8, 13]) {
      for (const seed of [0, 1, 42, 0xdeadbeef]) {
        const members = group('models/regular/183.glb', 'idle', n);
        const phases = allocateClipPhases(members, seed);
        const values = members.map((m) => phases.get(m.id) as number);
        for (let i = 0; i < n; i += 1) {
          expect(values[i]).toBeGreaterThanOrEqual(0);
          expect(values[i]).toBeLessThan(1);
          for (let j = i + 1; j < n; j += 1) {
            expect(circularDistance(values[i], values[j])).toBeGreaterThanOrEqual((1 - 2 * PHASE_JITTER) / n - 1e-9);
          }
        }
      }
    }
  });

  it('never gives two members of a group the same phase', () => {
    const members = group('models/regular/25.glb', 'idle', 6);
    const values = [...allocateClipPhases(members, 7).values()];
    expect(new Set(values.map((v) => v.toFixed(6))).size).toBe(values.length);
  });

  it('allocates groups independently (a different clip or file is a different group)', () => {
    const members = [
      ...group('a.glb', 'idle', 3),
      ...group('a.glb', 'walk', 2, 'a-walkers'),
      ...group('b.glb', 'idle', 1),
    ];
    const phases = allocateClipPhases(members, 9);
    expect(phases.size).toBe(6);
    const walkers = ['a-walkers#0', 'a-walkers#1'].map((id) => phases.get(id) as number);
    expect(circularDistance(walkers[0], walkers[1])).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });

  it('is independent of registry order and ignores duplicate ids', () => {
    const members = group('c.glb', 'idle', 5);
    const forward = allocateClipPhases(members, 3);
    const reversed = allocateClipPhases([...members].reverse(), 3);
    const duplicated = allocateClipPhases([...members, members[0], members[2]], 3);
    for (const m of members) {
      expect(reversed.get(m.id)).toBe(forward.get(m.id));
      expect(duplicated.get(m.id)).toBe(forward.get(m.id));
    }
  });

  it('changes with the seed', () => {
    const members = group('d.glb', 'idle', 4);
    const a = allocateClipPhases(members, 1);
    const b = allocateClipPhases(members, 2);
    expect(members.some((m) => a.get(m.id) !== b.get(m.id))).toBe(true);
  });

  it('maps a phase onto the clip duration', () => {
    expect(phaseToClipTime(0.25, 2)).toBeCloseTo(0.5);
    expect(phaseToClipTime(1.25, 2)).toBeCloseTo(0.5);
    expect(phaseToClipTime(0.5, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('idleFidgetSchedule', () => {
  const FULL = ['idle', 'idle2', 'walk', 'run'];

  /** Fidget windows [start, end) sampled at 0.05 s over a span. */
  function fidgetWindows(seed: number, clips: readonly string[], spanS: number) {
    const windows: { start: number; end: number; clip: string }[] = [];
    let open: { start: number; clip: string } | null = null;
    for (let t = 0; t <= spanS; t += 0.05) {
      const frame = idleFidgetSchedule(seed, clips, t, { idle2: 2.4 });
      if (frame.fidget && !open) open = { start: t, clip: frame.clip as string };
      if (!frame.fidget && open) {
        windows.push({ start: open.start, end: t, clip: open.clip });
        open = null;
      }
    }
    return windows;
  }

  it('dwells 8–20 s in idle between fidgets and plays exactly one fidget pass', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const windows = fidgetWindows(seed, FULL, 400);
      expect(windows.length).toBeGreaterThan(10);
      for (let i = 1; i < windows.length; i += 1) {
        const dwell = windows[i].start - windows[i - 1].end;
        expect(dwell).toBeGreaterThanOrEqual(FIDGET_DWELL_MIN_S - 0.1);
        expect(dwell).toBeLessThanOrEqual(FIDGET_DWELL_MAX_S + 0.1);
      }
      for (const w of windows) {
        expect(w.clip).toBe('idle2');
        expect(w.end - w.start).toBeGreaterThan(2.3);
        expect(w.end - w.start).toBeLessThan(2.55);
      }
    }
  });

  it('differs across seeds', () => {
    const a = fidgetWindows(1, FULL, 200).map((w) => w.start.toFixed(2)).join(',');
    const b = fidgetWindows(2, FULL, 200).map((w) => w.start.toFixed(2)).join(',');
    expect(a).not.toBe(b);
  });

  it('is a pure function of accumulated seconds', () => {
    for (const t of [0, 3.3, 17.9, 250, 3600.5]) {
      expect(idleFidgetSchedule(5, FULL, t)).toEqual(idleFidgetSchedule(5, FULL, t));
    }
  });

  it('reports elapsed/remaining that meet at the segment boundary', () => {
    const frame = idleFidgetSchedule(8, FULL, 50, { idle2: 3 });
    expect(frame.elapsedS).toBeGreaterThanOrEqual(0);
    expect(frame.remainingS).toBeGreaterThan(0);
    const after = idleFidgetSchedule(8, FULL, 50 + frame.remainingS + 1e-6, { idle2: 3 });
    expect(after.fidget).toBe(!frame.fidget);
  });

  it('never picks a locomotion clip as a fidget or as idle', () => {
    expect(fidgetClips(['idle', 'walk', 'run'])).toEqual([]);
    for (let t = 0; t < 120; t += 0.5) {
      expect(idleFidgetSchedule(4, ['idle', 'run', 'walk'], t).clip).toBe('idle');
      // Grovyle-shaped file: no idle, only locomotion → the low-motion fallback.
      expect(idleFidgetSchedule(4, ['run', 'walk'], t).clip).toBeNull();
    }
    // Wigglytuff-shaped file: run only → never "run in place".
    expect(idleFidgetSchedule(4, ['run'], 10).clip).toBeNull();
    // No clips at all.
    expect(idleFidgetSchedule(4, [], 10).clip).toBeNull();
  });

  it('loops the only non-locomotion clip when a file has no idle', () => {
    const frame = idleFidgetSchedule(4, ['idle2', 'walk'], 30);
    expect(frame.clip).toBe('idle2');
    expect(frame.fidget).toBe(false);
  });

  it('falls back to a default pass length when the manifest has no duration (pre-v3)', () => {
    const windows: number[] = [];
    let start = -1;
    for (let t = 0; t <= 120; t += 0.05) {
      const f = idleFidgetSchedule(11, FULL, t).fidget;
      if (f && start < 0) start = t;
      if (!f && start >= 0) {
        windows.push(t - start);
        start = -1;
      }
    }
    expect(windows.length).toBeGreaterThan(0);
    windows.forEach((w) => expect(w).toBeCloseTo(3, 0));
  });
});
