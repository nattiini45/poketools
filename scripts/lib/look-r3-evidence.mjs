/**
 * LOOK pilot round 3, SEAT H — evidence helpers for the capture harness
 * (scripts/capture-route.mjs). Pure functions; no browser, no server.
 *
 *  - the WHOLE-ceremony compositor cadence (CAR judge: the r2 window started
 *    at scenePhase=presented, so the 767–1134 ms loading-phase freezes with
 *    the ball on screen were never judged): from the first ball-visible
 *    frame to done / aborted, per phase, warn > 100 ms, fail > 250 ms;
 *  - the scene-generation account (CAR judge: "g4 on 3 of 12 runs, no
 *    sidecar explains why");
 *  - the --diff-against candidate pick (the first pose-matched candidate of
 *    a comma list, so a -retry baseline wins over an unmatched one) and the
 *    noise-floor comparison (--diff-floor: before vs before at one pose).
 */

// ---------------------------------------------------------------------------
// Whole-ceremony cadence
// ---------------------------------------------------------------------------

/** W7 bar over the whole ceremony: a gap above this fails. */
export const CEREMONY_GAP_FAIL_MS = 250;
/** A gap above this is a warning (the r2 in-window compositor limit). */
export const CEREMONY_GAP_WARN_MS = 100;
/** Ball phases that belong to the ceremony. */
export const CEREMONY_BALL_PHASES = ['loading', 'opening', 'releasing'];
const END_PHASES = ['done', 'aborted'];

/**
 * The ceremony phase a film row sat in: loading splits at the scene's
 * presented milestone (loading-before-presented = the renderer / first
 * commit / decode window the r2 verdict skipped). Null outside the ceremony.
 */
export function wholeCeremonyPhaseOf(row) {
  if (!row || !CEREMONY_BALL_PHASES.includes(row.ballPhase)) return null;
  if (row.ballPhase === 'loading') return row.scenePhase === 'presented' ? 'loading-after-presented' : 'loading-before-presented';
  return row.ballPhase;
}

/**
 * The ceremony window: start = the first ball-VISIBLE moment (the same
 * navigation's loader-trace sample when there is one — it reads painted
 * opacity — else the first film phase sample with a mounted ball in a
 * ceremony phase), end = the first done / aborted sample (else the last
 * ceremony sample). `samples` = film phase samples { t, ballPresent,
 * ballPhase }, `traceSamples` = loader-trace merged samples { t, ballVisible }.
 */
export function ceremonyWindowOf({ samples = [], traceSamples = null } = {}) {
  const list = Array.isArray(samples) ? samples : [];
  const traced = Array.isArray(traceSamples) ? traceSamples.find((s) => s && s.ballVisible === true && typeof s.t === 'number') : null;
  const filmStart = list.find((s) => s && s.ballPresent !== false && CEREMONY_BALL_PHASES.includes(s.ballPhase) && typeof s.t === 'number') ?? null;
  const start = traced ? traced.t : filmStart ? filmStart.t : null;
  const startSource = traced ? 'trace-ballVisible' : filmStart ? 'film-ballPhase' : null;
  if (start === null) return null;
  const endRow = list.find((s) => s && typeof s.t === 'number' && s.t >= start && END_PHASES.includes(s.ballPhase)) ?? null;
  const lastCeremony = [...list].reverse().find((s) => s && typeof s.t === 'number' && CEREMONY_BALL_PHASES.includes(s.ballPhase)) ?? null;
  const end = endRow ? endRow.t : lastCeremony ? lastCeremony.t : null;
  if (end === null || end <= start) return null;
  return { start, end, startSource, endSource: endRow ? `ball-${endRow.ballPhase}` : 'last-ceremony-sample', ms: +(end - start).toFixed(1) };
}

function gapStats(rows, { warnMs, failMs }) {
  if (rows.length === 0) return { intervals: 0, medianMs: null, maxGapMs: null, maxGapAt: null, overWarn: 0, overFail: 0 };
  const sorted = [...rows].sort((a, b) => a.gap - b.gap);
  const worst = sorted[sorted.length - 1];
  return {
    intervals: rows.length,
    medianMs: +sorted[Math.floor(sorted.length / 2)].gap.toFixed(1),
    maxGapMs: +worst.gap.toFixed(1),
    maxGapAt: +worst.at.toFixed(1),
    overWarn: rows.filter((r) => r.gap > warnMs).length,
    overFail: rows.filter((r) => r.gap > failMs).length,
  };
}

