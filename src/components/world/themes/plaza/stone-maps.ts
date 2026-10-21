import * as THREE from 'three';
import { PLAZA } from '@/lib/route-world/layout';
import type { CobblePigment } from './theme-palette';

/** Matches CobbleFloor `planeGeometry` `[PLAZA.half * 2 + 6, …]`. */
const COBBLE_PLANE_M = PLAZA.half * 2 + 6;

export interface StoneMapSet {
  color: THREE.DataTexture;
  rough: THREE.DataTexture;
  normal: THREE.DataTexture;
}

function u8(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

function hash2(ix: number, iy: number): number {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function mapTexture(
  data: Uint8Array,
  size: number,
  repeat: number,
  colorSpace: THREE.ColorSpace,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size);
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Causal cream limestone — ashlar / grout / soot drive albedo, roughness,
 * and a derivative normal. Large courses (not brick) so distant façades
 * do not moiré into a dark canyon.
 */
export function stoneMaps(night: boolean, repeat = 2): StoneMapSet {
  const size = 256;
  const height = new Float32Array(size * size);
  const groutAt = new Uint8Array(size * size);
  const wearAt = new Float32Array(size * size);

  const blockW = 36;
  const blockH = 22;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const row = Math.floor(y / blockH);
      const shift = row % 2 === 0 ? 0 : blockW / 2;
      const bx = Math.floor((x + shift) / blockW);
      const by = row;
      const lx = (x + shift) % blockW;
      const ly = y % blockH;
      const groutX = lx < 1.4 || lx >= blockW - 1.4;
      const groutY = ly < 1.2 || ly >= blockH - 1.2;
      const grout = groutX || groutY;
      const wear = Math.min(1, (y / size) * 0.28 + hash2(bx, by) * 0.22);
      const i = y * size + x;
      groutAt[i] = grout ? 1 : 0;
      wearAt[i] = wear;
      height[i] = grout ? 0.08 : 0.34 + (1 - wear) * 0.06 + (hash2(bx + 3, by) - 0.5) * 0.03;
    }
  }

  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const baseR = night ? 118 : 238;
  const baseG = night ? 110 : 228;
  const baseB = night ? 96 : 208;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const o = i * 4;
      const grout = groutAt[i] === 1;
      const wear = wearAt[i];
      const grain = (valueNoise(x * 0.11, y * 0.11) - 0.5) * (night ? 8 : 14);
      if (grout) {
        albedo[o] = u8(baseR - (night ? 14 : 22) + grain);
        albedo[o + 1] = u8(baseG - (night ? 12 : 18) + grain * 0.8);
        albedo[o + 2] = u8(baseB - (night ? 10 : 16) + grain * 0.55);
      } else {
        const soot = wear * (night ? 10 : 6);
        albedo[o] = u8(baseR - soot + grain);
        albedo[o + 1] = u8(baseG - soot * 0.85 + grain * 0.7);
        albedo[o + 2] = u8(baseB - soot * 0.7 + grain * 0.45);
      }
      albedo[o + 3] = 255;

      const r = grout ? 210 : night ? 92 + wear * 36 : 148 + wear * 28;
      roughness[o] = u8(r);
      roughness[o + 1] = u8(r);
      roughness[o + 2] = u8(r);
      roughness[o + 3] = 255;

      const hL = height[y * size + ((x - 1 + size) % size)];
      const hR = height[y * size + ((x + 1) % size)];
      const hD = height[((y - 1 + size) % size) * size + x];
      const hU = height[((y + 1) % size) * size + x];
      const strength = night ? 1.4 : 1.8;
      normal[o] = u8(128 + (hL - hR) * 128 * strength);
      normal[o + 1] = u8(128 + (hD - hU) * 128 * strength);
      normal[o + 2] = 255;
      normal[o + 3] = 255;
    }
  }

  return {
    color: mapTexture(albedo, size, repeat, THREE.SRGBColorSpace),
    rough: mapTexture(roughness, size, repeat, THREE.NoColorSpace),
    normal: mapTexture(normal, size, repeat, THREE.NoColorSpace),
  };
}

/**
 * Standing-seam zinc — seam field owns albedo, roughness, and the ridge normal.
 */
