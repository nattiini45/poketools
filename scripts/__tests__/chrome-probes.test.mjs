/**
 * CHROME seat (D32 / D33): the veil windows, the judged theme leg and the
 * nav reveal verdict (scripts/lib/chrome-probes.mjs).
 */
import { describe, expect, it } from 'vitest';
import { cardVeilJudge, frameGapSummary, navRevealVerdict, outsideTapCandidates, pickInertTapPoint, veilJudge, veilWindows } from '../lib/chrome-probes.mjs';

const isWorld = (url) => /\/models\/world\//.test(url);
const TRACE = [
  { phase: 'idle', t: 10 },
  { phase: 'in', t: 1010 },
  { phase: 'opaque', t: 1235 },
  { phase: 'commit', t: 1252 },
  { phase: 'out', t: 9000 },
  { phase: 'idle', t: 9245 },
];

describe('veilWindows', () => {
  it('reads the phases after the toggle and their timings', () => {
    const w = veilWindows(TRACE, 1000);
    expect(w).toMatchObject({ inAt: 1010, opaqueAt: 1235, commitAt: 1252, outAt: 9000, idleAt: 9245, aborted: false });
    expect(w.timings).toEqual({ toggleToIn: 10, fadeInMs: 225, opaqueMs: 7765, fadeOutMs: 245, totalMs: 8235 });
  });
  it('ignores a cancel-out before the commit and entries before the toggle', () => {
    const w = veilWindows([{ phase: 'out', t: 500 }, { phase: 'in', t: 1010 }, { phase: 'out', t: 1100 }, { phase: 'in', t: 1150 }, { phase: 'opaque', t: 1380 }, { phase: 'commit', t: 1400 }, { phase: 'out', t: 5000 }, { phase: 'idle', t: 5240 }], 1000);
    expect(w.outAt).toBe(5000);
    expect(w.opaqueAt).toBe(1380);
  });
  it('an empty trace reads as no veil', () => {
    expect(veilWindows([], 0).inAt).toBeNull();
  });
});

describe('veilJudge (D32: all work inside the veil-opaque window)', () => {
  const veil = veilWindows(TRACE, 1000);
  const base = { toggleAt: 1000, endT: 11500, veil, isWorldAssetUrl: isWorld };

  it('passes when every fetch / link / upload / long task lands while the veil is opaque', () => {
    const raw = {
      resources: [{ name: 'http://x/models/world/hdri/night.jpg', t: 1300 }],
      links: [1400, 2000, 5000],
      textures: [{ createdAt: 1500, firstDataAt: 1510, deletedAt: null }],
      longTasks: [{ t: 3000, d: 180 }],
    };
    const j = veilJudge({ ...base, raw, requests: [{ url: 'http://x/models/world/hdri/night.jpg', t: 1290 }] });
    expect(j.verdict).toBe('pass');
    expect(j.windows.opaque).toMatchObject({ worldFetches: 1, links: 3, uploads: 1, textureAllocs: 1, longTasks: 1 });
  });

  it('fails on work during the fade-in (before the veil is opaque)', () => {
    const j = veilJudge({ ...base, raw: { links: [1100], longTasks: [{ t: 1020, d: 70 }] } });
    expect(j.verdict).toBe('fail');
    expect(j.reasons[0]).toMatch(/before the veil was opaque: links=1, longTasks=1/);
  });

  it('fails on any work once the fade-out began, hold included', () => {
    for (const raw of [
      { links: [9001] },
      { textures: [{ createdAt: 9100, firstDataAt: null, deletedAt: null }] },
      { textures: [{ createdAt: 2000, firstDataAt: 10500, deletedAt: null }] },
      { longTasks: [{ t: 11000, d: 51 }] },
      { resources: [{ name: 'http://x/models/world/a.glb', t: 9500 }] },
    ]) {
      const j = veilJudge({ ...base, raw });
      expect(j.verdict, JSON.stringify(raw)).toBe('fail');
      expect(j.reasons.join(' ')).toMatch(/after the veil began to fade out/);
    }
  });

  it('reports deletes and short tasks without judging them', () => {
    const j = veilJudge({ ...base, raw: { textures: [{ createdAt: 100, firstDataAt: 120, deletedAt: 9500 }], longTasks: [{ t: 9500, d: 30 }] } });
    expect(j.verdict).toBe('pass');
    expect(j.windows.after.textureDeletes).toBe(1);
  });

  it('no veil after a live toggle fails; an incomplete one fails', () => {
    expect(veilJudge({ ...base, veil: veilWindows([], 1000), raw: {} }).verdict).toBe('fail');
    const partial = veilWindows(TRACE.slice(0, 4), 1000);
    expect(veilJudge({ ...base, veil: partial, raw: {} }).reasons.join(' ')).toMatch(/never completed/);
  });
});

