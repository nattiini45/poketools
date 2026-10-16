/**
 * Banded uploads for giant painted faces (ROLLOUT-PLAN §3.2 E3; D34 D-R3).
 *
 * The theme worlds' data faces are painted canvases at their ≥ 2× legibility
 * floor (C-105): the sakura tablet 2386×2710, the sakura frieze 4096×1024,
 * the rock and summit boards, the mountain register, the gate plaques, the
 * clouds sail and boards, the banners and cloths. One `texImage2D` of such a
 * canvas is 10-26 MB in ONE GPU task on the ANGLE box — the loading
 * ceremony's worst compositor gaps. Clarity outranks CAR, so the canvases are
 * never downscaled; the upload is split instead:
 *
 * 1. allocate the texture's full-size storage once, with no texel transfer
 *    (`Source.dataReady = false` around `initTexture`: three runs
 *    `texStorage2D` and skips the `texSubImage2D`, then records the texture
 *    as uploaded);
 * 2. copy the canvas in bands of at most BAND_MAX_WIDTH × BAND_MAX_HEIGHT
 *    texels (≤ 2 MiB each) with `renderer.copyTextureToTexture`, a CPU → GPU
 *    `texSubImage2D` per band through `UNPACK_SKIP_PIXELS / SKIP_ROWS`, at
 *    most BAND_MAX_BYTES per load-warm step (one step per ceremony frame,
 *    spaced by the warm's GPU fence).
 *
 * Every pixel-store parameter of the whole upload is reproduced (flip, alpha,
 * alignment and colour-space conversion come from the face texture itself),
 * into the same immutable storage (same internal format, one level, no
 * mips), so the texels are identical to a whole upload (`verifyBandedUpload`
 * reads both back; the rollout ENGINE evidence records diff = 0).
 *
 * A texture opts in with `markBandedUpload` (the theme worlds' face paint
 * paths); only a marked texture larger than one band is banded, so every
 * other upload is untouched. While bands are pending the load warm counts the
 * texture as NOT on the GPU (`bandsPending`), so no stage, no `uploaded`
 * milestone and no reveal happens before every band has landed.
 *
 * The band plan is pure (node-testable); the GL side needs a WebGL2 renderer
 * (three r163+ is WebGL2-only).
 */

import { Box2, LinearFilter, NearestFilter, NoColorSpace, Texture, Vector2 } from 'three';
import type { WebGLRenderer } from 'three';

/** Widest band (texels). */
export const BAND_MAX_WIDTH = 2048;
/** Tallest band (texels). */
export const BAND_MAX_HEIGHT = 256;
/** Largest band, and the most one warm step may transfer for one texture: 2 MiB of RGBA8. */
export const BAND_MAX_BYTES = BAND_MAX_WIDTH * BAND_MAX_HEIGHT * 4;