export function zincMaps(night: boolean, repeat = 3): StoneMapSet {
  const size = 256;
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const seam = 18;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const lx = x % seam;
      const onSeam = lx < 2 || lx >= seam - 1;
      const pan = valueNoise(x * 0.04, y * 0.07);
      const streak = valueNoise(x * 0.02, y * 0.18);
      const base = night ? 58 : 86;
      const cool = onSeam ? 10 : 0;
      const i = (y * size + x) * 4;
      albedo[i] = u8(base + pan * 10 - cool);
      albedo[i + 1] = u8(base + 4 + pan * 8 + streak * 6);
      albedo[i + 2] = u8(base + 10 + pan * 6 + streak * 8);
      albedo[i + 3] = 255;

      const r = onSeam ? 70 : night ? 96 : 118 - streak * 18;
      roughness[i] = u8(r);
      roughness[i + 1] = u8(r);
      roughness[i + 2] = u8(r);
      roughness[i + 3] = 255;

      const ridge = onSeam ? 36 : (lx < 4 ? 8 : lx > seam - 4 ? -8 : 0);
      normal[i] = u8(128 + ridge);
      normal[i + 1] = u8(128 + (streak - 0.5) * 12);
      normal[i + 2] = 255;
      normal[i + 3] = 255;
    }
  }

  return {
    color: mapTexture(albedo, size, repeat, THREE.SRGBColorSpace),
    rough: mapTexture(roughness, size, repeat, THREE.NoColorSpace),
    normal: mapTexture(normal, size, repeat, THREE.NoColorSpace),
  };
}

/* ── Plaza cobbles: generated OFF the main thread (W7, review r5) ─────── */

/**
 * The fan/scallop sett field is 2048² texels (≈ 4.2 M evaluations of a warped
 * polar field, two noise octaves and a rounded-box SDF). Generated
 * synchronously inside a `useMemo` it blocked the main thread ≈ 2.2 s at
 * plaza load (review r5): the ceremony, the milestone wobbles and even a
 * context-loss abort waited behind it. It now runs in a Web Worker, falling
 * back to idle-sliced main-thread steps where a worker cannot start.
 *
 * ONE source of truth for the pixels: `cobbleJob` below is the only
 * implementation. The worker runs its own source text (`String(cobbleJob)`,
 * the DRACOLoader blob-worker idiom — `worker-src blob:` is already in the
 * CSP for it), the idle-slice fallback and the synchronous `cobbleMaps`
 * step the very same function, so every path is byte-identical to the
 * pre-worker generator (pinned by a SHA-256 in `stone-maps-offthread.test`).
 *
 * `cobbleJob` must therefore stay SELF-CONTAINED: no reference to anything
 * outside its own body except `Math` and the typed-array constructors — no
 * imports, no module constants, no helpers. The worker evaluates it in a
 * scope where nothing else exists. (Disclosed limit: a coverage-instrumented
 * build would inject counters the worker cannot see; the worker then errors
 * and the idle-slice fallback — same pixels — takes over.)
 */

/** Raw RGBA buffers of one cobble generation. */
export interface CobblePixels {
  albedo: Uint8Array;
  roughness: Uint8Array;
  normal: Uint8Array;
}

/** A resumable generation: `step(rows)` advances up to `rows` rows and reports completion. */
export interface CobbleJob extends CobblePixels {
  step: (maxRows: number) => boolean;
}

/** Texture edge in texels (unchanged from the synchronous generator). */
export const COBBLE_MAP_SIZE = 2048;

/**
 * World-XZ fan / scallop setts, as a resumable job. Pass 1 builds the field
 * rows (height, grout, wear, body, tint); pass 2 shades albedo / roughness /
 * derivative normal and needs pass 1 complete (the normal reads the wrapped
 * neighbour rows). Graph: world-XZ fan → irregular arc setts → per-stone
 * identity → wet-film modifier → albedo / roughness / derivative normal.
 * Night wetness is a water film on the body (lifted albedo, even roughness),
 * not metalness and not a stamped crown glint. The fan hub sits just west of
 * the statue row so rules walking sits at ~3 m radius; the polar field lives
 * in plaza meters (not UV pixels), so the rules footprint sits on a
 * short-radius arc with visible sagitta. Each sett is a worn rounded box.
 */
