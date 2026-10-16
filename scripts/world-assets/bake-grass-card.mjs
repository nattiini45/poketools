/**
 * The sakura painted grass-clump card (ROLLOUT-PLAN §1.1 ground: the cone
 * "spikes" become painted clump cards; §3.3 item 3, §5) → 256² RGBA WebP at
 * `public/models/world/env/sakura/grass-card.webp` (`SAKURA_GRASS_CARD_FILE`).
 *
 * A fan of tapered, gently curved blades rooted at the bottom centre (v 0),
 * painted in three flat value bands (cool dark base → fresh mid → warm lit
 * tip) — the painterly register, no photo texture. Alpha is the blade
 * coverage (4× supersampled, anti-aliased). The material tints it per
 * palette; RGB is near-neutral green so the day / night ramp stays in-shader.
 * Deterministic: blades come from integer hashes, the raster is pure maths,
 * and the WebP encode is byte-stable (hash test).
 *
 * AD-SAKURA owns `PARAMS` from B5; `lib.mjs` stays frozen.
 *
 * Usage: node scripts/world-assets/bake-grass-card.mjs [--out]
 *        (Windows: PowerShell or MSYS_NO_PATHCONV=1)
 */

import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { clamp01, hash3, sha256Hex, smoothstep } from './lib.mjs';

// ── Parameter block (AD-SAKURA) ─────────────────────────────────────────────

export const PARAMS = {
  size: 256,
  blades: 26,
  seed: 5,
  /** Blade length range (share of the card height), base half-width (px), lean range (share of length). */
  length: [0.45, 0.95],
  halfWidth: [4.5, 7.5],
  lean: 0.55,
  /** Value bands along the blade: base, mid, tip (sRGB). */
  bands: ['#3d5a3a', '#5f8446', '#9ab964'],
  /** Band edges (share of blade length) and their softness. */
  edges: [0.34, 0.7],
  soft: 0.06,
  samples: 4,
  quality: 90,
};

function hex(color) {
  const v = Number.parseInt(color.slice(1), 16);
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Blade descriptors, deepest first (drawn back to front). */
function blades() {
  const p = PARAMS;
  const out = [];
  for (let i = 0; i < p.blades; i += 1) {
    const r = (k) => hash3(i, k, p.seed);
    const len = p.length[0] + (p.length[1] - p.length[0]) * r(0);
    const lean = (r(1) * 2 - 1) * p.lean;
    out.push({
      rootX: 0.5 + (r(2) - 0.5) * 0.22,
      len,
      lean,
      curl: (r(3) - 0.5) * 0.4 + lean * 0.5,
      half: p.halfWidth[0] + (p.halfWidth[1] - p.halfWidth[0]) * r(4),
      shade: 0.82 + 0.18 * r(5),
      depth: r(6),
    });
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/** Blade centre line at t ∈ [0, 1] in card units (x right, y up). */
function bladePoint(b, t) {
  return [b.rootX + (b.lean * t + b.curl * t * t) * b.len * 0.5, b.len * t];
}

export function buildGrassCard() {
  const { size: S, samples } = PARAMS;
  const cols = PARAMS.bands.map(hex);
  const list = blades();
  const data = new Uint8Array(S * S * 4);
  const steps = 48;
  for (let py = 0; py < S; py += 1) {
    for (let px = 0; px < S; px += 1) {
      let cov = 0;
      const rgb = [0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / S;
          const y = 1 - (py + (sy + 0.5) / samples) / S;
          // Front-most blade that covers this sample wins.
          let hit = null;
          for (let k = list.length - 1; k >= 0 && !hit; k -= 1) {
            const b = list[k];
            if (y > b.len + 0.01) continue;
            for (let s = 0; s < steps; s += 1) {
              const t0 = s / steps;
              const t1 = (s + 1) / steps;
              const [ax, ay] = bladePoint(b, t0);
              const [bx, by] = bladePoint(b, t1);
              if (y < Math.min(ay, by) || y > Math.max(ay, by)) continue;
              const f = (y - ay) / (by - ay || 1e-9);
              const t = t0 + (t1 - t0) * f;
              const cx = ax + (bx - ax) * f;
              const half = (b.half / S) * (1 - t) ** 0.8;
              if (Math.abs(x - cx) <= half) hit = { b, t };
              break;
            }
          }
          if (!hit) continue;
          cov += 1;
          const { b, t } = hit;
          const e0 = smoothstep(PARAMS.edges[0] - PARAMS.soft, PARAMS.edges[0] + PARAMS.soft, t);
          const e1 = smoothstep(PARAMS.edges[1] - PARAMS.soft, PARAMS.edges[1] + PARAMS.soft, t);
          for (let c = 0; c < 3; c += 1) {
            const v = cols[0][c] * (1 - e0) + cols[1][c] * (e0 - e1) + cols[2][c] * e1;
            rgb[c] += v * b.shade;
          }
        }
      }
      const i = (py * S + px) * 4;
      const n = samples * samples;
      if (cov > 0) for (let c = 0; c < 3; c += 1) data[i + c] = Math.round(clamp01(rgb[c] / cov) * 255);
      data[i + 3] = Math.round((cov / n) * 255);
    }
  }
  return { width: S, height: S, data };
}

export async function encodeGrassCard(raster) {
  return sharp(Buffer.from(raster.data), { raw: { width: raster.width, height: raster.height, channels: 4 } })
    .webp({ quality: PARAMS.quality, alphaQuality: 100, effort: 6, exact: true })
    .toBuffer();
}

async function main() {
  const { MIRROR_DIR, OUT_ENV_DIR, ensureDir, log } = await import('./lib.mjs');
  const envDir = process.argv.includes('--out') ? OUT_ENV_DIR : join(MIRROR_DIR, 'env');
  const dir = join(envDir, 'sakura');
  ensureDir(dir);
  const raster = buildGrassCard();
  const bytes = await encodeGrassCard(raster);
  const file = join(dir, 'grass-card.webp');
  writeFileSync(file, bytes);
  log(`sakura grass card ${raster.width}² → ${file} ${Math.round(statSync(file).size / 1024)} KB; raw sha256 ${sha256Hex(raster.data).slice(0, 16)}, file sha256 ${sha256Hex(bytes).slice(0, 16)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
