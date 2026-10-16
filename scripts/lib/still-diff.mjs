#!/usr/bin/env node
/**
 * LOOK r2 SEAT H — offline per-pixel diff of two stills of the same pose
 * (the blast-radius check), without a browser or a server:
 *
 *   node scripts/lib/still-diff.mjs <a.png> <b.png> [--threshold 8] [--json <out.json>]
 *   node scripts/lib/still-diff.mjs --tags <tagA> <tagB> [--dir gauntlet/evidence]   (LOOK r3: every shared suffix)
 *   node scripts/lib/still-diff.mjs --tags <tag> <tag-b> --gate [--max-luma-rel 0.03]   (LOOK r4: canonical BEFORE pair gate, exit 1 on any reject)
 *   node scripts/lib/still-diff.mjs --against <afterTag> <candA,candB>   (LOOK r4: ranked candidate choice, pose then world luma)
 *
 * Prints the whole-frame diff (HUD band excluded when a sidecar beside
 * <a.png> carries hud.top), each data face (--luma rects from either
 * sidecar) and the pose match of the two sidecars. The same numbers
 * capture-route records per still with --diff-against <tag>.
 * Exit 0 = measured, 1 = --gate rejected a pair, 2 = usage / unreadable input.
 */
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIFF_THRESHOLD, diffStillFiles, faceRegionsOf, figureMaskOf, poseMatch, readStillSidecar } from './look-evidence.mjs';
import { baselineSuspicion, parseDiffTags, pickDiffCandidate, sceneLightingMatch, WORLD_LUMA_DIVERGENCE_REL, worldLumaConsistency } from './look-r3-evidence.mjs';
// LOOK r6 (H3): the D27 canonical baseline per world, the IBL flags and the Station Card mask.
import { baselineIblFlags, canonicalBaselinesFor, stationCardMaskOf } from './look-r6-evidence.mjs';

/** LOOK r4: two back-to-back BEFORE shots of one pose must agree in world luma within this share (a canonical pair). */
export const PAIR_LUMA_MAX_REL = 0.03;

export async function stillDiff(aPath, bPath, { threshold = DIFF_THRESHOLD, maxLumaRel = WORLD_LUMA_DIVERGENCE_REL } = {}) {
  const sideA = await readStillSidecar(aPath.replace(/\.png$/i, '.json'));
  const sideB = await readStillSidecar(bPath.replace(/\.png$/i, '.json'));
  const hudTop = typeof sideA?.hud?.top === 'number' ? sideA.hud.top : typeof sideB?.hud?.top === 'number' ? sideB.hud.top : null;
  // LOOK r6 (H3): the DOM Station Card of either still is chrome, like the HUD band.
  const cardRects = [...stationCardMaskOf(sideA), ...stationCardMaskOf(sideB)];
  const exclude = [...(hudTop === null ? [] : [{ x: 0, y: hudTop, w: 1e6, h: 1e6 }]), ...cardRects];
  const regions = faceRegionsOf(sideA).length ? faceRegionsOf(sideA) : faceRegionsOf(sideB);
  const maskRects = [...figureMaskOf(sideA), ...figureMaskOf(sideB)];
  const diff = await diffStillFiles(aPath, bPath, { threshold, exclude, regions, maskRects });
  return {
    a: aPath,
    b: bPath,
    frame: diff.frame,
    ...(diff.frameMasked ? { frameMasked: diff.frameMasked } : {}),
    faces: diff.regions,
    hudExcludedFrom: hudTop,
    cardExcluded: cardRects,
    pose: sideA && sideB ? poseMatch(sideA, sideB) : { match: null, reason: 'a sidecar is missing' },
    // LOOK r3: lighting state + world luma of the two stills; a pair whose
    // lighting differs (e.g. a black-IBL load) is neither a render change nor noise.
    lighting: sceneLightingMatch(sideA?.sceneLighting, sideB?.sceneLighting),
    worldLuma: worldLumaConsistency(sideA?.worldLuma, sideB?.worldLuma, { maxRel: maxLumaRel }),
    ibl: { a: sideA?.iblState ?? null, b: sideB?.iblState ?? null },
  };
}