/**
 * Frame gaps of one source inside the window. screencast = compositor swap
 * stamps (tEpoch; on change — the ball animates through the whole ceremony,
 * so a gap is a frozen screen); periodic = steady composited screenshots (t).
 * Each interval is booked to the phase of its EARLIER frame; the edge gaps
 * (window start -> first frame, last frame -> window end) are reported apart.
 */
export function ceremonyGaps(rows, window, { source = 'screencast', warnMs = CEREMONY_GAP_WARN_MS, failMs = CEREMONY_GAP_FAIL_MS } = {}) {
  const periodic = source === 'periodic';
  const stampOf = (f) => (periodic ? f.t : typeof f.tEpoch === 'number' ? f.tEpoch : f.t);
  const list = (Array.isArray(rows) ? rows : [])
    .filter((f) => f && (periodic ? f.kind === 'periodic' : f.kind !== 'periodic') && typeof stampOf(f) === 'number' && stampOf(f) >= window.start && stampOf(f) <= window.end)
    .sort((a, b) => stampOf(a) - stampOf(b));
  const all = [];
  const byPhase = { 'loading-before-presented': [], 'loading-after-presented': [], opening: [], releasing: [], other: [] };
  for (let i = 1; i < list.length; i += 1) {
    const gap = stampOf(list[i]) - stampOf(list[i - 1]);
    const phase = wholeCeremonyPhaseOf(list[i - 1]) ?? 'other';
    const row = { gap, at: stampOf(list[i - 1]), phase };
    all.push(row);
    byPhase[phase].push(row);
  }
  const edges = list.length ? { leadMs: +(stampOf(list[0]) - window.start).toFixed(1), tailMs: +(window.end - stampOf(list[list.length - 1])).toFixed(1) } : null;
  const worst = [...all]
    .filter((r) => r.gap > warnMs)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 8)
    .map((r) => ({ gapMs: +r.gap.toFixed(1), at: +r.at.toFixed(1), until: +(r.at + r.gap).toFixed(1), phase: r.phase }));
  return {
    source,
    frames: list.length,
    ...gapStats(all, { warnMs, failMs }),
    edges,
    byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, gapStats(v, { warnMs, failMs })])),
    worst,
  };
}

/**
 * Main-thread gaps inside the window: the in-frame timecode is painted by
 * page JS each rAF, so the gap between consecutive DISTINCT timecodes seen
 * in the screencast is a main-thread stall. A compositor-driven CSS ball
 * keeps animating through it (the screen is not frozen), but anything JS /
 * WebGL-driven is, and input is not served. Booked to the phase of the row
 * that showed the earlier timecode.
 */
export function mainThreadGaps(rows, window, { warnMs = CEREMONY_GAP_WARN_MS, failMs = CEREMONY_GAP_FAIL_MS } = {}) {
  const stampOf = (f) => (typeof f.tEpoch === 'number' ? f.tEpoch : f.t);
  const seen = new Map();
  for (const f of Array.isArray(rows) ? rows : []) {
    if (!f || f.kind === 'periodic' || typeof f.tTimecode !== 'number' || typeof stampOf(f) !== 'number') continue;
    if (stampOf(f) < window.start || stampOf(f) > window.end) continue;
    const tc = Math.round(f.tTimecode);
    if (!seen.has(tc)) seen.set(tc, f);
  }
  const codes = [...seen.keys()].sort((a, b) => a - b);
  const all = [];
  const byPhase = { 'loading-before-presented': [], 'loading-after-presented': [], opening: [], releasing: [], other: [] };
  for (let i = 1; i < codes.length; i += 1) {
    const phase = wholeCeremonyPhaseOf(seen.get(codes[i - 1])) ?? 'other';
    const row = { gap: codes[i] - codes[i - 1], at: codes[i - 1], phase };
    all.push(row);
    byPhase[phase].push(row);
  }
  const stats = gapStats(all, { warnMs, failMs });
  return {
    source: 'timecode',
    distinctTimecodes: codes.length,
    ...stats,
    verdict: codes.length < 5 ? 'unmeasured' : stats.maxGapMs > failMs ? 'fail' : stats.maxGapMs > warnMs ? 'warn' : 'pass',
    byPhase: Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, gapStats(v, { warnMs, failMs })])),
    worst: [...all]
      .filter((r) => r.gap > warnMs)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 8)
      .map((r) => ({ gapMs: r.gap, at: r.at, until: r.at + r.gap, phase: r.phase })),
  };
}

