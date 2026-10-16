/**
 * Gauntlet round 4 (W6 / W7 judges): the evidence JSON is the authoritative
 * record, so a round needs one place that reads it — not the exit codes.
 *
 *   node scripts/lib/round-summary.mjs <tag-prefix> [--json]
 *
 * reads every gauntlet/evidence/<tag-prefix>*.json and prints, per kind:
 *  - sweeps (down / up / jitter / jump / panel / dither): pass / fail, and
 *    per jump leg the frame-gap verdict and max gap;
 *  - loader traces: pass / fail / unmeasured, and the COUNT of
 *    insufficient-sampling runs — the verdict's unmeasuredReason OR an
 *    under-sampled composite on a trace that failed for another reason
 *    (the lead's re-shoot list);
 *  - still sidecars: station-settle / content failures and
 *    particle-corridor-open.
 * Exit 1 when any CURRENT record failed, else 0 (unmeasured never fails the
 * summary; it is counted).
 *
 * Round 5 (W6 judge):
 *  - STALE: a record whose `invocation.sourceStamp.newestSrcMtime` predates
 *    the newest src/ file owned by its workstream (the tag's `fid-w<N>-`
 *    prefix; WORKSTREAM_SRC below) was shot on older source. It is flagged,
 *    listed apart, and its failure does not count as a current failure (it
 *    is printed as `FAIL (stale)`); unstamped records are flagged too.
 *  - EARLIER TRIES: `<stem>.try<N>.json` (kept by capture-route when a
 *    record that did not pass is re-shot) are listed and counted as the
 *    retry record, never as current failures.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentFileOfTry, isTryFile } from './evidence-tries.mjs';

/**
 * src/ paths (forward slashes, repo-relative) each workstream's seat owns —
 * the round-5 ownership table. Tests (`__tests__/`) never make evidence
 * stale: they do not change what renders.
 */
export const WORKSTREAM_SRC = {
  W6: [
    /^src\/lib\/route-world\/(direction-latch|scroll-map|camera-path|focus)\.ts$/,
    /^src\/components\/world\/route\/(useNearestStation|useScrollConductor|ConductorDriver|CameraRig|useStationWarmup)\.tsx?$/,
    /^src\/components\/world\/route\/focus\//,
    /^src\/components\/world\/(ContextOverlay|WorldNav|Reveal)\.tsx$/,
    /\/use\w*StationWindow\w*\.tsx?$/,
    /^src\/components\/world\/themes\/(mountain|clouds)\/env\/Lighting\.tsx$/,
    /\/(StatueRow|ParkFigures|PassFigures|SkyFigures|PropMounts)\.tsx$/,
  ],
  W7: [
    /^src\/components\/world\/route\/(scene-progress\.ts|BallLoader\.tsx|BallLoader\.module\.css|WorldStateProvider\.tsx|world-readiness\.ts|RouteSceneRecovery\.tsx|QualityGovernor\.tsx|RouteWorldCanvas\.tsx)$/,
    /^src\/lib\/route-world\/(ball-loader-state|quality)\.ts$/,
    /^src\/components\/world\/WorldShell\.tsx$/,
    /\/HideHtmlOnRoute\.tsx$/,
  ],
  W1: [
    /^src\/components\/world\/route\/particles\//,
    /^src\/lib\/route-world\/(particle-discipline|board-paint-path|board-text|legibility)\.ts$/,
    /\/(PetalFall|Snowfall|WindField|RosterShrine|TrailRegister|TrailSigns|CloudSea|Board)\.tsx$/,
    /\/(particle-faces|board-painters|board-content|desk-painters|paint)\.ts$/,
    /^src\/components\/world\/themes\/mountain\/furniture\/layout\.ts$/,
  ],
  W3: [
    /^src\/lib\/route-world\/water\.ts$/,
    /^src\/components\/world\/route\/water\//,
    /\/(Lake|AlpineValley)\.tsx$/,
    /^src\/components\/world\/themes\/sakura\/furniture\/Ground\.tsx$/,
  ],
};

