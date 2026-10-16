#!/usr/bin/env node
/**
 * D42 material arm, lint and fixes (ENGINE-ASSET-PLAN §4 SEAT ASSET step 6;
 * owner answers D46 / Q3). The ARM itself (mirror `d42m/`) is built only after
 * D2; this tool's dry run classifies mirror A now.
 *
 * Classification, per material, straight from each GLB's JSON (an omitted
 * `metallicFactor` is not the same thing as an authored 1.0, and only the
 * JSON can tell them apart):
 *  - `accidentalMetal` — the D46 "accidental chrome": `metallicFactor`
 *    omitted (glTF default 1.0) AND no metallicRoughnessTexture. Fix:
 *    `metallicFactor 0`. Genuine metals (an authored factor, or an MR
 *    texture) keep theirs;
 *  - `opaqueBlend` — alphaMode BLEND with nothing translucent: baseColor
 *    alpha 1, no texel of the base-colour texture below 255, no vertex
 *    colour alpha below 1 on any primitive drawn with it. Fix: OPAQUE;
 *  - `blendDoubleSided` — BLEND + doubleSided. Whether it is a GENUINE
 *    TRANSLUCENT SHELL (`translucentShell`, fix: single-sided) is measured by
 *    `SHELL_RULE` on a genuinely translucent one (evidence in `shell`):
 *     1. a uniform translucent layer — the area-weighted alpha the surface
 *        samples (baseColorFactor × texel at the primitive's UV, through
 *        KHR_texture_transform and the sampler's wrap × vertex alpha; the
 *        three vertices and the centroid of every triangle) has p95 < 250
 *        and p95 − p5 ≤ 32, or is 0 everywhere (an invisible part);
 *     2. a closed outward shell — ≥ 95 % of its triangles lie in
 *        position-welded components that are closed or near-closed (boundary
 *        edges ≤ 2 % of the component's edges) with a positive signed volume
 *        (outward winding, node determinant applied), and ≥ 95 % of the
 *        triangles' winding agrees with their NORMAL (when present).
 *    Cards (irises, eyes, mouths, flames, wings), bodies with alpha cutouts
 *    and near-opaque parts keep doubleSided;
 *  - `transmission` — KHR_materials_transmission (the transmission pre-pass,
 *    X11). Fix: strip;
 *  - `unlit` — KHR_materials_unlit, with `unlitColor` ('none' | 'white' |
 *    'colored'): whether the primitives drawn with it carry COLOR_0 and
 *    whether every value of it decodes to exactly 1. The R50 item 4
 *    normalisation (fix `unlit-color`): an all-white COLOR_0 on an unlit
 *    primitive is dropped from the primitive, so every unlit export keys the
 *    one no-colour unlit program (pixel-identical: the colour multiplied by
 *    exactly 1; JSON-only, the accessor stays in the file unreferenced).
 *    A coloured unlit export is never touched.
 *
 * The lint GATE (`--check`): every BLEND material needs alpha < 1 somewhere
 * (factor, texture alpha, vertex alpha), and no material carries
 * transmission. Exit 1 on a violation.
 *
 * Fixes are JSON-chunk patches (`--apply --fix metal[,blend-opaque,transmission,
 * single-sided,unlit-color] --out <dir>`): the BIN chunk is byte-identical, so
 * geometry, textures and a meshopt encode are untouched, and a second run
 * changes nothing. `--except file#index,...` leaves judged-out materials
 * alone (every fix); an entry that names no material of `--src` is refused
 * before anything is written, and `--except-reasons <json>` (one reason per
 * entry: `{ "file#index": "why" }`) records why in `_encode.json`
 * (`exceptReasons`). `--mirror` builds a whole arm: every file of `--src`
 * is copied to `--out` (env/, manifest.json, ATTRIBUTION.md and the
 * unchanged GLBs byte-identical), the fixed GLBs are written over it, and
 * `<out>/_encode.json` records the source arm (its encode stamp and
 * `_encode.json` sha256), the fixes, the rule, and one row per GLB (source
 * and output sha256, the source row's recipe, the changes).
 *
 * Usage:
 *   node scripts/world-assets/material-lint.mjs --src <mirror> [--report <json>]          (dry run)
 *   node scripts/world-assets/material-lint.mjs --src <mirror> --apply --fix metal --out <dir>
 *   node scripts/world-assets/material-lint.mjs --src public/models/world/d42 --apply --mirror \
 *     --fix metal,blend-opaque,transmission,single-sided,unlit-color --out public/models/world/d42m \
 *     [--except f#i,... [--except-reasons <reasons.json>]]
 *   node scripts/world-assets/material-lint.mjs --check <mirror>
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { rewriteGlbJson } from './d42-parity.mjs';
import { encodableFiles } from './compress-mirror.mjs';
import { createWorldIO, glbJson } from './meshopt-codec.mjs';
import { relPosix, walkFiles } from './lib.mjs';

export const FIXES = ['metal', 'blend-opaque', 'transmission', 'single-sided', 'unlit-color'];

/** The genuine-translucent-shell rule (see header). */
export const SHELL_RULE = {
  alphaP95Max: 250,
  alphaSpreadMax: 32,
  nearClosedBoundaryMax: 0.02,
  outwardShareMin: 0.95,
  normalAgreeMin: 0.95,
  weldDigits: 6,
};