/**
 * The whole-ceremony cadence verdict (ball visible -> done). Judged on the
 * screencast (compositor) gaps: fail > failMs, warn > warnMs, unmeasured
 * with fewer than `minFrames` frames. A fail is `corroborated` when a
 * periodic-screenshot gap > failMs overlaps it (the screencast is acked per
 * frame and a busy harness can thin it); `failsRun` = a fail that is
 * corroborated, or a fail with no periodic source to corroborate it.
 */
export function wholeCeremonyCadence(rows, window, { warnMs = CEREMONY_GAP_WARN_MS, failMs = CEREMONY_GAP_FAIL_MS, minFrames = 5 } = {}) {
  if (!window || typeof window.start !== 'number' || typeof window.end !== 'number' || window.end <= window.start) {
    return { verdict: 'unmeasured', reasons: ['no ceremony window (no ball-visible frame, or it never reached done / aborted)'], window: window ?? null, failsRun: false };
  }
  const screencast = ceremonyGaps(rows, window, { source: 'screencast', warnMs, failMs });
  const periodic = ceremonyGaps(rows, window, { source: 'periodic', warnMs, failMs });
  const reasons = [];
  let verdict = 'pass';
  if (screencast.frames < minFrames) {
    verdict = 'unmeasured';
    reasons.push(`only ${screencast.frames} screencast frame(s) in the ceremony window (< ${minFrames})`);
  } else if (screencast.maxGapMs !== null && screencast.maxGapMs > failMs) {
    verdict = 'fail';
    reasons.push(`compositor gap ${screencast.maxGapMs} ms at ${screencast.maxGapAt} (${screencast.worst[0]?.phase ?? 'n/a'}) > ${failMs} ms in the whole ceremony`);
  } else if (screencast.maxGapMs !== null && screencast.maxGapMs > warnMs) {
    verdict = 'warn';
    reasons.push(`compositor gap ${screencast.maxGapMs} ms > ${warnMs} ms (warn) in the whole ceremony`);
  }
  const failGaps = screencast.worst.filter((w) => w.gapMs > failMs);
  const periodicFails = periodic.worst.filter((w) => w.gapMs > failMs);
  const overlaps = (a, b) => a.at < b.until && b.at < a.until;
  const corroborated = failGaps.length > 0 && periodic.frames >= minFrames ? failGaps.some((g) => periodicFails.some((p) => overlaps(g, p))) : null;
  const mainThread = mainThreadGaps(rows, window, { warnMs, failMs });
  return {
    verdict,
    reasons,
    rule: `whole ceremony (first ball-visible frame -> done / aborted): the SCREEN (compositor swap stamps) fails on any gap > ${failMs} ms, warns > ${warnMs} ms; mainThread (JS timecode) and periodic are judged on the same bars and reported beside it`,
    window,
    limits: { warnMs, failMs },
    screencast,
    mainThread,
    periodic,
    corroborated,
    failsRun: verdict === 'fail' && (corroborated === true || periodic.frames < minFrames),
    notes: [
      'screencast = compositor swap stamps (tEpoch) of on-change frames: a gap here is a frozen screen (or harness thinning — hence the periodic corroboration)',
      'mainThread = gaps between distinct JS-painted timecodes: a main-thread stall. A compositor-run CSS ball keeps moving through it, so a mainThread fail with a screencast pass is a responsiveness / JS-paint stall, not a frozen ball',
      'periodic = Page.captureScreenshot cadence; it needs the renderer main thread, so it tracks mainThread more than the screen',
      'the r2 cadence.byPhase "screencast" figures were keyed on row.t (the decoded timecode), i.e. main-thread gaps: compare them with mainThread here',
    ],
  };
}

// ---------------------------------------------------------------------------
// Scene-generation account
// ---------------------------------------------------------------------------

/**
 * Why a load presented generation N > 1. world-readiness.ts bumps the
 * counter on every beginSceneGeneration AND every resetSceneReadiness (an
 * unmount reset, a tier re-entry, a theme change), so N - 1 bumps preceded
 * the presented generation. `samples` = loader-trace merged samples
 * { t, generation }, `readiness` = the end-of-trace bridge read
 * { generation, generationBegunAt, phaseTrace, lastFault }, `attempts` = the
 * recorder's last read per generation.
 */