/** One band in SOURCE (canvas) coordinates: top-left origin, rows downward. */
export interface UploadBand {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The band plan of a `width × height` source: row-major from the canvas top,
 * each band at most `maxWidth × maxHeight`, together tiling the source exactly
 * once (pure).
 */
export function planUploadBands(
  width: number,
  height: number,
  maxWidth: number = BAND_MAX_WIDTH,
  maxHeight: number = BAND_MAX_HEIGHT,
): UploadBand[] {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const bw = Math.max(1, Math.floor(maxWidth));
  const bh = Math.max(1, Math.floor(maxHeight));
  const bands: UploadBand[] = [];
  for (let y = 0; y < h; y += bh) {
    for (let x = 0; x < w; x += bw) {
      bands.push({ x, y, width: Math.min(bw, w - x), height: Math.min(bh, h - y) });
    }
  }
  return bands;
}

/** Texel bytes of one band (RGBA8, the only format a painted canvas face uploads to). */
export function bandBytes(band: UploadBand): number {
  return band.width * band.height * 4;
}

/**
 * The row a band starts at in the UPLOAD's row space, for both the
 * `UNPACK_SKIP_ROWS` source region and the destination offset. With
 * `flipY` (three's default for canvases) the browser flips the whole source
 * before selecting the sub-rectangle, so a band of canvas rows
 * `[y, y + bandHeight)` is flipped rows `[height − y − bandHeight, height − y)`
 * on both sides; without the flip it keeps its canvas rows. Pure.
 *
 * Measured in the harness's Chromium (ANGLE / D3D11, SRGB8_ALPHA8 storage):
 * this mapping reads back byte-identical to a whole `texSubImage2D` upload of
 * the same canvas (3000×700, 640×1920 with alpha, 2386×2710: 0 differing
 * bytes); taking the source region from the canvas top instead differs in
 * 75–99 % of the bytes.
 */
export function bandDestinationY(sourceHeight: number, band: UploadBand, flipY: boolean): number {
  return flipY ? sourceHeight - band.y - band.height : band.y;
}

const BANDED_KEY = 'bandedUpload';

/**
 * Marked textures not yet disposed, in marking order: the load warm bands
 * them EARLY — on the frames it spends waiting for the content to complete,
 * before any compile opens (the GPU is otherwise idle then) — so the giant
 * faces are usually resident before the textures stage starts. A texture
 * leaves the registry on `dispose` (a repaint or unmount), so the warm never
 * re-allocates storage three has already freed.
 */
const registry = new Set<Texture>();

function forget(this: Texture): void {
  registry.delete(this);
  this.removeEventListener('dispose', forget);
}

/** Opt a texture into banded uploads (a no-op for one that fits a single band). Returns it. */
export function markBandedUpload<T extends Texture>(texture: T): T {
  texture.userData[BANDED_KEY] = true;
  if (!registry.has(texture)) {
    registry.add(texture);
    texture.addEventListener('dispose', forget);
  }
  return texture;
}

/** The live marked textures that want banding (the warm's early-band candidates). */
export function bandedCandidates(): Texture[] {
  const out: Texture[] = [];
  for (const texture of registry) if (bandedUploadWanted(texture)) out.push(texture);
  return out;
}

interface SizedSource {
  width: number;
  height: number;
}

/** The DOM-like source (canvas, image, bitmap) of a plain 2D texture, or null. */
function sourceOf(texture: Texture): SizedSource | null {
  const t = texture as Texture & {
    isCompressedTexture?: boolean;
    isDataTexture?: boolean;
    isDataArrayTexture?: boolean;
    isData3DTexture?: boolean;
    isRenderTargetTexture?: boolean;
    isVideoTexture?: boolean;
    isCubeTexture?: boolean;
    isDepthTexture?: boolean;
  };
  if (
    t.isCompressedTexture === true ||
    t.isDataTexture === true ||
    t.isDataArrayTexture === true ||
    t.isData3DTexture === true ||
    t.isRenderTargetTexture === true ||
    t.isVideoTexture === true ||
    t.isCubeTexture === true ||
    t.isDepthTexture === true
  ) {
    return null;
  }
  const image = texture.image as { width?: unknown; height?: unknown; data?: unknown } | null | undefined;
  if (image == null || Array.isArray(image) || image.data !== undefined) return null;
  if (typeof image.width !== 'number' || typeof image.height !== 'number') return null;
  if (image.width <= 0 || image.height <= 0) return null;
  return { width: image.width, height: image.height };
}

/**
 * Whether the warm uploads this texture in bands: marked, a plain 2D source,
 * no mip chain (a generated chain would be rebuilt per band), and larger than
 * one band.
 */
export function bandedUploadWanted(texture: Texture): boolean {
  if (texture.userData?.[BANDED_KEY] !== true) return false;
  if (texture.generateMipmaps && texture.minFilter !== LinearFilter && texture.minFilter !== NearestFilter) return false;
  if (texture.mipmaps !== undefined && texture.mipmaps.length > 0) return false;
  const source = sourceOf(texture);
  if (source === null) return false;
  return source.width * source.height * 4 > BAND_MAX_BYTES;
}

interface BandState {
  gl: WebGLRenderer;
  /** `texture.version` the bands are for (a repaint bumps it: a fresh plan). */
  version: number;
  image: unknown;
  bands: UploadBand[];
  next: number;
  /** A texture over the same canvas that the renderer never sees: the copy source. */
  staging: Texture;
  startedAt: number;
  steps: number;
  finishedAt: number | null;
}

const states = new WeakMap<Texture, BandState>();

/** A readout row per banded texture (evidence; most recent last, capped). */
export interface BandedUploadRecord {
  width: number;
  height: number;
  bands: number;
  steps: number;
  /** Wall time from allocation to the last band (ms), null while pending. */
  ms: number | null;
  name: string;
  texture: WeakRef<Texture> | null;
}

const log: BandedUploadRecord[] = [];
const LOG_CAP = 64;

function currentState(texture: Texture): BandState | null {
  const state = states.get(texture);
  if (!state || state.version !== texture.version || state.image !== texture.image) return null;
  return state;
}

/** Bands are still owed for the texture's current version (the warm counts it as not uploaded). */
export function bandsPending(texture: Texture): boolean {
  const state = currentState(texture);
  return state !== null && state.next < state.bands.length;
}

/** Bytes the next step for this texture would transfer (the warm's byte budget), capped at BAND_MAX_BYTES. */
export function nextBandedStepBytes(texture: Texture, budgetBytes: number = BAND_MAX_BYTES): number {
  const state = currentState(texture);
  const source = sourceOf(texture);
  const bands = state?.bands ?? (source ? planUploadBands(source.width, source.height) : []);
  const from = state?.next ?? 0;
  let bytes = 0;
  for (let i = from; i < bands.length; i += 1) {
    const next = bandBytes(bands[i]);
    if (bytes > 0 && bytes + next > Math.min(budgetBytes, BAND_MAX_BYTES)) break;
    bytes += next;
  }
  return bytes;
}

export interface BandedStepResult {
  /** Texel bytes transferred by this step. */
  bytes: number;
  /** Bands copied by this step. */
  bands: number;
  /** Every band has landed (the texture is complete on the GPU). */
  done: boolean;
}

const regionScratch = new Box2(new Vector2(), new Vector2());
const positionScratch = new Vector2();

/**
 * One warm step of a banded upload: allocates the storage on the first call
 * (through `allocate`, the warm's un-deferred `initTexture`), then copies
 * bands until `budgetBytes` (never above BAND_MAX_BYTES; at least one band).
 * Throws what the GL throws (the warm treats it as a failed upload).
 */
export function stepBandedUpload(
  gl: WebGLRenderer,
  texture: Texture,
  budgetBytes: number,
  allocate: (texture: Texture) => void,
): BandedStepResult {
  const source = sourceOf(texture);
  if (source === null) {
    allocate(texture);
    return { bytes: 0, bands: 0, done: true };
  }
  let state = currentState(texture);
  if (state === null || state.gl !== gl) {
    // Storage only: three allocates (texStorage2D) and records the version,
    // but transfers nothing while the source is not `dataReady`.
    const wasReady = texture.source.dataReady;
    texture.source.dataReady = false;
    try {
      allocate(texture);
    } finally {
      texture.source.dataReady = wasReady;
    }
    const staging = new Texture(texture.image);
    state = {
      gl,
      version: texture.version,
      image: texture.image,
      bands: planUploadBands(source.width, source.height),
      next: 0,
      staging,
      startedAt: performance.now(),
      steps: 0,
      finishedAt: null,
    };
    states.set(texture, state);
    log.push({
      width: source.width,
      height: source.height,
      bands: state.bands.length,
      steps: 0,
      ms: null,
      name: texture.name,
      texture: typeof WeakRef === 'function' ? new WeakRef(texture) : null,
    });
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP);
  }
  const budget = Math.max(1, Math.min(budgetBytes, BAND_MAX_BYTES));
  const context = gl.getContext();
  const conversion = texture.colorSpace === NoColorSpace ? context.NONE : context.BROWSER_DEFAULT_WEBGL;
  let bytes = 0;
  let copied = 0;
  while (state.next < state.bands.length) {
    const band = state.bands[state.next];
    const size = bandBytes(band);
    if (copied > 0 && bytes + size > budget) break;
    // The whole upload's colour-space conversion (copyTextureToTexture sets
    // flip, premultiply and alignment from the destination itself).
    gl.state.pixelStorei(context.UNPACK_COLORSPACE_CONVERSION_WEBGL, conversion);
    // With UNPACK_FLIP_Y the browser flips the WHOLE source first, so the
    // skip-rows region is in flipped (bottom-origin) rows too: source and
    // destination rows are the same (measured texel-exact in Chromium).
    const row = bandDestinationY(source.height, band, texture.flipY);
    regionScratch.min.set(band.x, row);
    regionScratch.max.set(band.x + band.width, row + band.height);
    positionScratch.set(band.x, row);
    gl.copyTextureToTexture(state.staging, texture, regionScratch, positionScratch);
    state.next += 1;
    bytes += size;
    copied += 1;
  }
  state.steps += 1;
  const done = state.next >= state.bands.length;
  const record = [...log].reverse().find((row) => row.texture?.deref() === texture);
  if (record) record.steps = state.steps;
  if (done && state.finishedAt === null) {
    state.finishedAt = performance.now();
    if (record) record.ms = Math.round(state.finishedAt - state.startedAt);
  }
  return { bytes, bands: copied, done };
}