/**
 * LOOK r3: diff every still of tag A against the same-suffix still of tag B
 * in `dir` (a whole before/after set, or before vs before-retry for the pose
 * audit). Returns one row per suffix present in both.
 */
export async function tagPairDiff(dir, tagA, tagB, { threshold = DIFF_THRESHOLD, maxLumaRel = WORLD_LUMA_DIVERGENCE_REL } = {}) {
  const names = await readdir(dir);
  const prefixA = `${tagA}-`;
  const rows = [];
  for (const name of names.sort()) {
    if (!name.startsWith(prefixA) || !name.endsWith('.png')) continue;
    const suffix = name.slice(prefixA.length, -'.png'.length);
    // A longer tag sharing the prefix (tagA-retry-...) is not tagA's still.
    if (tagB.startsWith(prefixA) && name.startsWith(`${tagB}-`)) continue;
    const other = `${tagB}-${suffix}.png`;
    if (!names.includes(other)) continue;
    const r = await stillDiff(resolve(dir, name), resolve(dir, other), { threshold, maxLumaRel });
    const baseline = baselineSuspicion({ pose: r.pose, lighting: r.lighting, luma: r.worldLuma });
    // LOOK r4: a still the capture itself flagged black-IBL is never canonical.
    for (const [side, st] of [['a', r.ibl.a], ['b', r.ibl.b]]) {
      if (st && st.verdict === 'black') {
        baseline.suspect = true;
        baseline.reasons.push(`still ${side} was captured with a black IBL (${st.reason ?? 'iblState black'})`);
      }
    }
    rows.push({ suffix, a: name, b: other, pose: r.pose, lighting: r.lighting, worldLuma: r.worldLuma, baseline, frame: r.frame, ...(r.frameMasked ? { frameMasked: r.frameMasked } : {}), faces: r.faces });
  }
  return rows;
}

/**
 * LOOK r4: re-diff a whole AFTER set offline against ranked BEFORE candidates
 * (the capture-route --diff-against choice: pose first, then world-luma
 * agreement within 20% with the after). One row per after still: the chosen
 * candidate, why, the ranking and the diff.
 */
export async function tagAgainstDiff(dir, afterTag, candidateTags, { threshold = DIFF_THRESHOLD } = {}) {
  const names = await readdir(dir);
  const prefix = `${afterTag}-`;
  const rows = [];
  for (const name of names.sort()) {
    if (!name.startsWith(prefix) || !name.endsWith('.png')) continue;
    const suffix = name.slice(prefix.length, -'.png'.length);
    // A longer tag sharing the prefix (afterTag-retry-...) is not this set's still.
    if (candidateTags.some((t) => t.startsWith(prefix) && name.startsWith(`${t}-`))) continue;
    const after = await readStillSidecar(resolve(dir, `${afterTag}-${suffix}.json`));
    const candidates = [];
    for (const t of candidateTags) {
      const file = `${t}-${suffix}.png`;
      const exists = names.includes(file);
      const sidecar = exists ? await readStillSidecar(resolve(dir, `${t}-${suffix}.json`)) : null;
      candidates.push({ tag: t, file, exists, sidecar, pose: !exists ? null : after && sidecar ? poseMatch(after, sidecar) : { match: null, reason: 'a sidecar is missing' } });
    }
    // LOOK r6 (H3, D27): the canonical baseline of the after's world ranks first in its pose rank.
    const world = after?.stationContent?.world ?? after?.invocation?.args?.world ?? null;
    const choice = pickDiffCandidate(candidates, { referenceLuma: after?.worldLuma ?? null, prefer: canonicalBaselinesFor(world) });
    if (!choice.pick) {
      rows.push({ suffix, after: name, chosen: null, why: choice.why });
      continue;
    }
    const r = await stillDiff(resolve(dir, name), resolve(dir, choice.pick.file), { threshold });
    rows.push({ suffix, after: name, chosen: choice.pick.file, why: choice.why, ranking: choice.ranking, poseValid: choice.poseValid, lumaDivergentBaseline: choice.lumaDivergent, baselineFlags: baselineIblFlags(choice.pick.sidecar), canonical: choice.canonical, worldLuma: r.worldLuma, frame: r.frame, ...(r.frameMasked ? { frameMasked: r.frameMasked } : {}), faces: r.faces });
  }
  return rows;
}