export function generationAccount(samples, readiness = null, attempts = null) {
  const list = (Array.isArray(samples) ? samples : []).filter((s) => s && typeof s.t === 'number');
  const firstRead = list.find((s) => typeof s.generation === 'number') ?? null;
  const observed = [];
  for (const s of list) {
    if (typeof s.generation !== 'number') continue;
    const last = observed[observed.length - 1];
    if (last && last.generation === s.generation) last.lastSeenAt = s.t;
    else observed.push({ generation: s.generation, firstSeenAt: s.t, lastSeenAt: s.t, phaseAtFirstSight: s.scenePhase ?? null });
  }
  const finalGeneration = typeof readiness?.generation === 'number' ? readiness.generation : observed.length ? observed[observed.length - 1].generation : null;
  if (finalGeneration === null) return { verdict: 'unmeasured', reason: 'no generation read (readiness bridge absent)' };
  const firstObserved = observed.length ? observed[0].generation : finalGeneration;
  const unobserved = [];
  for (let g = 1; g < firstObserved; g += 1) unobserved.push(g);
  const trace = Array.isArray(readiness?.phaseTrace) ? readiness.phaseTrace : [];
  const firstLoading = trace.find((p) => p && p.phase === 'loading' && typeof p.t === 'number' && (p.generation ?? p.g ?? finalGeneration) === finalGeneration) ?? null;
  const begunAt = typeof readiness?.generationBegunAt === 'number' && readiness.generationBegunAt > 0 ? readiness.generationBegunAt : null;
  const chainedBegin = begunAt !== null && firstLoading !== null ? begunAt < firstLoading.t - 1 : null;
  const faults = attempts && typeof attempts === 'object'
    ? Object.entries(attempts)
        .filter(([g, a]) => Number(g) !== finalGeneration && a && a.lastFault)
        .map(([g, a]) => ({ generation: Number(g), fault: a.lastFault }))
    : [];
  const notes = [];
  if (finalGeneration > 1) {
    notes.push(`${finalGeneration - 1} generation bump(s) before the presented generation: world-readiness.ts bumps on every beginSceneGeneration AND every resetSceneReadiness (unmount reset, tier re-entry, theme change)`);
    if (unobserved.length) notes.push(`generation(s) ${unobserved.join(', ')} ended before the recorder's first readiness read${firstRead ? ` (t=${Math.round(firstRead.t)} ms)` : ''} or inside one frame — consistent with a mount / unmount / re-mount chain during hydration (inferred, not observed)${faults.length ? '; faults were recorded, see faults' : '; no fault was recorded for any of them'}`);
    if (chainedBegin) notes.push(`generationBegunAt ${Math.round(begunAt)} ms precedes this generation's loading entry ${Math.round(firstLoading.t)} ms: the begin was chained from the interrupted attempt (ATTEMPT_CHAIN_MS), so the readiness deadline counts from the first attempt`);
  }
  return {
    verdict: 'measured',
    finalGeneration,
    discardedBefore: Math.max(0, finalGeneration - 1),
    observed,
    unobserved,
    firstReadinessReadAt: firstRead ? firstRead.t : null,
    generationBegunAt: begunAt,
    firstLoadingAt: firstLoading ? firstLoading.t : null,
    chainedBegin,
    faults,
    notes,
  };
}

// ---------------------------------------------------------------------------
// --diff-against candidates + the noise floor
// ---------------------------------------------------------------------------

/** Parse `--diff-against a,b,c` into distinct tags (order kept). */
export function parseDiffTags(raw) {
  if (typeof raw !== 'string') return [];
  return [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))];
}

/**
 * Pick the baseline among candidates { tag, exists, pose: { match },
 * sidecar?: { worldLuma } } (LOOK r4 SEAT H: ranked, not first-listed).
 *
 * Rank: (1) the pose — match true, then unknown (null), then false; (2) the
 * world-luma agreement with `referenceLuma` (the after still's worldLuma) —
 * consistent (rel <= maxRel), then unmeasured, then divergent, then a still
 * the capture itself recorded as black-IBL (sidecar iblState); (3) list order
 * (the operator's preference, e.g. the lead's canonical lit -retry set first).
 * Within the consistent band the luma rel is NOT a tie-break: a look change
 * legitimately moves the after's world luma (dark r3: the black-IBL plain
 * before sat closer to the after than the lit -retry one). A luma-divergent
 * candidate is only picked when no better one exists, and the pick says so
 * (`lumaDivergent`). Returns { pick, poseValid, why, ranking }.
 *
 * LOOK r6 (D27, CLARITY r5: the sakura blast was still diffed against the
 * retired black-IBL look-before-blast-sakura): `prefer` = canonical tag
 * prefixes (capture-route passes CANONICAL_BASELINES[world], e.g.
 * fid-w2c-r2-sakura-light). Inside one pose rank a canonical candidate wins
 * over every other, before the luma rank. Among equal luma ranks, a
 * candidate whose capture recorded a lit IBL (iblState) wins over one that
 * predates the read (BASELINE-IBL-UNKNOWN, flagged in `why` and `ranking`).
 */