function cobbleJob(
  size: number,
  planeM: number,
  night: boolean,
  stone: readonly number[],
  groutInk: readonly number[],
  wetness: number,
): CobbleJob {
  const FAN_OX = 12.0;
  const FAN_OZ = -1.6;
  const MEAN_BAND_M = 0.32;

  function u8(v: number): number {
    return Math.min(255, Math.max(0, Math.round(v)));
  }

  function hash2(ix: number, iy: number): number {
    let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967296;
  }

  function valueNoise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy);
    const b = hash2(ix + 1, iy);
    const c = hash2(ix, iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Rounded-box SDF: 0 on the worn outline, negative inside the sett. */
  function sdRoundBox(px: number, py: number, hx: number, hy: number, r: number): number {
    const ax = Math.abs(px) - (hx - r);
    const ay = Math.abs(py) - (hy - r);
    const ox = Math.max(ax, 0);
    const oy = Math.max(ay, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(ax, ay), 0) - r;
  }

  const count = size * size;
  const height = new Float32Array(count);
  const groutAt = new Uint8Array(count);
  const wearAt = new Float32Array(count);
  const bodyAt = new Float32Array(count);
  const tintAt = new Int8Array(count);
  const albedo = new Uint8Array(count * 4);
  const roughness = new Uint8Array(count * 4);
  const normal = new Uint8Array(count * 4);

  /**
   * One texel of the field. Texel → plaza world XZ (meters): DataTexture
   * flipY=false, so row 0 is v=0, plane local −Y, world +Z after the
   * floor's −π/2 pitch.
   */
  function fieldAt(x: number, y: number): void {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    const x0 = (u - 0.5) * planeM;
    const z0 = (0.5 - v) * planeM;
    const wx = x0 + (valueNoise(x0 * 0.55, z0 * 0.55) - 0.5) * 0.05;
    const wz = z0 + (valueNoise(x0 * 0.55 + 40, z0 * 0.55) - 0.5) * 0.04;
    const dx = wx - FAN_OX;
    const dz = wz - FAN_OZ;
    const radius = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);

    const rWarp = radius + 0.055 * Math.sin(radius * 1.9) + 0.04 * Math.sin(angle * 2);
    const row = Math.floor(rWarp / MEAN_BAND_M);
    const hRow = hash2(row, 71);
    const bandW = MEAN_BAND_M * (0.84 + hRow * 0.28);
    const lr0 = rWarp - (row + 0.5) * MEAN_BAND_M;
    const arcGap = 0.034 + hRow * 0.012;
    const onArc = Math.abs(lr0) > bandW * 0.5 - arcGap;

    const baseLen = 0.5 + hash2(row, 5) * 0.22;
    const stagger = ((row & 1) === 0 ? 0 : 0.5) + (hash2(row, 19) - 0.5) * 0.12;
    const t = (angle * Math.max(radius, 2.4)) / baseLen + stagger;
    const i = Math.floor(t);
    const jAmt = 0.28;
    const j0 = (hash2(row, i) - 0.5) * jAmt;
    let id: number;
    let t0: number;
    let t1: number;
    if (t < i + j0) {
      id = i - 1;
      const jPrev = (hash2(row, i - 1) - 0.5) * jAmt;
      t0 = i - 1 + jPrev;
      t1 = i + j0;
    } else {
      id = i;
      const j1 = (hash2(row, i + 1) - 0.5) * jAmt;
      t0 = i + j0;
      t1 = i + 1 + j1;
    }

    const h0 = hash2(row, id);
    const h1 = hash2(row + 17, id + 9);
    const h2 = hash2(row + 3, id + 11);
    const mid = (t0 + t1) * 0.5;
    const halfL = Math.max(0.1, ((t1 - t0) * 0.5) * baseLen - (0.018 + h1 * 0.012));
    const la0 = (t - mid) * baseLen;
    const halfW = Math.max(0.08, bandW * 0.5 - arcGap);
    const u0 = la0 / halfL;
    const bow = (1 - Math.min(1, u0 * u0)) * (0.055 + h1 * 0.032);
    const rot = (h2 - 0.5) * 0.07;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const lr1 = lr0 - bow * 0.45 + (h2 - 0.5) * 0.012;
    const lr = lr1 * cr - la0 * sr;
    const la = lr1 * sr + la0 * cr;
    const corner = 0.012 + h0 * 0.016;
    const grain =
      (valueNoise(wx * 9, wz * 9) - 0.5) * 0.012 +
      (valueNoise(wx * 22 + 8, wz * 20) - 0.5) * 0.007;
    const d = sdRoundBox(lr, la, halfW, halfL, corner) + grain;
    const grout = onArc || d >= 0;
    const body = grout ? 0 : Math.max(0, Math.min(1, -d / 0.038));
    const tilt = (h2 - 0.5) * 0.025;
    const k = y * size + x;
    height[k] = grout ? 0.09 + (onArc ? 0 : 0.03) : 0.35 + body * 0.04 + tilt;
    groutAt[k] = grout ? 1 : 0;
    wearAt[k] = h0;
    bodyAt[k] = body;
    tintAt[k] = (h2 - 0.5) * 24 + (h1 - 0.5) * 10 + (onArc ? -8 : 0);
  }

  const sr = stone[0];
  const sg = stone[1];
  const sb = stone[2];
  const gr = groutInk[0];
  const gg = groutInk[1];
  const gb = groutInk[2];
  const wet = night ? Math.max(wetness, 0.85) : wetness;
  const strength = night ? 1.7 : 2.1;

  function shadeAt(x: number, y: number): void {
    const i = y * size + x;
    const o = i * 4;
    const grout = groutAt[i] === 1;
    const wear = wearAt[i];
    const body = bodyAt[i];
    const chip = (hash2(x >> 2, y >> 2) - 0.5) * (grout ? 7 : 16);
    const tint = tintAt[i];

    if (grout) {
      albedo[o] = u8(gr + chip + tint * 0.25);
      albedo[o + 1] = u8(gg + chip * 0.8 + tint * 0.18);
      albedo[o + 2] = u8(gb + chip * 0.55);
    } else {
      const stain = wear * (night ? 16 : 30);
      albedo[o] = u8(sr - stain + chip + tint);
      albedo[o + 1] = u8(sg - stain * 0.82 + chip * 0.62 + tint * 0.72);
      albedo[o + 2] = u8(sb - stain * 0.55 + chip * 0.32 + tint * 0.4);
    }
    albedo[o + 3] = 255;

    const r = grout
      ? 208 + wear * 20
      : wet > 0.35
        ? 88 + wear * 30 + (1 - body) * 14
        : 150 + wear * 36 + (1 - body) * 12;
    roughness[o] = u8(r);
    roughness[o + 1] = u8(r);
    roughness[o + 2] = u8(r);
    roughness[o + 3] = 255;

    const hL = height[y * size + ((x - 1 + size) % size)];
    const hR = height[y * size + ((x + 1) % size)];
    const hD = height[((y - 1 + size) % size) * size + x];
    const hU = height[((y + 1 + size) % size) * size + x];
    normal[o] = u8(128 + (hL - hR) * 128 * strength);
    normal[o + 1] = u8(128 + (hD - hU) * 128 * strength);
    normal[o + 2] = 255;
    normal[o + 3] = 255;
  }

  // Pass 0 = field rows, pass 1 = shading rows, pass 2 = done.
  let pass = 0;
  let row = 0;

  function step(maxRows: number): boolean {
    let budget = maxRows;
    while (pass < 2 && budget > 0) {
      if (pass === 0) {
        for (let x = 0; x < size; x += 1) fieldAt(x, row);
      } else {
        for (let x = 0; x < size; x += 1) shadeAt(x, row);
      }
      row += 1;
      budget -= 1;
      if (row === size) {
        pass += 1;
        row = 0;
      }
    }
    return pass >= 2;
  }

  return { albedo, roughness, normal, step };
}