describe('nav reveal verdict and frame gaps', () => {
  it('every check must pass; unmeasured is never a pass', () => {
    expect(navRevealVerdict([{ name: 'a', pass: true }]).pass).toBe(true);
    expect(navRevealVerdict([{ name: 'a', pass: true }, { name: 'b', pass: null }]).failing).toEqual(['b: unmeasured']);
    expect(navRevealVerdict([]).pass).toBe(false);
  });
  it('summarises rAF gaps and long tasks in the window', () => {
    const raf = [0, 16, 33, 50, 170, 186];
    const s = frameGapSummary(raf, [{ t: 60, d: 110 }, { t: 400, d: 90 }], 0, 200);
    expect(s.maxGapMs).toBe(120);
    expect(s.gapsOver50).toEqual([{ t: 50, gap: 120 }]);
    expect(s.longTasks).toEqual([{ t: 60, d: 110 }]);
  });
});

describe('cardVeilJudge (D32 fix: the Station Card above the veil never pops)', () => {
  const veil = veilWindows(TRACE, 1000);
  /** Frames every 16 ms over [t0, t1] with alpha from `f(t)`. */
  const frames = (t0, t1, f) => {
    const out = [];
    for (let t = t0; t <= t1; t += 16) out.push({ t, ...f(t) });
    return out;
  };
  const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

  it('passes the fixed shape: fades out with the veil, hidden while opaque (remounts unseen), fades in with it', () => {
    const s = frames(900, 9700, (t) => {
      if (t < 1010) return { present: true, id: 1, alpha: 1 };
      if (t < 1240) return { present: true, id: 1, alpha: 1 - ramp(t, 1010, 1230) };
      if (t < 1300) return { present: true, id: 1, alpha: 0 };
      if (t < 7000) return { present: false, id: 0, alpha: 0 };
      if (t < 9000) return { present: true, id: 2, alpha: 0 };
      return { present: true, id: 2, alpha: ramp(t, 9000, 9240) };
    });
    const j = cardVeilJudge(s, veil);
    expect(j.verdict).toBe('pass');
    expect(j.stateChanges).toBe(2);
    expect(j.mounts).toBe(2);
    expect(j.opaqueMaxAlpha).toBe(0);
    expect(j.alphaAtEnd).toBe(1);
  });

  it('fails the verifier-seen churn: unmount over the veil, remount at full opacity, exit, re-enter', () => {
    const s = frames(900, 9700, (t) => {
      if (t < 1260) return { present: true, id: 1, alpha: 1 };
      if (t < 7000) return { present: false, id: 0, alpha: 0 };
      if (t < 7200) return { present: true, id: 2, alpha: 1 - ramp(t, 7000, 7200) };
      if (t < 8800) return { present: false, id: 0, alpha: 0 };
      return { present: true, id: 3, alpha: ramp(t, 8800, 9080) };
    });
    const j = cardVeilJudge(s, veil);
    expect(j.verdict).toBe('fail');
    expect(j.pops.map((p) => p.kind)).toEqual(['unmount', 'mount']);
    expect(j.stateChanges).toBeGreaterThan(2);
    expect(j.reasons.join(' ')).toMatch(/shown over the opaque veil/);
  });

  describe('reduced motion / instant veil (verifier 03: the rm swap is not a pop)', () => {
    // The verifier's rm trace: fade-in 11 ms, fade-out 14 ms.
    const RM = [
      { phase: 'in', t: 1010 },
      { phase: 'opaque', t: 1021 },
      { phase: 'commit', t: 1040 },
      { phase: 'out', t: 9000 },
      { phase: 'idle', t: 9014 },
    ];
    const rmVeil = veilWindows(RM, 1000);
    const instantSwap = (showAt) =>
      frames(900, 9700, (t) => {
        if (t < 1016) return { present: true, id: 1, alpha: 1 };
        if (t < 3000) return { present: false, id: 0, alpha: 0 };
        if (t < showAt) return { present: true, id: 2, alpha: 0 };
        return { present: true, id: 2, alpha: 1 };
      });

    it('accepts one instant hide at the veil-in and one instant show at the clear (fades < 50 ms)', () => {
      const j = cardVeilJudge(instantSwap(9014), rmVeil);
      expect(j.verdict).toBe('pass');
      expect(j.instantVeil).toBe(true);
      expect(j.instants.map((i) => i.as)).toEqual(['instant-hide', 'instant-show']);
      expect(j.pops).toEqual([]);
      expect(j.stateChanges).toBe(2);
    });

    it('accepts the same swap on a reducedMotion leg even with slower recorded fades', () => {
      const slow = veilWindows([{ phase: 'in', t: 1010 }, { phase: 'opaque', t: 1100 }, { phase: 'commit', t: 1110 }, { phase: 'out', t: 9000 }, { phase: 'idle', t: 9090 }], 1000);
      const s = frames(900, 9700, (t) => {
        if (t < 1016) return { present: true, id: 1, alpha: 1 };
        if (t < 9030) return { present: true, id: 1, alpha: 0 };
        return { present: true, id: 1, alpha: 1 };
      });
      expect(cardVeilJudge(s, slow).verdict).toBe('fail');
      expect(cardVeilJudge(s, slow, { reducedMotion: true }).verdict).toBe('pass');
    });

    it('still fails an instant 0->1 mid-opaque (shown over the veil, a pop outside the clear window)', () => {
      const s = frames(900, 9700, (t) => {
        if (t < 1016) return { present: true, id: 1, alpha: 1 };
        if (t < 5000) return { present: true, id: 1, alpha: 0 };
        return { present: true, id: 1, alpha: 1 };
      });
      const j = cardVeilJudge(s, rmVeil, { reducedMotion: true });
      expect(j.verdict).toBe('fail');
      expect(j.pops.map((p) => p.kind)).toEqual(['jump']);
      expect(j.pops[0].t).toBeGreaterThanOrEqual(5000);
      expect(j.reasons.join(' ')).toMatch(/card popped 1x/);
      expect(j.reasons.join(' ')).toMatch(/shown over the opaque veil/);
    });

    it('allows only ONE instant each way: a second hide/show flicker still fails', () => {
      const s = frames(900, 9700, (t) => {
        if (t < 1016) return { present: true, id: 1, alpha: 1 };
        if (t < 9014) return { present: true, id: 1, alpha: 0 };
        if (t < 9040) return { present: true, id: 1, alpha: 1 };
        if (t < 9060) return { present: true, id: 1, alpha: 0 };
        return { present: true, id: 1, alpha: 1 };
      });
      const j = cardVeilJudge(s, rmVeil, { reducedMotion: true });
      expect(j.verdict).toBe('fail');
      expect(j.instants).toHaveLength(2);
      expect(j.pops.length).toBeGreaterThan(0);
      expect(j.reasons.join(' ')).toMatch(/changed state 4x/);
    });

    it('a slow (animated) veil gets no instant allowance', () => {
      const j = cardVeilJudge(instantSwap(9000), veil);
      expect(j.instantVeil).toBe(false);
      expect(j.verdict).toBe('fail');
    });
  });

  it('no card in view is absent (not judged); no veil is unmeasured', () => {
    const s = frames(900, 9700, () => ({ present: false, id: 0, alpha: 0 }));
    expect(cardVeilJudge(s, veil).verdict).toBe('absent');
    expect(cardVeilJudge(s, veilWindows([], 0)).verdict).toBe('unmeasured');
  });
});