export function pickDiffCandidate(candidates, { referenceLuma = null, maxRel = WORLD_LUMA_DIVERGENCE_REL, prefer = [] } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).map((c, order) => ({ c, order })).filter(({ c }) => c && c.exists);
  if (!list.length) return { pick: null, poseValid: null, why: 'no candidate still exists', ranking: [] };
  const poseRank = (c) => (c.pose?.match === true ? 0 : c.pose?.match === false ? 2 : 1);
  const prefixes = (Array.isArray(prefer) ? prefer : []).filter((p) => typeof p === 'string' && p.length > 0);
  const canonical = (c) => typeof c.tag === 'string' && prefixes.some((p) => c.tag.startsWith(p));
  const scored = list.map(({ c, order }) => {
    const luma = worldLumaConsistency(referenceLuma, c.sidecar?.worldLuma, { maxRel });
    const blackIbl = c.sidecar?.iblState?.verdict === 'black';
    const iblUnknown = !blackIbl && (!c.sidecar?.iblState || c.sidecar.iblState.verdict === 'unmeasured');
    const lumaRank = blackIbl ? 3 : luma.verdict === 'consistent' ? 0 : luma.verdict === 'divergent' ? 2 : 1;
    const pr = poseRank(c);
    const isCanonical = canonical(c);
    // A canonical before shot before the pointer pin (LOOK r2) sits at the
    // same camera position with the pointer parallax in yaw / pitch: it is
    // ranked above a pose-matched candidate whose luma diverges or whose
    // IBL was black (D27), never above a clean pose-matched one.
    const parallaxOnly = isCanonical && pr === 2 && poseParallaxOnly(c.pose);
    const tier = pr === 0 && lumaRank === 0 ? 0 : parallaxOnly ? 1 : pr === 0 ? 2 : pr === 1 ? 3 : 4;
    return { c, order, poseRank: pr, tier, parallaxOnly, canonRank: isCanonical ? 0 : 1, luma, lumaRank, blackIbl, iblUnknown, iblRank: iblUnknown ? 1 : 0 };
  });
  scored.sort((x, y) => x.tier - y.tier || x.canonRank - y.canonRank || x.lumaRank - y.lumaRank || x.iblRank - y.iblRank || x.order - y.order);
  const best = scored[0];
  const pick = best.c;
  const poseValid = best.parallaxOnly ? 'parallax' : best.poseRank === 0 ? true : best.poseRank === 2 ? false : null;
  const poseWord = best.parallaxOnly
    ? `canonical, same camera position, angles off by the unpinned pointer parallax (yaw ${best.c.pose?.dYaw ?? 'n/a'} rad${typeof best.c.pose?.dPitch === 'number' ? `, pitch ${best.c.pose.dPitch} rad` : ''}; a framing shift, read the figure-masked numbers)`
    : best.poseRank === 0
      ? 'pose-matched'
      : best.poseRank === 2
        ? 'pose-mismatched (no pose-matched candidate)'
        : 'pose unknown';
  const lumaWord = best.blackIbl
    ? 'captured with a BLACK IBL (no other candidate exists)'
    : best.luma.verdict === 'consistent'
      ? `world luma consistent with the after (rel ${best.luma.rel} <= ${maxRel})`
      : best.luma.verdict === 'divergent'
        ? `world luma DIVERGES from the after (rel ${best.luma.rel} > ${maxRel}; no consistent candidate exists)`
        : 'world luma unmeasured';
  const canonWord = prefixes.length ? (best.canonRank === 0 ? '; the canonical baseline (D27)' : `; no canonical baseline (${prefixes.join(', ')}) at this pose rank`) : '';
  const iblWord = best.iblUnknown ? '; BASELINE-IBL-UNKNOWN (the before predates the iblState read)' : '';
  const passedOver = scored.slice(1).map((s) => `${s.c.tag}: ${s.poseRank === 0 ? 'pose ok' : s.parallaxOnly ? 'pose parallax-only' : s.poseRank === 2 ? 'pose mismatch' : 'pose unknown'}${prefixes.length && s.canonRank === 0 ? ', canonical' : ''}, luma ${s.luma.verdict}${typeof s.luma.rel === 'number' ? ` rel ${s.luma.rel}` : ''}${s.blackIbl ? ', black IBL' : s.iblUnknown ? ', IBL unknown' : ''}${s.tier === best.tier && s.canonRank === best.canonRank && s.lumaRank === best.lumaRank && s.iblRank === best.iblRank ? ', later in the list' : ''}`);
  return {
    pick,
    poseValid,
    lumaDivergent: best.luma.verdict === 'divergent' || best.blackIbl,
    canonical: prefixes.length ? best.canonRank === 0 : null,
    iblUnknown: best.iblUnknown,
    why: `${pick.tag}: ${poseWord}; ${lumaWord}${canonWord}${iblWord}${passedOver.length ? `; passed over ${passedOver.join(' | ')}` : ''}`,
    ranking: scored.map((s) => ({ tag: s.c.tag, pose: s.c.pose?.match ?? null, ...(s.parallaxOnly ? { poseParallaxOnly: true } : {}), canonical: s.canonRank === 0, luma: s.luma.verdict, lumaRel: s.luma.rel ?? null, blackIbl: s.blackIbl, iblUnknown: s.iblUnknown })),
  };
}