/** `fid-w6-r4-...json` -> 'W6'; null when the name carries no workstream (pure). */
export function workstreamOfFile(file) {
  const m = /^fid-(w\d+)-/i.exec(file);
  return m ? m[1].toUpperCase() : null;
}

/** Does repo-relative `relPath` belong to workstream `ws`? (pure) */
export function srcBelongsTo(ws, relPath) {
  const path = relPath.replace(/\\/g, '/');
  if (path.includes('/__tests__/')) return false;
  return (WORKSTREAM_SRC[ws] ?? []).some((re) => re.test(path));
}

/** Newest owned src file per workstream from [{ file, mtimeMs }] (pure). */
export function newestSrcByWorkstream(entries) {
  const out = {};
  for (const ws of Object.keys(WORKSTREAM_SRC)) {
    for (const e of entries) {
      if (!srcBelongsTo(ws, e.file)) continue;
      if (!out[ws] || e.mtimeMs > out[ws].mtimeMs) out[ws] = { file: e.file, mtimeMs: e.mtimeMs };
    }
  }
  return out;
}

/**
 * Staleness of one parsed record (pure): null when fresh (or when the file
 * names no workstream with owned sources), else { reason, ... }.
 */
export function stalenessOf(file, body, newestByWs) {
  const ws = workstreamOfFile(file);
  const newest = ws ? newestByWs?.[ws] : null;
  if (!ws || !newest) return null;
  const stampIso = body?.invocation?.sourceStamp?.newestSrcMtime ?? null;
  const stampMs = stampIso ? Date.parse(stampIso) : Number.NaN;
  const newestIso = new Date(newest.mtimeMs).toISOString();
  if (!Number.isFinite(stampMs)) {
    return { reason: 'unstamped (no invocation.sourceStamp)', workstream: ws, newestSrcFile: newest.file, newestSrcMtime: newestIso };
  }
  // 1 s tolerance: mtime resolution and the stamp's own scan time.
  if (newest.mtimeMs > stampMs + 1000) {
    return { reason: `shot on source from ${stampIso}; ${newest.file} changed at ${newestIso}`, workstream: ws, sourceStamp: stampIso, newestSrcFile: newest.file, newestSrcMtime: newestIso };
  }
  return null;
}

/**
 * Classify one parsed evidence JSON (pure; `file` is its basename). Round 5:
 * with `newestByWs` the record carries `stale` (stalenessOf) when it was shot
 * on older source; a `.try<N>.json` file is marked `earlierTry` with the
 * current record's name in `currentFile`.
 */
export function classifyRecord(file, body, { newestByWs = null } = {}) {
  const base = classifyBody(file, body);
  const stale = newestByWs && body ? stalenessOf(file, body, newestByWs) : null;
  return {
    ...base,
    ...(stale ? { stale } : {}),
    ...(isTryFile(file) ? { earlierTry: true, currentFile: currentFileOfTry(file) } : {}),
  };
}