/** The BIN chunk of a GLB (or null). */
export function glbBin(bytes) {
  const buf = Buffer.from(bytes);
  const jsonLength = buf.readUInt32LE(12);
  const at = 20 + jsonLength;
  if (at + 8 > buf.length) return null;
  const length = buf.readUInt32LE(at);
  if (buf.readUInt32LE(at + 4) !== 0x004e4942) return null;
  return buf.subarray(at + 8, at + 8 + length);
}

/** The image bytes a texture index points at (WebP / basisu extension sources included). */
function textureImageBytes(json, bin, textureIndex) {
  const texture = json.textures?.[textureIndex];
  if (!texture) return null;
  const source = texture.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.extensions?.KHR_texture_basisu?.source;
  const image = json.images?.[source];
  if (!image || image.bufferView === undefined || !bin) return null;
  const view = json.bufferViews[image.bufferView];
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

/** Smallest alpha (0-255) of an image, 255 when it has no alpha channel. */
export async function minImageAlpha(imageBytes) {
  const img = sharp(imageBytes);
  const meta = await img.metadata();
  if (!meta.hasAlpha) return 255;
  const stats = await img.stats();
  return stats.channels[3]?.min ?? 255;
}

/** The alpha plane of an image ({ data: RGBA, w, h }), or null without an alpha channel. */
async function imageAlphaPlane(imageBytes) {
  const img = sharp(imageBytes);
  const meta = await img.metadata();
  if (!meta.hasAlpha) return null;
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const WRAP = { CLAMP: 33071, MIRROR: 33648 };

function wrapCoord(u, mode) {
  if (mode === WRAP.CLAMP) return Math.min(1, Math.max(0, u));
  const f = u - Math.floor(u);
  if (mode === WRAP.MIRROR) return Math.floor(u) % 2 ? 1 - f : f;
  return f;
}

/** The UV a texture info samples at: its texCoord set, through KHR_texture_transform (offset, rotation, scale). */
function textureUv(textureInfo) {
  const transform = textureInfo?.getExtension?.('KHR_texture_transform') ?? null;
  const texCoord = transform?.getTexCoord?.() ?? textureInfo?.getTexCoord() ?? 0;
  if (!transform) return { texCoord, map: (u, v) => [u, v] };
  const [ox, oy] = transform.getOffset();
  const [sx, sy] = transform.getScale();
  const r = transform.getRotation();
  const c = Math.cos(r);
  const s = Math.sin(r);
  // glTF KHR_texture_transform: T · R · S, R = [[cos, sin], [−sin, cos]].
  return { texCoord, map: (u, v) => [c * sx * u + s * sy * v + ox, -s * sx * u + c * sy * v + oy] };
}

function percentile(samples, total, q) {
  let acc = 0;
  for (const [value, weight] of samples) {
    acc += weight;
    if (acc >= q * total) return value;
  }
  return samples.length ? samples[samples.length - 1][0] : 255;
}

/**
 * Area-weighted alpha (0-255) the surface of `material` samples (see header,
 * rule 1). Returns { p5, p50, p95, invisible }.
 */
export async function surfaceAlpha(document, material) {
  const factor = material.getBaseColorFactor()[3];
  const info = material.getBaseColorTextureInfo();
  const texture = material.getBaseColorTexture();
  const plane = texture ? await imageAlphaPlane(Buffer.from(texture.getImage())) : null;
  const { texCoord, map } = textureUv(info);
  const wrapS = info?.getWrapS() ?? 10497;
  const wrapT = info?.getWrapT() ?? 10497;
  const texel = (u, v) => {
    if (!plane) return 255;
    const [tu, tv] = map(u, v);
    const x = Math.min(plane.w - 1, Math.floor(wrapCoord(tu, wrapS) * plane.w));
    const y = Math.min(plane.h - 1, Math.floor(wrapCoord(tv, wrapT) * plane.h));
    return plane.data[(y * plane.w + x) * 4 + 3];
  };
  const samples = [];
  let total = 0;
  const P = [[], [], []];
  const U = [[], [], []];
  const e = [];
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() !== material) continue;
      const pos = prim.getAttribute('POSITION');
      const uv = prim.getAttribute(`TEXCOORD_${texCoord}`);
      const color = prim.getAttribute('COLOR_0');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      for (let t = 0; t + 2 < n; t += 3) {
        const ids = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        ids.forEach((id, k) => {
          pos.getElement(id, P[k]);
          if (uv) uv.getElement(id, U[k]);
        });
        const e1 = P[1].map((v, k) => v - P[0][k]);
        const e2 = P[2].map((v, k) => v - P[0][k]);
        const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
        const vertexAlpha = color && color.getElementSize() === 4 ? Math.min(...ids.map((id) => color.getElement(id, e)[3])) : 1;
        const points = uv ? [U[0], U[1], U[2], [(U[0][0] + U[1][0] + U[2][0]) / 3, (U[0][1] + U[1][1] + U[2][1]) / 3]] : [[0, 0]];
        for (const [u, v] of points) samples.push([texel(u, v) * factor * vertexAlpha, area / points.length]);
        total += area;
      }
    }
  }
  samples.sort((a, b) => a[0] - b[0]);
  const round = (v) => Math.round(v * 10) / 10;
  return {
    p5: round(percentile(samples, total, 0.05)),
    p50: round(percentile(samples, total, 0.5)),
    p95: round(percentile(samples, total, 0.95)),
    invisible: samples.length > 0 && samples[samples.length - 1][0] === 0,
  };
}