describe('the 390 touch outside tap (verifier 03: never a data face)', () => {
  const vp = { width: 390, height: 844 };
  const board = { id: 'board:pulse', x: 20, y: 300, w: 350, h: 200 };

  it('puts the sky under the Station Card first, inside the viewport, without duplicates', () => {
    const c = outsideTapCandidates(vp, { top: 120, bottom: 175 });
    expect(c[0]).toEqual({ x: 300, y: 215 });
    expect(c.every((p) => p.x >= 0 && p.x <= 390 && p.y >= 110 && p.y <= 644)).toBe(true);
    expect(new Set(c.map((p) => `${p.x},${p.y}`)).size).toBe(c.length);
    expect(outsideTapCandidates(vp, null).length).toBeGreaterThan(10);
  });

  it('rejects the old centre point on the pulse board and picks a canvas point off every subject', () => {
    const hits = [
      { x: 195, y: 380, kind: 'canvas', hit: 'canvas' },
      { x: 300, y: 700, kind: 'interactive', hit: 'a.world-nav-hud-chip' },
      { x: 20, y: 800, kind: 'portal', hit: 'nextjs-portal' },
      { x: 90, y: 160, kind: 'card-text', hit: 'p' },
      { x: 300, y: 215, kind: 'canvas', hit: 'canvas' },
    ];
    const pick = pickInertTapPoint(hits, [board]);
    expect(pick.point).toMatchObject({ x: 300, y: 215, kind: 'canvas' });
    expect(pick.subjectsVerified).toBe(true);
    expect(pick.rejected.map((r) => r.why)).toEqual([
      'projects onto a focus subject (board:pulse)',
      'hits interactive (a.world-nav-hud-chip)',
      'hits portal (nextjs-portal)',
    ]);
  });

  it('falls back to card text only when no canvas point is inert; pads the subject rects', () => {
    const pick = pickInertTapPoint(
      [
        { x: 200, y: 295, kind: 'canvas', hit: 'canvas' },
        { x: 90, y: 160, kind: 'card-text', hit: 'p' },
      ],
      [board],
    );
    expect(pick.point).toMatchObject({ x: 90, y: 160, kind: 'card-text' });
  });

  it('no inert point -> null; no subject bridge -> unverified', () => {
    expect(pickInertTapPoint([{ x: 1, y: 1, kind: 'other', hit: 'div' }], []).point).toBeNull();
    const unverified = pickInertTapPoint([{ x: 300, y: 215, kind: 'canvas', hit: 'canvas' }], null);
    expect(unverified.point).not.toBeNull();
    expect(unverified.subjectsVerified).toBe(false);
  });
});