function classifyBody(file, body) {
  if (!body || typeof body !== 'object') return { file, kind: 'unknown', status: 'unreadable' };
  if (body.kind === 'sweep') {
    if (body.failed === true) return { file, kind: `sweep-${body.mode ?? '?'}`, status: 'fail', reasons: [body.reason ?? 'failed'] };
    const legs = Array.isArray(body.legs)
      ? body.legs.map((leg) => ({
          leg: `${leg.from}->${leg.to}`,
          verdict: leg.analysis?.verdict ?? null,
          frameGapVerdict: leg.analysis?.frameGapVerdict ?? null,
          maxFrameGapMs: leg.analysis?.maxFrameGapMs ?? leg.frameGaps?.maxGapMs ?? null,
        }))
      : null;
    return {
      file,
      kind: `sweep-${body.mode ?? '?'}`,
      viewport: body.viewport ?? null,
      status: body.pass === true ? 'pass' : 'fail',
      ...(legs ? { legs } : {}),
      ...(body.analysis?.frameGapVerdict ? { frameGapVerdict: body.analysis.frameGapVerdict, maxFrameGapMs: body.analysis.maxFrameGapMs ?? null } : {}),
    };
  }
  if (body.kind === 'loader-trace') {
    const a = body.analysis ?? {};
    const status = a.verdict === 'pass' ? 'pass' : a.verdict === 'fail' ? 'fail' : 'unmeasured';
    return {
      file,
      kind: 'loader-trace',
      viewport: body.viewport ?? null,
      status,
      ...(a.unmeasuredReason ? { unmeasuredReason: a.unmeasuredReason } : {}),
      composite: a.composite?.verdict ?? null,
      ballText: a.ballText?.verdict ?? null,
      reasons: Array.isArray(a.reasons) ? a.reasons : [],
    };
  }
  if (typeof body.section === 'string' && (body.stationSettle || body.failed === true || body.particleCorridor)) {
    const reasons = [];
    if (body.failed === true) reasons.push(body.reason ?? 'failed');
    if (body.stationSettle && body.stationSettle.ok === false) reasons.push(body.stationSettle.reason ?? 'station-settle-failed');
    if (body.particleCorridor?.verdict === 'fail') reasons.push('particle-corridor-open');
    return {
      file,
      kind: 'still',
      status: reasons.length > 0 ? 'fail' : 'pass',
      particleCorridor: body.particleCorridor?.verdict ?? null,
      contentVerdict: body.stationContent?.content?.verdict ?? null,
      reasons,
    };
  }
  return { file, kind: body.kind ?? 'other', status: 'skipped' };
}

/** Roll classified records up into the round summary (pure). */
export function summarizeRound(allRecords) {
  // Round 5: earlier tries are the retry record, not the round's evidence.
  const tries = allRecords.filter((r) => r.earlierTry && r.status !== 'skipped');
  const records = allRecords.filter((r) => !r.earlierTry);
  const byKind = {};
  for (const r of records) {
    if (r.status === 'skipped') continue;
    const row = (byKind[r.kind] ??= { pass: 0, fail: 0, unmeasured: 0, unreadable: 0 });
    row[r.status] = (row[r.status] ?? 0) + 1;
    if (r.stale) row.stale = (row.stale ?? 0) + 1;
  }
  const insufficient = records.filter(
    (r) => r.unmeasuredReason === 'insufficient-sampling' || (r.kind === 'loader-trace' && (r.composite === 'insufficient-sampling' || r.composite === 'unmeasured')),
  );
  const contentUnmeasured = records.filter((r) => r.kind === 'still' && r.contentVerdict === 'unmeasured');
  const failed = records.filter((r) => r.status === 'fail' || r.status === 'unreadable');
  const failures = failed.filter((r) => !r.stale);
  const staleFailures = failed.filter((r) => r.stale);
  const stale = records.filter((r) => r.stale && r.status !== 'skipped');
  const jumpGapFails = records.flatMap((r) => (r.legs ?? []).filter((l) => l.frameGapVerdict === 'fail').map((l) => `${r.file} ${l.leg} ${l.maxFrameGapMs} ms`));
  const failedTries = tries.filter((r) => r.status !== 'pass');
  return {
    records: records.filter((r) => r.status !== 'skipped').length,
    byKind,
    insufficientSamplingCount: insufficient.length,
    insufficientSampling: insufficient.map((r) => r.file),
    stationContentUnmeasuredCount: contentUnmeasured.length,
    jumpFrameGapFails: jumpGapFails,
    failures: failures.map((r) => ({ file: r.file, kind: r.kind, reasons: r.reasons ?? [] })),
    staleCount: stale.length,
    stale: stale.map((r) => ({ file: r.file, status: r.status, reason: r.stale.reason })),
    staleFailures: staleFailures.map((r) => ({ file: r.file, kind: r.kind, reasons: r.reasons ?? [], stale: r.stale.reason })),
    earlierTries: tries.map((r) => ({ file: r.file, currentFile: r.currentFile, status: r.status, reasons: r.reasons ?? [], ...(r.stale ? { stale: r.stale.reason } : {}) })),
    earlierTriesFailed: failedTries.length,
    ok: failures.length === 0,
  };
}