/** Largest yaw / pitch offset (rad) the unpinned pointer parallax produced before LOOK r2's pointer pin. */
export const POINTER_PARALLAX_MAX_RAD = 0.035;

/**
 * A poseMatch record that differs ONLY in view angles within the pointer
 * parallax (same camera position): a pre-pointer-pin still of the same pose.
 */
export function poseParallaxOnly(pose, { posM = 1e-3, maxRad = POINTER_PARALLAX_MAX_RAD } = {}) {
  if (!pose || pose.match !== false || typeof pose.dPos !== 'number' || pose.dPos > posM) return false;
  const yaw = typeof pose.dYaw === 'number' ? pose.dYaw : 0;
  const pitch = typeof pose.dPitch === 'number' ? pose.dPitch : 0;
  return yaw <= maxRad && pitch <= maxRad;
}

/**
 * Compare an after-vs-before diff with the before-vs-before noise floor at
 * the same pose (pixelDiff records). `withinFloor` = the after diff's share
 * above threshold and mean are at or below the floor's plus a margin.
 */
export function compareToFloor(diff, floor, { pctMargin = 0.5, meanMargin = 0.5 } = {}) {
  if (!diff || !floor || diff.comparable === false || floor.comparable === false) return { verdict: 'unmeasured', reason: 'a diff is missing or incomparable' };
  const dPct = +(diff.overThresholdPct - floor.overThresholdPct).toFixed(3);
  const dMean = +(diff.mean - floor.mean).toFixed(3);
  const withinFloor = dPct <= pctMargin && dMean <= meanMargin;
  return {
    verdict: withinFloor ? 'within-floor' : 'above-floor',
    overThresholdPct: { diff: diff.overThresholdPct, floor: floor.overThresholdPct, delta: dPct },
    mean: { diff: diff.mean, floor: floor.mean, delta: dMean },
    max: { diff: diff.max, floor: floor.max },
    margins: { pctMargin, meanMargin },
  };
}

// ---------------------------------------------------------------------------
// Baseline lighting consistency (LOOK r3, round-3 H follow-up)
// ---------------------------------------------------------------------------
//
// The r2 "noise floor" was not all noise: look-before-r0-light-390-retry was
// shot with the world lit like a black-IBL load (worldLuma mean 75 vs 138 on
// the non-retry still at the same pose), and the sakura blast baseline
// disagreed with the pre-pilot still by a mean of 48.9. A diff between two
// stills whose LIGHTING STATE differs is neither a render change nor noise.

/** worldLuma means that differ by more than this share mark a pair divergent. */
export const WORLD_LUMA_DIVERGENCE_REL = 0.2;

/**
 * Compare the presented world-frame luma of two sidecars ({ mean, spread }).
 * `rel` = |a - b| / max(a, b). Divergent above maxRel.
 */
