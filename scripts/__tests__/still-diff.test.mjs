/**
 * LOOK r4 SEAT H: still-diff candidate choice (CLARITY r3: --diff-against
 * picked the black-IBL -retry baseline first although the plain before was
 * pose-matched and lit), the face / figure-masked diff, and the canonical
 * BEFORE pair gate.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { pickDiffCandidate } from '../lib/look-r3-evidence.mjs';
import { figureMaskOf, faceRegionsOf, innerRect } from '../lib/look-evidence.mjs';
import { PAIR_LUMA_MAX_REL, stillDiff, tagAgainstDiff, tagPairDiff } from '../lib/still-diff.mjs';

const lit = (mean) => ({ worldLuma: { mean, spread: 40 } });

describe('pickDiffCandidate: pose first, then world-luma agreement', () => {
  it('passes over a pose-tied black-IBL candidate listed first', () => {
    const c = [
      { tag: 'before-retry', exists: true, pose: { match: true }, sidecar: lit(75) },
      { tag: 'before', exists: true, pose: { match: true }, sidecar: lit(138) },
    ];
    const r = pickDiffCandidate(c, { referenceLuma: { mean: 139.2 } });
    expect(r.pick.tag).toBe('before');
    expect(r.poseValid).toBe(true);
    expect(r.lumaDivergent).toBe(false);
    expect(r.why).toMatch(/^before: pose-matched; world luma consistent/);
    expect(r.why).toMatch(/passed over before-retry: pose ok, luma divergent/);
    expect(r.ranking.map((x) => x.tag)).toEqual(['before', 'before-retry']);
  });

  it('keeps a pose match over a luma match, and flags a divergent pick when nothing better exists', () => {
    const c = [
      { tag: 'lit-but-moved', exists: true, pose: { match: false }, sidecar: lit(138) },
      { tag: 'dark-same-pose', exists: true, pose: { match: true }, sidecar: lit(75) },
    ];
    const r = pickDiffCandidate(c, { referenceLuma: { mean: 139 } });
    expect(r.pick.tag).toBe('dark-same-pose');
    expect(r.lumaDivergent).toBe(true);
    expect(r.why).toMatch(/DIVERGES/);
  });

  it('keeps list order inside the consistent band (a look change moves the after luma) and ranks a recorded black-IBL still last', () => {
    const c = [
      { tag: 'lit-retry', exists: true, pose: { match: true }, sidecar: lit(55) },
      { tag: 'plain', exists: true, pose: { match: true }, sidecar: lit(64) },
      { tag: 'c', exists: false },
    ];
    // Both within 20 % of the after (66): the listed-first (canonical) one wins, not the closer one.
    const r = pickDiffCandidate(c, { referenceLuma: { mean: 66 } });
    expect(r.pick.tag).toBe('lit-retry');
    expect(r.why).toMatch(/later in the list/);
    const withBlack = [
      { tag: 'black', exists: true, pose: { match: true }, sidecar: { ...lit(66), iblState: { verdict: 'black' } } },
      { tag: 'far', exists: true, pose: { match: true }, sidecar: lit(20) },
    ];
    expect(pickDiffCandidate(withBlack, { referenceLuma: { mean: 66 } }).pick.tag).toBe('far');
    const tie = [
      { tag: 'x', exists: true, pose: { match: true } },
      { tag: 'y', exists: true, pose: { match: true } },
    ];
    expect(pickDiffCandidate(tie).pick.tag).toBe('x');
    expect(pickDiffCandidate([]).pick).toBeNull();
  });
});

describe('face regions and figure masks', () => {
  it('reads faces from lumaInputs, else diffRects, and pads / scales figure rects clear of faces', () => {
    const side = {
      diffRects: {
        frame: { scale: 2 },
        faces: [{ id: 'board:pulse', x: 10, y: 10, w: 20, h: 10 }],
        figures: [
          { id: 'fig-a', x: 50, y: 50, w: 10, h: 10 },
          { id: 'fig-over-face', x: 12, y: 12, w: 4, h: 4 },
        ],
      },
    };
    expect(faceRegionsOf(side)).toEqual([{ id: 'board:pulse', x: 20, y: 20, w: 40, h: 20 }]);
    const mask = figureMaskOf(side, { padPx: 2 });
    expect(mask).toEqual([{ id: 'fig-a', x: 96, y: 96, w: 28, h: 28 }]);
    expect(innerRect({ x: 0, y: 0, w: 100, h: 40 })).toEqual({ x: 25, y: 10, w: 50, h: 20 });
  });
});

async function png(dir, name, fill, { width = 40, height = 40, paint = null } = {}) {
  const buf = Buffer.alloc(width * height * 3, fill);
  if (paint) paint(buf, width);
  await sharp(buf, { raw: { width, height, channels: 3 } }).png().toFile(join(dir, `${name}.png`));
}

describe('still-diff offline modes', () => {
  it('--against re-diffs an after set against the ranked candidate and reports why', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'still-diff-r4-'));
    try {
      const pose = { camPos: [0, 5, -14], yaw: 0.994 };
      const side = (name, luma, extra = {}) => writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...pose, ...lit(luma), ...extra }));
      // A figure moves between the after and the lit before (masked out);
      // the data face is untouched.
      const figure = (x0) => (buf, w) => {
        for (let y = 30; y < 36; y += 1) for (let x = x0; x < x0 + 4; x += 1) buf.fill(250, (y * w + x) * 3, (y * w + x) * 3 + 3);
      };
      const rects = { frame: { scale: 1 }, faces: [{ id: 'plaque:left', x: 2, y: 2, w: 16, h: 16 }], figures: [{ id: 'f', x: 20, y: 28, w: 14, h: 10 }] };
      await png(dir, 'after-rules-390', 140, { paint: figure(22) });
      side('after-rules-390', 139, { diffRects: rects });
      await png(dir, 'before-rules-390', 140, { paint: figure(28) });
      side('before-rules-390', 138);
      await png(dir, 'before-retry-rules-390', 70);
      side('before-retry-rules-390', 75);
      const rows = await tagAgainstDiff(dir, 'after', ['before-retry', 'before']);
      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.chosen).toBe('before-rules-390.png');
      expect(r.why).toMatch(/passed over before-retry/);
      expect(r.frame.max).toBeGreaterThan(0);
      expect(r.frameMasked.max).toBe(0);
      expect(r.faces[0]).toMatchObject({ id: 'plaque:left', max: 0 });
      expect(r.faces[0].inner).toMatchObject({ max: 0, lumaA: r.faces[0].inner.lumaB });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the canonical pair gate rejects a 4% world-luma drift and a black-IBL still, and keeps a steady pair', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'still-diff-gate-'));
    try {
      const pose = { camPos: [0, 5, -14], yaw: 0.1 };
      const write = async (name, v, luma, extra = {}) => {
        await png(dir, name, v, { width: 8, height: 8 });
        writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...pose, ...lit(luma), ...extra }));
      };
      await write('p-pulse-1440', 100, 100);
      await write('p-b-pulse-1440', 100, 101);
      await write('p-rules-1440', 100, 100);
      await write('p-b-rules-1440', 100, 104.5);
      await write('p-teams-1440', 100, 100, { iblState: { verdict: 'black', reason: 'prefiltered IBL is black' } });
      await write('p-b-teams-1440', 100, 100);
      const rows = await tagPairDiff(dir, 'p', 'p-b', { maxLumaRel: PAIR_LUMA_MAX_REL });
      const by = Object.fromEntries(rows.map((r) => [r.suffix, r]));
      expect(by['pulse-1440'].baseline.suspect).toBe(false);
      expect(by['rules-1440'].baseline.suspect).toBe(true);
      expect(by['teams-1440'].baseline.reasons.join(' ')).toMatch(/black IBL/);
      // The looser 20% default does not reject the 4% drift.
      const loose = await tagPairDiff(dir, 'p', 'p-b');
      expect(loose.find((r) => r.suffix === 'rules-1440').baseline.suspect).toBe(false);
      const single = await stillDiff(join(dir, 'p-teams-1440.png'), join(dir, 'p-b-teams-1440.png'));
      expect(single.ibl.a.verdict).toBe('black');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