/** Repo-relative src/ files with their mtimes (the staleness input). */
async function listSrc(repoRoot) {
  const root = resolve(repoRoot, 'src');
  const out = [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = resolve(entry.parentPath ?? entry.path ?? root, entry.name);
    try {
      const { mtimeMs } = await stat(full);
      out.push({ file: full.slice(repoRoot.length + 1).replace(/\\/g, '/'), mtimeMs });
    } catch {
      /* vanished mid-scan */
    }
  }
  return out;
}

async function main(argv) {
  const prefix = argv.find((a) => !a.startsWith('--'));
  if (!prefix || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) {
    console.error('usage: node scripts/lib/round-summary.mjs <tag-prefix> [--json]');
    return 2;
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dir = resolve(repoRoot, 'gauntlet', 'evidence');
  const files = (await readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
  const newestByWs = newestSrcByWorkstream(await listSrc(repoRoot));
  const records = [];
  for (const file of files) {
    let body = null;
    try {
      body = JSON.parse(await readFile(resolve(dir, file), 'utf8'));
    } catch {
      body = null;
    }
    records.push(classifyRecord(file, body, { newestByWs }));
  }
  const summary = summarizeRound(records);
  if (argv.includes('--json')) {
    const newestSrc = Object.fromEntries(Object.entries(newestByWs).map(([ws, e]) => [ws, { file: e.file, mtime: new Date(e.mtimeMs).toISOString() }]));
    console.log(JSON.stringify({ prefix, newestSrc, ...summary, detail: records.filter((r) => r.status !== 'skipped') }, null, 2));
  } else {
    console.log(`round-summary ${prefix}: ${summary.records} records`);
    for (const [ws, e] of Object.entries(newestByWs)) console.log(`  newest ${ws} src: ${e.file} @ ${new Date(e.mtimeMs).toISOString()}`);
    for (const [kind, row] of Object.entries(summary.byKind)) {
      console.log(`  ${kind}: pass ${row.pass} / fail ${row.fail} / unmeasured ${row.unmeasured}${row.unreadable ? ` / unreadable ${row.unreadable}` : ''}${row.stale ? ` (stale ${row.stale})` : ''}`);
    }
    console.log(`  insufficient-sampling (re-shoot): ${summary.insufficientSamplingCount}${summary.insufficientSampling.length ? ` — ${summary.insufficientSampling.join(', ')}` : ''}`);
    console.log(`  station content unmeasured (no baseline): ${summary.stationContentUnmeasuredCount}`);
    console.log(`  STALE (shot before the workstream's newest src edit — re-shoot): ${summary.staleCount}`);
    for (const s of summary.stale) console.log(`    stale ${s.status} ${s.file}: ${s.reason}`);
    console.log(`  earlier tries kept: ${summary.earlierTries.length} (${summary.earlierTriesFailed} not passing)`);
    for (const t of summary.earlierTries) console.log(`    try ${t.status} ${t.file} -> ${t.currentFile}${t.reasons.length ? `: ${t.reasons.join('; ')}` : ''}${t.stale ? ' (stale)' : ''}`);
    for (const line of summary.jumpFrameGapFails) console.log(`  jump frame gap FAIL: ${line}`);
    for (const f of summary.failures) console.log(`  FAIL ${f.kind} ${f.file}${f.reasons.length ? `: ${f.reasons.join('; ')}` : ''}`);
    for (const f of summary.staleFailures) console.log(`  FAIL (stale) ${f.kind} ${f.file}${f.reasons.length ? `: ${f.reasons.join('; ')}` : ''}`);
  }
  return summary.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`round-summary: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    },
  );
}