function det3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
}

/**
 * Shell geometry of `material` (see header, rule 2): its triangles welded by
 * position into connected components; per component the boundary edges and
 * the signed volume about its centroid. Returns
 * { triangles, components, largest, outwardShare, normalAgree }.
 */
export function shellGeometry(document, material, { weldDigits = SHELL_RULE.weldDigits, nearClosed = SHELL_RULE.nearClosedBoundaryMax } = {}) {
  const scale = 10 ** weldDigits;
  const points = [];
  const ids = new Map();
  const tris = [];
  let agree = 0;
  let agreeN = 0;
  const el = [];
  const ne = [];
  for (const mesh of document.getRoot().listMeshes()) {
    const node = mesh.listParents().find((p) => p.propertyType === 'Node');
    const flip = node && det3(node.getWorldMatrix()) < 0;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial() !== material) continue;
      const pos = prim.getAttribute('POSITION');
      const nor = prim.getAttribute('NORMAL');
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      // Weld on a 10^-weldDigits grid (Math.round: a −1e-16 and a +1e-16 land on the same key, −0 prints as 0).
      const weld = (i) => {
        pos.getElement(i, el);
        const key = el.map((x) => Math.round(x * scale)).join(',');
        if (!ids.has(key)) {
          ids.set(key, points.length);
          points.push([...el]);
        }
        return ids.get(key);
      };
      for (let t = 0; t + 2 < n; t += 3) {
        const raw = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        const w = raw.map(weld);
        tris.push(flip ? [w[0], w[2], w[1]] : w);
        if (nor) {
          const [a, b, c] = w.map((i) => points[i]);
          const e1 = b.map((v, k) => v - a[k]);
          const e2 = c.map((v, k) => v - a[k]);
          const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          const sum = [0, 0, 0];
          for (const id of raw) {
            nor.getElement(id, ne);
            sum[0] += ne[0];
            sum[1] += ne[1];
            sum[2] += ne[2];
          }
          // A degenerate (zero-area) triangle has no winding to agree with.
          if (fn[0] !== 0 || fn[1] !== 0 || fn[2] !== 0) {
            agreeN += 1;
            if (fn[0] * sum[0] + fn[1] * sum[1] + fn[2] * sum[2] > 0) agree += 1;
          }
        }
      }
    }
  }
  const parent = points.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const v of tris) {
    parent[find(v[1])] = find(v[0]);
    parent[find(v[2])] = find(v[0]);
  }
  const groups = new Map();
  for (const v of tris) {
    const root = find(v[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(v);
  }
  let outwardTris = 0;
  const components = [];
  for (const list of groups.values()) {
    const edges = new Map();
    const centroid = [0, 0, 0];
    for (const v of list) for (const i of v) for (let k = 0; k < 3; k += 1) centroid[k] += points[i][k] / (list.length * 3);
    let volume = 0;
    for (const v of list) {
      for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      const [p, q, r] = v.map((i) => points[i].map((x, k) => x - centroid[k]));
      volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }
    let boundary = 0;
    for (const count of edges.values()) if (count === 1) boundary += 1;
    const closed = boundary <= nearClosed * edges.size;
    if (closed && volume > 0) outwardTris += list.length;
    components.push({ triangles: list.length, boundary, edges: edges.size, volume: Number(volume.toPrecision(4)) });
  }
  components.sort((a, b) => b.triangles - a.triangles);
  return {
    triangles: tris.length,
    components: components.length,
    largest: components.slice(0, 4),
    outwardShare: tris.length ? Math.round((outwardTris / tris.length) * 1000) / 1000 : 0,
    normalAgree: agreeN ? Math.round((agree / agreeN) * 1000) / 1000 : null,
  };
}

/** Whether a measured BLEND + doubleSided material is a genuine translucent shell (rules 1 and 2). */
export function isTranslucentShell(shell, rule = SHELL_RULE) {
  const layer = shell.alpha.invisible || (shell.alpha.p95 < rule.alphaP95Max && shell.alpha.p95 - shell.alpha.p5 <= rule.alphaSpreadMax);
  const closed = shell.geometry.outwardShare >= rule.outwardShareMin && (shell.geometry.normalAgree === null || shell.geometry.normalAgree >= rule.normalAgreeMin);
  return layer && closed;
}

/** Whether every value of a COLOR_0 accessor decodes to exactly 1 (white, opaque). */
function isWhite(accessor) {
  const el = [];
  for (let i = 0; i < accessor.getCount(); i += 1) {
    accessor.getElement(i, el);
    if (el.some((v) => v !== 1)) return false;
  }
  return true;
}

/** Decoded per-material facts: vertex-alpha minimum and the unlit COLOR_0 state (with the white primitives). */
function decodedFacts(document) {
  const materials = document.getRoot().listMaterials();
  const vertexAlpha = new Map();
  const unlitColor = new Map();
  document
    .getRoot()
    .listMeshes()
    .forEach((mesh, m) => {
      mesh.listPrimitives().forEach((prim, p) => {
        const index = materials.indexOf(prim.getMaterial());
        if (index < 0) return;
        const color = prim.getAttribute('COLOR_0');
        if (color && color.getElementSize() >= 4) {
          let min = 1;
          const el = [];
          for (let i = 0; i < color.getCount(); i += 1) min = Math.min(min, color.getElement(i, el)[3]);
          vertexAlpha.set(index, Math.min(vertexAlpha.get(index) ?? 1, min));
        }
        if (!prim.getMaterial().getExtension('KHR_materials_unlit')) return;
        const state = unlitColor.get(index) ?? { colored: false, white: [] };
        if (color) {
          if (isWhite(color)) state.white.push(`${m}/${p}`);
          else state.colored = true;
        }
        unlitColor.set(index, state);
      });
    });
  return { vertexAlpha, unlitColor };
}

/** Classify every material of one GLB (see header). */
export async function classifyGlb(bytes) {
  const json = glbJson(bytes);
  const bin = glbBin(bytes);
  const io = await createWorldIO({ quiet: true });
  const document = await io.readBinary(new Uint8Array(bytes));
  const docMaterials = document.getRoot().listMaterials();
  const { vertexAlpha, unlitColor } = decodedFacts(document);
  const rows = [];
  for (const [index, material] of (json.materials ?? []).entries()) {
    const pbr = material.pbrMetallicRoughness ?? {};
    const metallicOmitted = pbr.metallicFactor === undefined;
    const hasMrTexture = pbr.metallicRoughnessTexture !== undefined;
    const metallic = pbr.metallicFactor ?? 1;
    const blend = material.alphaMode === 'BLEND';
    let textureAlpha = 255;
    if (blend && pbr.baseColorTexture !== undefined) {
      const image = textureImageBytes(json, bin, pbr.baseColorTexture.index);
      textureAlpha = image ? await minImageAlpha(image) : 255;
    }
    const factorAlpha = (pbr.baseColorFactor ?? [1, 1, 1, 1])[3];
    const vAlpha = vertexAlpha.get(index) ?? 1;
    const translucent = factorAlpha < 1 || textureAlpha < 255 || vAlpha < 1;
    const doubleSided = material.doubleSided === true;
    const unlit = Boolean(material.extensions?.KHR_materials_unlit);
    const row = {
      index,
      name: material.name ?? null,
      metallic,
      metallicOmitted,
      hasMrTexture,
      accidentalMetal: metallicOmitted && !hasMrTexture,
      genuineMetal: !metallicOmitted && metallic > 0.5 ? true : metallicOmitted && hasMrTexture,
      alphaMode: material.alphaMode ?? 'OPAQUE',
      doubleSided,
      blend,
      factorAlpha,
      textureAlpha: blend ? textureAlpha : null,
      vertexAlpha: blend ? vAlpha : null,
      opaqueBlend: blend && !translucent,
      blendDoubleSided: blend && doubleSided,
      translucentShell: false,
      transmission: Boolean(material.extensions?.KHR_materials_transmission),
      unlit,
    };
    if (blend && doubleSided && translucent) {
      const shell = { alpha: await surfaceAlpha(document, docMaterials[index]), geometry: shellGeometry(document, docMaterials[index]) };
      row.shell = shell;
      row.translucentShell = isTranslucentShell(shell);
    }
    if (unlit) {
      const state = unlitColor.get(index) ?? { colored: false, white: [] };
      row.unlitColor = state.colored ? 'colored' : state.white.length ? 'white' : 'none';
      row.whiteColorPrims = state.colored ? [] : state.white;
    }
    rows.push(row);
  }
  return rows;
}

/** The lint gate on one classified file: a list of violations. */
export function lintViolations(rows) {
  const out = [];
  for (const r of rows) {
    if (r.blend && r.opaqueBlend) out.push(`material ${r.index}${r.name ? ` (${r.name})` : ''}: BLEND without any alpha < 1`);
    if (r.transmission) out.push(`material ${r.index}${r.name ? ` (${r.name})` : ''}: KHR_materials_transmission`);
  }
  return out;
}

/**
 * Apply the chosen fixes to a GLB's JSON chunk; returns { bytes, changes }
 * (bytes === input when nothing changed). `except`: material indices left alone.
 */
export function applyFixes(bytes, rows, fixes, { except = new Set() } = {}) {
  const json = glbJson(bytes);
  const changes = [];
  for (const r of rows) {
    if (except.has(r.index)) continue;
    const material = json.materials[r.index];
    if (fixes.includes('metal') && r.accidentalMetal) {
      material.pbrMetallicRoughness = { ...(material.pbrMetallicRoughness ?? {}), metallicFactor: 0 };
      changes.push({ index: r.index, fix: 'metal', from: 'omitted (1.0)', to: 0 });
    }
    if (fixes.includes('blend-opaque') && r.opaqueBlend) {
      delete material.alphaMode;
      delete material.alphaCutoff;
      changes.push({ index: r.index, fix: 'blend-opaque', from: 'BLEND', to: 'OPAQUE' });
    }
    if (fixes.includes('transmission') && r.transmission) {
      delete material.extensions.KHR_materials_transmission;
      if (!Object.keys(material.extensions).length) delete material.extensions;
      changes.push({ index: r.index, fix: 'transmission', from: 'KHR_materials_transmission', to: null });
    }
    if (fixes.includes('single-sided') && r.translucentShell && material.doubleSided === true) {
      delete material.doubleSided;
      changes.push({ index: r.index, fix: 'single-sided', from: true, to: false });
    }
    if (fixes.includes('unlit-color') && r.unlit && r.unlitColor === 'white') {
      const prims = [];
      for (const at of r.whiteColorPrims) {
        const [m, p] = at.split('/').map(Number);
        const attributes = json.meshes[m].primitives[p].attributes;
        if (attributes.COLOR_0 === undefined) continue;
        delete attributes.COLOR_0;
        prims.push(at);
      }
      if (prims.length) changes.push({ index: r.index, fix: 'unlit-color', from: 'COLOR_0 (all 1.0)', to: null, prims });
    }
  }
  if (!changes.length) return { bytes: Buffer.from(bytes), changes };
  if (fixes.includes('transmission')) {
    const used = (json.materials ?? []).some((m) => m.extensions?.KHR_materials_transmission);
    if (!used) {
      json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => e !== 'KHR_materials_transmission');
      if (json.extensionsRequired) json.extensionsRequired = json.extensionsRequired.filter((e) => e !== 'KHR_materials_transmission');
    }
  }
  return { bytes: rewriteGlbJson(bytes, json), changes };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Copy every file of an arm mirror (its own `_encode.json` excepted) into `out`. Returns the count. */
function copyMirror(src, out) {
  let count = 0;
  for (const file of walkFiles(src)) {
    const rel = relPosix(src, file);
    if (rel === '_encode.json') continue;
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
    count += 1;
  }
  return count;
}

/**
 * Dry run / apply over a mirror (models/ + props/). `except`: `file#index`
 * entries left alone; each must name a material of `src`. `exceptReasons`:
 * `{ 'file#index': reason }`, exactly one per `except` entry, recorded in
 * `_encode.json`. `mirror` (with apply): the whole arm into `out` plus
 * `<out>/_encode.json` (see header).
 */
export async function lintMirror({ src, apply = false, fixes = [], out = null, except = [], exceptReasons = null, mirror = false }) {
  if (apply && (!out || resolve(out) === resolve(src))) throw new Error('--apply needs an --out directory that differs from --src');
  if (mirror && !apply) throw new Error('--mirror needs --apply');
  if (mirror && resolve(out).startsWith(`${resolve(src)}${sep}`)) throw new Error('--mirror needs an --out outside --src (the copy would include itself)');
  const files = encodableFiles(src);
  const exceptSet = new Set(except);
  const unmatched = [...exceptSet].filter((key) => {
    const hash = key.lastIndexOf('#');
    const rel = key.slice(0, hash);
    const index = Number(key.slice(hash + 1));
    if (hash < 0 || !files.includes(rel) || !Number.isInteger(index) || index < 0) return true;
    return index >= (glbJson(readFileSync(join(src, rel)))?.materials?.length ?? 0);
  });
  if (unmatched.length) throw new Error(`--except names no material of ${src}: ${unmatched.join(', ')}`);
  if (exceptReasons) {
    const keys = Object.keys(exceptReasons).sort();
    const want = [...exceptSet].sort();
    const blank = keys.filter((key) => typeof exceptReasons[key] !== 'string' || !exceptReasons[key].trim());
    if (JSON.stringify(keys) !== JSON.stringify(want) || blank.length) {
      throw new Error(`--except-reasons needs one non-empty reason per --except entry (entries ${want.join(', ') || 'none'}; reasons ${keys.join(', ') || 'none'})`);
    }
  }
  const copied = mirror ? copyMirror(src, out) : 0;
  const sourceEncodeFile = join(src, '_encode.json');
  const sourceEncode = mirror && existsSync(sourceEncodeFile) ? JSON.parse(readFileSync(sourceEncodeFile, 'utf8')) : null;
  const sourceRows = new Map((sourceEncode?.files ?? []).map((row) => [row.file, row]));
  const report = [];
  const encodeRows = [];
  const measured = [];
  for (const rel of files) {
    const bytes = readFileSync(join(src, rel));
    const rows = await classifyGlb(bytes);
    const entry = { file: rel, materials: rows, violations: lintViolations(rows) };
    const skipped = new Set(rows.filter((r) => exceptSet.has(`${rel}#${r.index}`)).map((r) => r.index));
    if (skipped.size) entry.except = [...skipped];
    for (const r of rows.filter((row) => row.shell)) {
      const { alpha, geometry } = r.shell;
      measured.push({
        material: `${rel}#${r.index}`,
        name: r.name,
        translucentShell: r.translucentShell,
        except: skipped.has(r.index),
        alpha,
        outwardShare: geometry.outwardShare,
        normalAgree: geometry.normalAgree,
        components: geometry.components,
      });
    }
    if (apply) {
      const { bytes: fixed, changes } = applyFixes(bytes, rows, fixes, { except: skipped });
      entry.changes = changes;
      if (changes.length) {
        mkdirSync(dirname(join(out, rel)), { recursive: true });
        writeFileSync(join(out, rel), fixed);
      }
      if (mirror) {
        encodeRows.push({
          file: rel,
          recipe: sourceRows.get(rel)?.recipe ?? sourceEncode?.stamp?.recipe ?? null,
          srcSha256: sha256(bytes),
          srcBytes: bytes.length,
          sha256: sha256(fixed),
          bytes: fixed.length,
          changes,
        });
      }
    }
    report.push(entry);
  }
  const all = report.flatMap((f) => f.materials.map((m) => ({ file: f.file, ...m })));
  const list = (pred) => all.filter(pred).map((m) => `${m.file}#${m.index}${m.name ? ` ${m.name}` : ''}`);
  const summary = {
    files: report.length,
    materials: all.length,
    metals: all.filter((m) => m.metallic > 0.5 || (m.metallicOmitted && m.hasMrTexture)).length,
    metallicOmitted: all.filter((m) => m.metallicOmitted).length,
    accidentalMetals: list((m) => m.accidentalMetal),
    accidentalMetalFiles: new Set(all.filter((m) => m.accidentalMetal).map((m) => m.file)).size,
    genuineMetals: list((m) => m.genuineMetal),
    blend: all.filter((m) => m.blend).length,
    blendFiles: new Set(all.filter((m) => m.blend).map((m) => m.file)).size,
    opaqueBlend: list((m) => m.opaqueBlend),
    blendDoubleSided: list((m) => m.blendDoubleSided),
    blendDoubleSidedFiles: new Set(all.filter((m) => m.blendDoubleSided).map((m) => m.file)).size,
    translucentShells: list((m) => m.translucentShell),
    transmission: list((m) => m.transmission),
    unlit: list((m) => m.unlit),
    unlitWhiteColor: list((m) => m.unlitColor === 'white'),
    unlitColored: list((m) => m.unlitColor === 'colored'),
    except: [...exceptSet].sort(),
    violations: report.filter((f) => f.violations.length).length,
  };
  if (mirror) {
    const byFix = {};
    for (const row of encodeRows) {
      for (const change of row.changes) {
        byFix[change.fix] ??= { materials: 0, files: new Set() };
        byFix[change.fix].materials += 1;
        byFix[change.fix].files.add(row.file);
      }
    }
    const encode = {
      tool: 'material-lint',
      stamp: { ...(sourceEncode?.stamp ?? {}), materialFixes: [...fixes], shellRule: SHELL_RULE },
      source: {
        dir: resolve(src).split('\\').join('/'),
        encodeSha256: existsSync(sourceEncodeFile) ? sha256(readFileSync(sourceEncodeFile)) : null,
        recipe: sourceEncode?.stamp?.recipe ?? null,
        copiedFiles: copied,
      },
      fixes: [...fixes],
      except: [...exceptSet].sort(),
      ...(exceptReasons ? { exceptReasons: Object.fromEntries(Object.keys(exceptReasons).sort().map((key) => [key, exceptReasons[key]])) } : {}),
      totals: {
        files: encodeRows.length,
        changedFiles: encodeRows.filter((row) => row.changes.length).length,
        srcBytes: encodeRows.reduce((s, row) => s + row.srcBytes, 0),
        bytes: encodeRows.reduce((s, row) => s + row.bytes, 0),
      },
      byFix: Object.fromEntries(Object.entries(byFix).map(([fix, v]) => [fix, { materials: v.materials, files: v.files.size }])),
      // The doubleSided call (SHELL_RULE): every measured BLEND + doubleSided translucent material with its
      // evidence; `insideFiles` = the files with a flip (gallery `--inside-files`, plan M1).
      doubleSided: {
        flipped: encodeRows.flatMap((row) => row.changes.filter((c) => c.fix === 'single-sided').map((c) => `${row.file}#${c.index}`)),
        insideFiles: encodeRows.filter((row) => row.changes.some((c) => c.fix === 'single-sided')).map((row) => row.file),
        measured,
      },
      files: encodeRows,
    };
    writeFileSync(join(out, '_encode.json'), JSON.stringify(encode, null, 1));
    summary.encode = { changedFiles: encode.totals.changedFiles, byFix: encode.byFix };
  }
  return { summary, files: report };
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function listArg(argv, name) {
  const value = arg(argv, name);
  if (!value) return [];
  if (value.startsWith('@')) return readFileSync(value.slice(1), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const check = arg(argv, '--check');
  const src = check ?? arg(argv, '--src');
  if (!src) {
    console.error(
      'usage: material-lint.mjs --src <mirror> [--report <json>] | --apply --fix metal[,...] --out <dir> [--mirror] [--except f#i,... [--except-reasons <json>]] | --check <mirror>',
    );
    process.exit(2);
  }
  const fixes = listArg(argv, '--fix');
  for (const fix of fixes) if (!FIXES.includes(fix)) throw new Error(`unknown fix ${fix} (${FIXES.join(', ')})`);
  const reasonsFile = arg(argv, '--except-reasons');
  lintMirror({
    src,
    apply: argv.includes('--apply'),
    fixes,
    out: arg(argv, '--out'),
    except: listArg(argv, '--except'),
    exceptReasons: reasonsFile ? JSON.parse(readFileSync(reasonsFile, 'utf8')) : null,
    mirror: argv.includes('--mirror'),
  })
    .then((result) => {
      const reportFile = arg(argv, '--report');
      if (reportFile) writeFileSync(reportFile, JSON.stringify(result, null, 1));
      const s = result.summary;
      console.log(
        `material-lint ${argv.includes('--apply') ? `APPLY ${fixes.join(',')}` : check ? 'CHECK' : 'dry run'}: ${s.files} files, ${s.materials} materials; ` +
          `metals ${s.metals} (metallicFactor omitted ${s.metallicOmitted}); accidental metals ${s.accidentalMetals.length} in ${s.accidentalMetalFiles} files; ` +
          `BLEND ${s.blend} in ${s.blendFiles} files (opaque-by-mistake ${s.opaqueBlend.length}, double-sided ${s.blendDoubleSided.length} in ${s.blendDoubleSidedFiles} files, translucent shells ${s.translucentShells.length}); ` +
          `transmission ${s.transmission.length}; unlit ${s.unlit.length} (white COLOR_0 ${s.unlitWhiteColor.length}, coloured ${s.unlitColored.length}); files violating the lint ${s.violations}` +
          (s.encode ? `; arm: ${s.encode.changedFiles} files changed ${JSON.stringify(s.encode.byFix)}` : ''),
      );
      if (check && s.violations) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