export function worldLumaConsistency(a, b, { maxRel = WORLD_LUMA_DIVERGENCE_REL } = {}) {
  const ma = typeof a?.mean === 'number' ? a.mean : null;
  const mb = typeof b?.mean === 'number' ? b.mean : null;
  if (ma === null || mb === null) return { verdict: 'unmeasured', reason: 'worldLuma missing on a sidecar (recorded on evidence runs only)' };
  const top = Math.max(ma, mb);
  const rel = top > 0 ? Math.abs(ma - mb) / top : 0;
  return { verdict: rel > maxRel ? 'divergent' : 'consistent', a: ma, b: mb, rel: +rel.toFixed(4), maxRel };
}

const near = (x, y, relTol) => {
  if (typeof x !== 'number' || typeof y !== 'number') return x === y;
  const top = Math.max(Math.abs(x), Math.abs(y));
  return top === 0 ? true : Math.abs(x - y) / top <= relTol;
};

/**
 * Compare two sceneLighting reads (see readSceneLighting in capture-route):
 * { theme, environment: { present, cubeUv, imageHeight, intensity,
 * rotationY }, lights: [{ type, color, intensity }], fog: { color, density,
 * near, far } | null, background }. Returns { match, differences }; either
 * read missing -> match null.
 */
export function sceneLightingMatch(a, b, { relTol = 1e-3 } = {}) {
  if (!a || !b || a.available === false || b.available === false) return { match: null, reason: 'sceneLighting missing on a sidecar (needs --debug on)', differences: [] };
  const d = [];
  if (a.theme !== b.theme) d.push(`theme ${a.theme} vs ${b.theme}`);
  const ea = a.environment ?? {};
  const eb = b.environment ?? {};
  for (const k of ['present', 'cubeUv', 'imageHeight']) if (ea[k] !== eb[k]) d.push(`environment.${k} ${ea[k]} vs ${eb[k]}`);
  for (const k of ['intensity', 'rotationY']) if (!near(ea[k], eb[k], relTol)) d.push(`environment.${k} ${ea[k]} vs ${eb[k]}`);
  const key = (l) => `${l.type}|${l.color}`;
  const la = [...(a.lights ?? [])].sort((x, y) => key(x).localeCompare(key(y)) || x.intensity - y.intensity);
  const lb = [...(b.lights ?? [])].sort((x, y) => key(x).localeCompare(key(y)) || x.intensity - y.intensity);
  if (la.length !== lb.length) d.push(`lights ${la.length} vs ${lb.length}`);
  else
    la.forEach((l, i) => {
      const m = lb[i];
      if (key(l) !== key(m) || !near(l.intensity, m.intensity, relTol)) d.push(`light ${key(l)}@${l.intensity} vs ${key(m)}@${m.intensity}`);
    });
  const fa = a.fog ?? null;
  const fb = b.fog ?? null;
  if ((fa === null) !== (fb === null)) d.push(`fog ${fa ? 'present' : 'absent'} vs ${fb ? 'present' : 'absent'}`);
  else if (fa && fb) {
    if (fa.color !== fb.color) d.push(`fog.color ${fa.color} vs ${fb.color}`);
    for (const k of ['density', 'near', 'far']) if (!near(fa[k], fb[k], relTol)) d.push(`fog.${k} ${fa[k]} vs ${fb[k]}`);
  }
  if (a.background !== b.background) d.push(`background ${a.background} vs ${b.background}`);
  return { match: d.length === 0, differences: d };
}

/**
 * Is a BEFORE pair (a floor, or a baseline vs its retry) fit to be a noise
 * floor? Suspect when the pose differs, the lighting reads differ, or the
 * world luma diverges. The floor is then not noise and must not be used to
 * excuse an after diff.
 */
export function baselineSuspicion({ pose = null, lighting = null, luma = null } = {}) {
  const reasons = [];
  if (pose && pose.match === false) reasons.push(`pose differs${pose.reasons?.length ? ` (${pose.reasons.join('; ')})` : ''}`);
  if (lighting && lighting.match === false) reasons.push(`lighting state differs (${lighting.differences.slice(0, 4).join('; ')})`);
  if (luma && luma.verdict === 'divergent') reasons.push(`world luma diverges ${luma.a} vs ${luma.b} (rel ${luma.rel} > ${luma.maxRel}; e.g. a black-IBL load)`);
  return { suspect: reasons.length > 0, reasons };
}