/** Message the cobble worker receives (one job per worker). */
export interface CobbleWorkerRequest {
  size: number;
  planeM: number;
  night: boolean;
  stone: number[];
  grout: number[];
  wetness: number;
}

/** The job's arguments as plain numbers — exactly what the worker is posted. */
export function cobbleWorkerRequest(night: boolean, pigment: CobblePigment): CobbleWorkerRequest {
  return {
    size: COBBLE_MAP_SIZE,
    planeM: COBBLE_PLANE_M,
    night,
    stone: [pigment.stone[0], pigment.stone[1], pigment.stone[2]],
    grout: [pigment.grout[0], pigment.grout[1], pigment.grout[2]],
    wetness: pigment.wetness,
  };
}

function newCobbleJob(night: boolean, pigment: CobblePigment): CobbleJob {
  const args = cobbleWorkerRequest(night, pigment);
  return cobbleJob(args.size, args.planeM, args.night, args.stone, args.grout, args.wetness);
}

function cobbleMapSet(pixels: CobblePixels, repeat: number): StoneMapSet {
  return {
    color: mapTexture(pixels.albedo, COBBLE_MAP_SIZE, repeat, THREE.SRGBColorSpace),
    rough: mapTexture(pixels.roughness, COBBLE_MAP_SIZE, repeat, THREE.NoColorSpace),
    normal: mapTexture(pixels.normal, COBBLE_MAP_SIZE, repeat, THREE.NoColorSpace),
  };
}

