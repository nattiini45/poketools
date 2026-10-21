/**
 * R40 (desktop CAPTURE) harness additions: --no-boot, the water-body screen
 * rects, the per-frame beats / core-actor / draw records and the new
 * pass-through bridges. capture-route.mjs runs the harness at import time, so
 * its wiring is checked on the source text (the bucket-guard precedent).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attachNoBoot,
  cameraFromPose,
  compactBeats,
  compactCoreActors,
  frameDraws,
  waterScreenRects,
} from '../lib/gauntlet-evidence.mjs';
import { PASS_THROUGH_BRIDGES, passThroughRecord } from '../lib/w1-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const source = readFileSync(resolve(repoRoot, 'scripts', 'capture-route.mjs'), 'utf8');
const noSleep = () => Promise.resolve();

describe('--no-boot (attachNoBoot)', () => {
  it('attaches on the first HTTP response and never needs a kill or a boot', async () => {
    const calls = [];
    const out = await attachNoBoot(async (url, ms) => (calls.push([url, ms]), { kind: 'ok' }), 'http://localhost:3111/route-preview', { port: 3111, sleep: noSleep });
    expect(out).toEqual({ ok: true, attempts: 1, kinds: ['ok'] });
    expect(calls).toEqual([['http://localhost:3111/route-preview', 30000]]);
  });

  it('retries a silent (still compiling) server and attaches when it answers', async () => {
    const seq = ['wedged', 'wedged', 'ok'];
    const out = await attachNoBoot(async () => ({ kind: seq.shift() }), 'u', { sleep: noSleep });
    expect(out.attempts).toBe(3);
    expect(out.kinds).toEqual(['wedged', 'wedged', 'ok']);
  });

  it('fails the run with a clear message when the server stays silent', async () => {
    await expect(attachNoBoot(async () => ({ kind: 'wedged' }), 'u', { port: 3111, sleep: noSleep })).rejects.toThrow(
      /--no-boot: port 3111 accepted the connection but sent no HTTP response.*never kills or boots/,
    );
  });

  it('fails when nothing listens, and survives a throwing probe', async () => {
    await expect(attachNoBoot(async () => ({ kind: 'refused' }), 'u', { port: 3111, sleep: noSleep })).rejects.toThrow(/nothing is listening on port 3111/);
    await expect(
      attachNoBoot(
        async () => {
          throw new Error('EHOSTUNREACH');
        },
        'u',
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/probe of u failed \(error, error, error\)/);
  });

  it('is wired: the flag skips ensureServer and is a value-less flag', () => {
    expect(source).toMatch(/const noBootOn = process\.argv\.includes\('--no-boot'\);/);
    expect(source).toMatch(/serverChild = prodAttachOn \|\| noBootOn \? null : await ensureServer\(\);/);
    expect(source).toMatch(/await attachNoBoot\(probe, previewUrl, \{ port \}\)/);
    expect(source).toMatch(/'--prod-attach', '--no-boot', '--dolly-stills'/);
    expect(source).toMatch(/--no-boot {15}R40: attach to the dev server/);
  });
});

// A three.js-style perspective camera at the origin looking down -Z (column-major elements).
function perspective(fovDeg, aspect, near, far) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const CAM = { view: IDENTITY, proj: perspective(90, 1, 0.1, 100), canvas: { left: 0, top: 0, width: 100, height: 100 }, viewport: { width: 100, height: 100 } };
const lake = (over = {}) => ({ id: 'lake', params: { center: [0, -10], radii: [1, 1], surfaceY: 0, waves: [], ...over } });

describe('waterScreenRects (R8 / K5 mask)', () => {
  it('projects the surface ellipse at surfaceY +- (amplitude + margin) into viewport px', () => {
    const out = waterScreenRects([lake()], CAM);
    expect(out.bodies).toHaveLength(1);
    const b = out.bodies[0];
    expect(b.onScreen).toBe(true);
    expect(b.nearClipped).toBe(false);
    // x: +-1 m at z -9 (nearest rim) -> 50 -+ 5.56 px; y: +-0.1 m at z -9 -> 50 -+ 0.56 px.
    expect(b.rect).toEqual({ x: 44, y: 49, w: 12, h: 2 });
    expect(b.verticalM).toBe(0.2);
  });

  it('adds the summed wave amplitude to the vertical extent and offsets by the canvas box', () => {
    const cam = { ...CAM, canvas: { left: 10, top: 20, width: 100, height: 100 }, viewport: { width: 200, height: 200 } };
    const b = waterScreenRects([lake({ waves: [{ amplitudeM: 0.5 }, { amplitudeM: 0.4 }] })], cam).bodies[0];
    // y: +-1.0 m at z -9 -> 50 -+ 5.56 px, then + top 20.
    expect(b.rect.y).toBe(64);
    expect(b.rect.y + b.rect.h).toBe(76);
    expect(b.rect.x).toBe(54);
  });

  it('widens a near-clipped body to the viewport sides and bottom, and nulls one behind the eye', () => {
    const around = waterScreenRects([{ id: 'pond', params: { center: [0, 0], radii: [5, 5], surfaceY: -1, waves: [] } }], CAM).bodies[0];
    expect(around.nearClipped).toBe(true);
    expect(around.rect.x).toBe(0);
    expect(around.rect.x + around.rect.w).toBe(100);
    expect(around.rect.y + around.rect.h).toBe(100);
    const behind = waterScreenRects([lake({ center: [0, 10] })], CAM).bodies[0];
    expect(behind.rect).toBeNull();
    expect(behind.reason).toBe('behind the camera');
  });

  it('is unmeasured without a camera, and tolerates a body without params', () => {
    const out = waterScreenRects([lake()], null);
    expect(out.source).toBe('unmeasured');
    expect(out.bodies).toEqual([{ id: 'lake', rect: null }]);
    expect(waterScreenRects([{ id: 'x' }], CAM).bodies[0]).toEqual({ id: 'x', rect: null, reason: 'no params' });
  });

  it('rebuilds the same camera from a sidecar cameraPose (yaw / pitch / fov, no roll)', () => {
    const cam = cameraFromPose({ camPos: [0, 0, 0], yawRad: 0, pitchRad: 0, fov: 90 }, 100, 100);
    expect(waterScreenRects([lake()], cam).bodies[0].rect).toEqual({ x: 44, y: 49, w: 12, h: 2 });
    // Moved and turned: the camera 10 m east looking west sees the same lake centred again.
    const turned = cameraFromPose({ camPos: [10, 0, -10], yawRad: -Math.PI / 2, pitchRad: 0, fov: 90 }, 100, 100);
    const r = waterScreenRects([lake()], turned).bodies[0].rect;
    expect(r.x + r.w / 2).toBeCloseTo(50, 0);
    expect(r.y + r.h / 2).toBeCloseTo(50, 0);
    expect(cameraFromPose({ camPos: [0, 0, 0], yawRad: 0 }, 100, 100)).toBeNull();
    expect(cameraFromPose(null, 100, 100)).toBeNull();
  });

  it('is wired into every debug still sidecar', () => {
    expect(source).toMatch(/probe\.waterRects = waterScreenRects\(water\.bodies, cam\);/);
  });
});

describe('per-frame records for --frames traces', () => {
  const report = {
    t: 31.23456,
    quiet: { active: true, subjectId: 'player-0001' },
    rollCall: { running: false, hits: {} },
    granted: [{ ticket: 3, kind: 'flyover', actorId: 'sakura-prop-flyer-core-probe', grantedAtS: 18.0123 }],
    pending: [{ ticket: 4, kind: 'surfacing', actorId: 's', deniedReason: 'quiet' }],
    grants: [{}, {}],
    figureBeats: [{}],
    denials: { quiet: 4 },
    suppression: 'quiet',
    readingWindow: { open: false, sinceSettleS: 12.5 },
    sinceHeroEndS: null,
  };

  it('compacts the beat bus to what changes per frame', () => {
    expect(compactBeats(report)).toEqual({
      t: 31.235,
      quiet: { active: true, subjectId: 'player-0001' },
      rollCall: false,
      granted: [['flyover', 'sakura-prop-flyer-core-probe', 18.012]],
      pending: [['surfacing', 's', 'quiet']],
      suppression: 'quiet',
      readingOpen: false,
      sinceSettleS: 12.5,
      sinceHeroEndS: null,
      grants: 2,
      figureBeats: 1,
    });
    expect(compactBeats(null)).toBeNull();
    expect(compactBeats({ error: 'boom' })).toEqual({ error: 'boom' });
  });

  it('compacts the core actors without their flip logs', () => {
    const row = { id: 'f', kind: 'flyer', mode: 'pass', wants: true, x: 1.23456, y: 2, z: 3, requests: 1, surfacings: 0, passes: 0, plays: 0, wakes: 0, waterline: 0, flips: [{}, {}] };
    expect(compactCoreActors({ world: 'sakura', actors: [row] })).toEqual({
      actors: [{ id: 'f', kind: 'flyer', mode: 'pass', wants: true, pos: [1.235, 2, 3], requests: 1, surfacings: 0, passes: 0, plays: 0, wakes: 0, waterline: 0, flips: 2 }],
    });
    expect(compactCoreActors(null)).toBeNull();
  });

  it('summarises the per-frame draw calls of the warm-stats windows', () => {
    const d = frameDraws([
      { frames: 3, calls: 900, slow: [{ t: 1, calls: 300 }, { t: 2, calls: 310 }, { t: 3, calls: 290 }] },
      { frames: 41, calls: 0, slow: Array.from({ length: 40 }, (_, i) => ({ t: i, calls: 305 })) },
    ]);
    expect(d.frames).toBe(44);
    expect(d.listed).toBe(43);
    expect(d.truncated).toBe(true);
    expect([d.min, d.median, d.max]).toEqual([290, 305, 310]);
    expect(frameDraws(null)).toBeNull();
    expect(frameDraws([{ error: 'x' }])).toBeNull();
  });

  it('is wired into the presented --frames path', () => {
    expect(source).toMatch(/page\.evaluate\(readFrameExtrasInPage, extrasFrom\)/);
    expect(source).toMatch(/\.\.\.\(draws \? \{ draws \} : \{\}\)/);
  });
});

describe('pass-through bridges (R40)', () => {
  it('reads the core actors and the water bodies beside the beats', () => {
    expect(PASS_THROUGH_BRIDGES).toEqual(['__routeWorldBeats', '__routeWorldAttacks', '__routeWorldCoreActors', '__routeWorldWater']);
    expect(passThroughRecord('__routeWorldCoreActors', { present: true, value: { actors: [{}, {}, {}] } }).entries).toBe(3);
    expect(passThroughRecord('__routeWorldWater', { present: true, value: { bodies: [{}] } }).entries).toBe(1);
  });

  it('records them at the end of quiet runs too', () => {
    // R41 adds the force-clock record between the bridges and the legs.
    expect(source).toMatch(/bridges: await readPassThroughBridges\(page\)\.catch\(\(\) => null\),\n[\s\S]{0,400}?\n {4}legs,/);
  });
});