const fmtFaces = (faces) => faces.map((x) => `${x.id}:>${x.threshold}=${x.overThresholdPct}%/mean${x.mean}${x.inner ? `[inner >8=${x.inner.overThresholdPct}% mean${x.inner.mean} L${x.inner.lumaB}->${x.inner.lumaA}]` : ''}`).join(',');

async function main(argv) {
  const positional = [];
  let threshold = DIFF_THRESHOLD;
  let jsonOut = null;
  let tagsMode = false;
  let againstMode = false;
  let gate = false;
  let maxLumaRel = null;
  let dir = resolve('gauntlet', 'evidence');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--threshold') threshold = Number(argv[++i]);
    else if (argv[i] === '--json') jsonOut = argv[++i];
    else if (argv[i] === '--tags') tagsMode = true;
    else if (argv[i] === '--against') againstMode = true;
    else if (argv[i] === '--gate') gate = true;
    else if (argv[i] === '--max-luma-rel') maxLumaRel = Number(argv[++i]);
    else if (argv[i] === '--dir') dir = resolve(argv[++i]);
    else positional.push(argv[i]);
  }
  if (againstMode) {
    if (positional.length !== 2 || !Number.isFinite(threshold) || threshold < 0) {
      console.error('usage: node scripts/lib/still-diff.mjs --against <afterTag> <candTag1,candTag2,...> [--dir gauntlet/evidence] [--json <out.json>]');
      return 2;
    }
    let rows;
    try {
      rows = await tagAgainstDiff(dir, positional[0], parseDiffTags(positional[1]), { threshold });
    } catch (err) {
      console.error(`still-diff: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    for (const r of rows) {
      if (!r.chosen) {
        console.log(`still-diff: ${r.suffix} no candidate (${r.why})`);
        continue;
      }
      const f = r.frame;
      console.log(
        `still-diff: ${r.suffix} vs ${r.chosen} ${f.comparable === false ? `incomparable (${f.reason})` : `changed=${f.changedPct}% >${f.threshold}=${f.overThresholdPct}% mean=${f.mean}${r.frameMasked ? ` exFigures>8=${r.frameMasked.overThresholdPct}%/mean${r.frameMasked.mean}` : ''}`}${r.lumaDivergentBaseline ? ' BASELINE-LUMA-DIVERGENT' : ''}${r.baselineFlags?.length ? ` ${r.baselineFlags.join(' ')}` : ''}${r.faces.length ? ` faces=${fmtFaces(r.faces)}` : ''}`,
      );
      console.log(`  chose ${r.why}`);
    }
    if (jsonOut) await writeFile(resolve(jsonOut), `${JSON.stringify({ dir, after: positional[0], candidates: parseDiffTags(positional[1]), threshold, rows }, null, 2)}\n`, 'utf8');
    return 0;
  }
  if (tagsMode) {
    if (positional.length !== 2 || !Number.isFinite(threshold) || threshold < 0) {
      console.error('usage: node scripts/lib/still-diff.mjs --tags <tagA> <tagB> [--dir gauntlet/evidence] [--threshold 8] [--json <out.json>]');
      return 2;
    }
    let rows;
    try {
      rows = await tagPairDiff(dir, positional[0], positional[1], { threshold, maxLumaRel: maxLumaRel ?? (gate ? PAIR_LUMA_MAX_REL : WORLD_LUMA_DIVERGENCE_REL) });
    } catch (err) {
      console.error(`still-diff: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    for (const r of rows) {
      const f = r.frame;
      const p = r.pose;
      console.log(
        `still-diff: ${r.suffix} pose=${p.match}${p.match === false ? ` (${p.reasons.join('; ')})` : ''} ${f.comparable === false ? `incomparable (${f.reason})` : `changed=${f.changedPct}% >${f.threshold}=${f.overThresholdPct}% mean=${f.mean} max=${f.max}`}${r.baseline.suspect ? ` SUSPECT[${r.baseline.reasons.join('; ')}]` : ''}${r.faces.length ? ` faces=${fmtFaces(r.faces)}` : ''}`,
      );
    }
    const mismatched = rows.filter((r) => r.pose.match !== true).length;
    const suspect = rows.filter((r) => r.baseline.suspect).length;
    console.log(`still-diff: ${rows.length} pair(s), ${rows.length - mismatched} pose-matched, ${mismatched} not; ${suspect} suspect (pose / lighting / world luma)`);
    if (jsonOut) await writeFile(resolve(jsonOut), `${JSON.stringify({ dir, tagA: positional[0], tagB: positional[1], threshold, gate, rows }, null, 2)}\n`, 'utf8');
    // LOOK r4 --gate: a canonical BEFORE pair (two back-to-back shots per
    // pose) has every row pose-matched, lighting-consistent and within the
    // pair luma bound (default 3%), and no black-IBL still. Exit 1 otherwise.
    if (gate) {
      const bad = rows.filter((r) => r.baseline.suspect || r.pose.match !== true);
      console.log(`still-diff: GATE ${bad.length === 0 && rows.length > 0 ? 'PASS' : 'FAIL'} (${rows.length} pair(s), ${bad.length} rejected${rows.length === 0 ? ', no pairs found' : ''}; luma bound rel ${maxLumaRel ?? PAIR_LUMA_MAX_REL})`);
      for (const r of bad) console.log(`still-diff: GATE reject ${r.suffix}: ${r.baseline.reasons.join('; ') || 'pose not matched'}`);
      return bad.length === 0 && rows.length > 0 ? 0 : 1;
    }
    return 0;
  }
  if (positional.length !== 2 || !Number.isFinite(threshold) || threshold < 0) {
    console.error('usage: node scripts/lib/still-diff.mjs <a.png> <b.png> [--threshold 8] [--json <out.json>]');
    return 2;
  }
  let record;
  try {
    record = await stillDiff(resolve(positional[0]), resolve(positional[1]), { threshold });
  } catch (err) {
    console.error(`still-diff: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const f = record.frame;
  console.log(
    f.comparable === false
      ? `still-diff: incomparable (${f.reason})`
      : `still-diff: changed=${f.changedPct}% >${f.threshold}=${f.overThresholdPct}% mean=${f.mean} max=${f.max} pixels=${f.pixels}${record.hudExcludedFrom !== null ? ` (hud band from y=${record.hudExcludedFrom} excluded)` : ''}`,
  );
  for (const face of record.faces) console.log(`still-diff: face ${face.id} changed=${face.changedPct}% >${face.threshold}=${face.overThresholdPct}% mean=${face.mean} max=${face.max}`);
  if (record.worldLuma.verdict !== 'unmeasured') console.log(`still-diff: world luma ${record.worldLuma.verdict} (${record.worldLuma.a} vs ${record.worldLuma.b}, rel ${record.worldLuma.rel})`);
  if (record.lighting.match === false) console.log(`still-diff: LIGHTING differs: ${record.lighting.differences.join('; ')}`);
  console.log(`still-diff: pose match=${record.pose.match}${record.pose.reasons?.length ? ` (${record.pose.reasons.join('; ')})` : record.pose.reason ? ` (${record.pose.reason})` : ''}`);
  if (jsonOut) await writeFile(resolve(jsonOut), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