/**
 * Fan/scallop Haussmann setts for the plaza floor — SYNCHRONOUS (≈ 1.2 s in
 * node, ≈ 2.2 s on the capture box). Kept for tests and for callers that
 * genuinely need the maps inline; the plaza floor uses `requestCobbleMaps`.
 */
export function cobbleMaps(night: boolean, pigment: CobblePigment, repeat = 1): StoneMapSet {
  const job = newCobbleJob(night, pigment);
  job.step(Number.POSITIVE_INFINITY);
  return cobbleMapSet(job, repeat);
}

/**
 * Pixels only, stepped `rowsPerStep` rows at a time (tests pin that any
 * chunking yields the same bytes as one run).
 */
export function cobblePixelsChunked(night: boolean, pigment: CobblePigment, rowsPerStep: number): CobblePixels {
  const job = newCobbleJob(night, pigment);
  while (!job.step(Math.max(1, rowsPerStep))) {
    // Resumable: each call continues where the last stopped.
  }
  return { albedo: job.albedo, roughness: job.roughness, normal: job.normal };
}

/**
 * The worker's whole program: `cobbleJob`'s own source text plus a message
 * handler that runs it to completion and TRANSFERS the three buffers back
 * (zero-copy). Name-agnostic (`(function …)` as an expression), so a
 * minifier renaming `cobbleJob` cannot break it.
 */
export function cobbleWorkerSource(): string {
  return [
    `var cobbleJob = (${String(cobbleJob)});`,
    'self.onmessage = function (event) {',
    '  var d = event.data;',
    '  var job = cobbleJob(d.size, d.planeM, d.night, d.stone, d.grout, d.wetness);',
    '  job.step(Infinity);',
    '  self.postMessage(',
    '    { albedo: job.albedo, roughness: job.roughness, normal: job.normal },',
    '    [job.albedo.buffer, job.roughness.buffer, job.normal.buffer]',
    '  );',
    '};',
  ].join('\n');
}

function isCobblePixels(value: unknown): value is CobblePixels {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const bytes = COBBLE_MAP_SIZE * COBBLE_MAP_SIZE * 4;
  return (
    record.albedo instanceof Uint8Array &&
    record.roughness instanceof Uint8Array &&
    record.normal instanceof Uint8Array &&
    record.albedo.length === bytes &&
    record.roughness.length === bytes &&
    record.normal.length === bytes
  );
}

/** Per idle slice, main-thread fallback only (a frame keeps most of its 16 ms). */
const FALLBACK_SLICE_MS = 6;

/**
 * Idle-sliced main-thread fallback: the same job, a few rows per slice until
 * the slice's budget is spent (`requestIdleCallback`, else a 0 ms task).
 * Honest cost: the ≈ 2.2 s of work still runs on the main thread, but in
 * ≤ ~7 ms pieces between frames instead of one long task.
 */