/** The banded uploads so far (evidence readout; `texture` refs stripped). */
export function bandedUploadLog(): Omit<BandedUploadRecord, 'texture'>[] {
  return log.map(({ texture: _texture, ...row }) => {
    void _texture;
    return row;
  });
}

/** Tests only. */
export function resetBandedUploadsForTests(): void {
  log.length = 0;
  for (const texture of [...registry]) texture.removeEventListener('dispose', forget);
  registry.clear();
}

/**
 * Debug evidence: read every live banded texture back and compare it texel
 * for texel with a WHOLE upload of the same source (a scratch texture with
 * the same parameters, uploaded by `initTexture`, read back, disposed).
 * Costs a full upload per face — call it only from a probe, never at load.
 */
export function verifyBandedUploads(gl: WebGLRenderer): { name: string; width: number; height: number; texels: number; diffBytes: number; pending: boolean }[] {
  const context = gl.getContext() as WebGL2RenderingContext;
  const read = (texture: Texture, width: number, height: number): Uint8Array | null => {
    const handle = (gl.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
    if (!handle) return null;
    const framebuffer = context.createFramebuffer();
    const pixels = new Uint8Array(width * height * 4);
    try {
      context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
      context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, handle, 0);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
    } finally {
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.deleteFramebuffer(framebuffer);
      gl.state.reset();
    }
    return pixels;
  };
  const out: { name: string; width: number; height: number; texels: number; diffBytes: number; pending: boolean }[] = [];
  for (const row of log) {
    const texture = row.texture?.deref();
    if (!texture || texture.image == null) continue;
    const source = sourceOf(texture);
    if (source === null) continue;
    const reference = texture.clone();
    reference.userData = {};
    reference.needsUpdate = true;
    try {
      gl.initTexture(reference);
      const a = read(texture, source.width, source.height);
      const b = read(reference, source.width, source.height);
      let diff = -1;
      if (a && b) {
        diff = 0;
        for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
      }
      out.push({ name: row.name, width: source.width, height: source.height, texels: source.width * source.height, diffBytes: diff, pending: bandsPending(texture) });
    } finally {
      reference.dispose();
    }
  }
  return out;
}
