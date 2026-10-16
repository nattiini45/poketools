/**
 * Gauntlet round 5 (W6 judge: the plaza-up 1440 first-try failure lived only
 * in the lead's scratchpad; keeping only the passing retry in
 * gauntlet/evidence hid a 1-in-3 stall rate): before capture-route
 * overwrites an evidence JSON, a prior record that did NOT pass is kept
 * beside it as `<stem>.try<N>.json` (N = 1, 2, ...). A prior pass is simply
 * replaced — the new record is the current one either way.
 *
 * round-summary.mjs reads the `.try<N>.json` files as EARLIER TRIES: listed
 * and counted (the retry rate), never counted as current failures.
 */
import { copyFile, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const TRY_RE = /\.try(\d+)\.json$/;

/** `<dir>/<stem>.json` -> `<dir>/<stem>.try<n>.json` (pure). */
export function tryPathFor(path, n) {
  return path.replace(/\.json$/, `.try${n}.json`);
}

/** True for an archived earlier try (pure). */
export function isTryFile(file) {
  return TRY_RE.test(file);
}

/** The current record's file name of an archived try (pure): `a.try2.json` -> `a.json`. */
export function currentFileOfTry(file) {
  return file.replace(TRY_RE, '.json');
}

/**
 * Did this parsed evidence record pass? (pure). Sweeps: `pass === true`;
 * loader traces: `analysis.verdict === 'pass'`; still sidecars: no failure,
 * a settled station and no open particle corridor. Anything unrecognised is
 * treated as not-passed (kept — losing a record is worse than keeping one).
 */
export function recordPassed(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.failed === true) return false;
  if (body.kind === 'sweep') return body.pass === true;
  if (body.kind === 'loader-trace') return body.analysis?.verdict === 'pass';
  if (typeof body.section === 'string') {
    if (body.stationSettle && body.stationSettle.ok === false) return false;
    if (body.particleCorridor?.verdict === 'fail') return false;
    return true;
  }
  if (body.analysis && typeof body.analysis.verdict === 'string') return body.analysis.verdict === 'pass';
  if (typeof body.pass === 'boolean') return body.pass;
  return false;
}

/** Next free try index for `path` given the directory listing (pure). */
export function nextTryIndex(path, listing) {
  const stem = basename(path).replace(/\.json$/, '');
  let max = 0;
  for (const name of listing) {
    if (!name.startsWith(`${stem}.try`)) continue;
    const m = TRY_RE.exec(name);
    if (m && name === `${stem}.try${m[1]}.json`) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/**
 * Keep a non-passing prior record of `path` as its next `.try<N>.json`.
 * Returns { kept: '<file>', n } when one was kept, { kept: null, reason }
 * otherwise (no prior file, prior passed, unreadable prior is KEPT).
 */
export async function keepPriorTry(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { kept: null, reason: 'no prior record' };
  }
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (body !== null && recordPassed(body)) return { kept: null, reason: 'prior record passed' };
  const listing = await readdir(dirname(path)).catch(() => []);
  const n = nextTryIndex(path, listing);
  const target = tryPathFor(path, n);
  await copyFile(path, resolve(target));
  return { kept: basename(target), n };
}

/**
 * Wave 2 round 3 (W7 judge: "PNGs are overwritten per try; only the
 * runner's manual -first-* copies preserve try-1 stills"): the PNGs that
 * belong to an evidence record (pure). `jsonName` = the record's file name,
 * `listing` = the directory's file names. Mapping:
 *  - `X-trace.json`  -> `X-strip.png`, `X-strip-crop.png`, `X-fNN.png`
 *  - `X-burst.json`  -> `X-burst-strip.png`
 *  - `X-sweep.json`  -> `X-sweep-film.png`
 *  - `X.json`        -> `X.png` (stills, `-loader-film`, flip probes)
 * Archived tries (`.tryN.`) are never listed.
 */
export function pngsForRecord(jsonName, listing) {
  if (isTryFile(jsonName) || !jsonName.endsWith('.json')) return [];
  const stem = jsonName.slice(0, -'.json'.length);
  const out = new Set();
  const has = (name) => listing.includes(name);
  if (has(`${stem}.png`)) out.add(`${stem}.png`);
  const suffixed = (suffix, pngs) => {
    if (!stem.endsWith(suffix)) return;
    const base = stem.slice(0, -suffix.length);
    for (const p of pngs(base)) out.add(p);
  };
  suffixed('-trace', (base) => listing.filter((n) => n === `${base}-strip.png` || n === `${base}-strip-crop.png` || new RegExp(`^${escapeRe(base)}-f\\d{2,}\\.png$`).test(n)));
  suffixed('-burst', (base) => (has(`${base}-burst-strip.png`) ? [`${base}-burst-strip.png`] : []));
  suffixed('-sweep', (base) => (has(`${base}-sweep-film.png`) ? [`${base}-sweep-film.png`] : []));
  return [...out].filter((n) => !/\.try\d+\.png$/.test(n)).sort();
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `<stem>.png` -> `<stem>.try<n>.png` (pure). */
export function tryPngPathFor(name, n) {
  return name.replace(/\.png$/, `.try${n}.png`);
}

/**
 * At run start, for every current evidence record of this tag that did NOT
 * pass, copy its PNGs to `.try<N>.png`, N = the index its JSON will take
 * when this run overwrites it (keepPriorTry computes the same N from the
 * JSON listing), so a try's stills stay beside its `.try<N>.json`. Records
 * that passed are replaced as before. Returns [{ json, n, pngs }].
 */
export async function archivePriorTryPngs(dir, tag) {
  const listing = await readdir(dir).catch(() => []);
  const prefix = `${tag}-`;
  const kept = [];
  for (const name of listing) {
    if (!name.startsWith(prefix) || !name.endsWith('.json') || isTryFile(name)) continue;
    const pngs = pngsForRecord(name, listing);
    if (pngs.length === 0) continue;
    let body = null;
    try {
      body = JSON.parse(await readFile(resolve(dir, name), 'utf8'));
    } catch {
      body = null;
    }
    if (body !== null && recordPassed(body)) continue;
    const n = nextTryIndex(resolve(dir, name), listing);
    for (const png of pngs) await copyFile(resolve(dir, png), resolve(dir, tryPngPathFor(png, n)));
    kept.push({ json: name, n, pngs: pngs.map((p) => tryPngPathFor(p, n)) });
  }
  return kept;
}