function runSliced(job: CobbleJob, onDone: () => void): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(slice, { timeout: 100 });
    } else {
      timer = setTimeout(slice, 0);
    }
  };
  const slice = () => {
    idleId = null;
    timer = null;
    if (cancelled) return;
    const start = performance.now();
    let done = false;
    while (!done && performance.now() - start < FALLBACK_SLICE_MS) done = job.step(2);
    if (done) onDone();
    else schedule();
  };
  schedule();
  return () => {
    cancelled = true;
    if (idleId !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
    if (timer !== null) clearTimeout(timer);
  };
}

let cobbleRequestSeq = 0;

/**
 * Generate the plaza cobble maps OFF the main thread and hand them to
 * `onReady` (never synchronously). Returns a cancel that stops the work and
 * guarantees `onReady` is never called afterwards.
 *
 * The request is registered with THREE's default loading manager
 * (`itemStart` / `itemEnd`, ended on cancel too), so the loader's M3
 * "assets idle" milestone — and with it the reveal gate — counts the
 * procedural floor like any streamed texture: the ceremony does not reveal
 * a placeholder floor unless the gate's hard cap fires first.
 */
export function requestCobbleMaps(
  night: boolean,
  pigment: CobblePigment,
  repeat: number,
  onReady: (maps: StoneMapSet) => void,
): () => void {
  const manager = THREE.DefaultLoadingManager;
  const key = `procedural:plaza-cobble#${(cobbleRequestSeq += 1)}`;
  manager.itemStart(key);
  let settled = false;
  let stopWork: () => void = () => {};
  const finish = (pixels: CobblePixels | null) => {
    if (settled) return;
    settled = true;
    stopWork();
    if (pixels !== null) onReady(cobbleMapSet(pixels, repeat));
    manager.itemEnd(key);
  };

  const fallback = () => {
    if (settled) return;
    const job = newCobbleJob(night, pigment);
    stopWork = runSliced(job, () => finish(job));
  };

  let worker: Worker | null = null;
  let workerUrl: string | null = null;
  try {
    if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL.createObjectURL === 'function') {
      workerUrl = URL.createObjectURL(new Blob([cobbleWorkerSource()], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
    }
  } catch {
    worker = null;
  }

  if (worker === null) {
    if (workerUrl !== null) URL.revokeObjectURL(workerUrl);
    fallback();
  } else {
    const active = worker;
    const url = workerUrl;
    const release = () => {
      active.terminate();
      if (url !== null) URL.revokeObjectURL(url);
    };
    stopWork = release;
    active.onmessage = (event: MessageEvent<unknown>) => {
      if (isCobblePixels(event.data)) {
        finish(event.data);
        return;
      }
      release();
      fallback();
    };
    active.onerror = (event) => {
      // CSP, an instrumented build or any worker fault: same pixels, sliced.
      event.preventDefault();
      release();
      fallback();
    };
    active.postMessage(cobbleWorkerRequest(night, pigment));
  }

  return () => finish(null);
}

/**
 * 1×1 stand-ins with the SAME texture configuration as the real maps (colour
 * space, wrap, repeat), shown while the worker runs. Swapping them for the
 * real maps changes no shader define, so the floor's program is compiled
 * once, not twice. Flat normal, mean stone albedo and roughness.
 */
export function cobblePlaceholderMaps(night: boolean, pigment: CobblePigment, repeat = 1): StoneMapSet {
  const wet = night ? Math.max(pigment.wetness, 0.85) : pigment.wetness;
  const rough = u8(wet > 0.35 ? 88 + 15 + 7 : 150 + 18 + 6);
  const texel = (r: number, g: number, b: number, space: THREE.ColorSpace): THREE.DataTexture =>
    mapTexture(new Uint8Array([u8(r), u8(g), u8(b), 255]), 1, repeat, space);
  return {
    color: texel(pigment.stone[0], pigment.stone[1], pigment.stone[2], THREE.SRGBColorSpace),
    rough: texel(rough, rough, rough, THREE.NoColorSpace),
    normal: texel(128, 128, 255, THREE.NoColorSpace),
  };
}

export function disposeStoneMaps(maps: StoneMapSet): void {
  maps.color.dispose();
  maps.rough.dispose();
  maps.normal.dispose();
}
