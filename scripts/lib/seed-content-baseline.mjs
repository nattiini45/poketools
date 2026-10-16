#!/usr/bin/env node
/**
 * LOOK r4 SEAT H (CAR r3: content.verdict was 'unmeasured' for the plaza
 * because no station-content baseline existed). Adopt station-content
 * baselines from ACCEPTED stills' sidecars, without a browser:
 *
 *   node scripts/lib/seed-content-baseline.mjs <tag> [<tag> ...] [--dir gauntlet/evidence] [--dry-run] [--replace]
 *
 * For every <tag>-<station>-<viewport>.json whose stationContent passed
 * (ok true, presence pass, a numeric content count, no data-face failure),
 * writes two entries into <dir>/station-content-baseline.json (the file
 * capture-route reads):
 *   - `<world>|<theme>|<station>|<viewport>|q<rung>` (the pinned quality rung
 *     of that run; capture-route prefers this key), and
 *   - the rung-less `<world>|<theme>|<station>|<viewport>` when absent (or
 *     --replace), taken from the largest content count seen, so a lower
 *     rung is judged against its own key or passes the 0.8 share.
 * Each entry carries renderables, instances, the per-face visible-renderable
 * counts (the registered minimum a data face must keep) and `from`.
 *
 * LOOK r6 (H2): every row also writes the EXACT key
 * `<world>|<theme>|<station>|<viewport>|d<dpr>|q<rung>` (capture-route tries
 * it first), and entries record their `dpr` and `rung`. The world is the
 * sidecar's DOM world (stationContent.world, [data-world]) when recorded;
 * the rung is the pinned --quality, else the phase pin's rung (a --quality
 * auto run renders the pinned rung 1). `--rekey` adds the exact key to every
 * existing entry whose `from` sidecar is readable (and stamps its dpr),
 * without touching the old keys:
 *
 *   node scripts/lib/seed-content-baseline.mjs --rekey [--dir gauntlet/evidence] [--dry-run]
 *
 * Exit 0 = written (or dry run), 2 = usage / nothing adoptable.
 */
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contentBaselineKey } from './capture-evidence.mjs';

/**
 * Write via a temp file + rename, so a capture reading the baseline while
 * this runs never sees a half-written file.
 */
async function writeAtomic(path, text) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

/** The device pixel ratio a still was shot at (--dpr; absent = 1). */
export function sidecarDpr(sidecar) {
  const d = sidecar?.stationContent?.dpr?.context ?? sidecar?.invocation?.args?.evidence?.dpr;
  return typeof d === 'number' && d > 0 ? d : 1;
}

/** The quality rung a still rendered: stationContent.rung, the pinned --quality, else the phase pin's rung. */
export function sidecarRung(sidecar) {
  const own = sidecar?.stationContent?.rung;
  if (Number.isInteger(own)) return own;
  const q = String(sidecar?.invocation?.args?.quality ?? '');
  if (/^\d$/.test(q)) return Number(q);
  const pin = String(sidecar?.phasePin?.rung ?? '');
  return /^\d$/.test(pin) ? Number(pin) : null;
}

/** The adoptable baseline row of one sidecar, or { skip: reason }. */
export function adoptableRow(sidecar, file) {
  const sc = sidecar?.stationContent;
  if (!sc) return { skip: `${file}: no stationContent` };
  if (sc.ok !== true) return { skip: `${file}: stationContent.ok ${sc.ok}` };
  if (sc.presence?.verdict !== 'pass') return { skip: `${file}: presence ${sc.presence?.verdict}` };
  if (Array.isArray(sc.faces) && sc.faces.some((f) => f.verdict === 'fail')) return { skip: `${file}: a data face failed` };
  if (sidecar?.iblState?.verdict === 'black') return { skip: `${file}: black IBL` };
  const content = sc.content ?? {};
  if (typeof content.renderables !== 'number') return { skip: `${file}: no content count` };
  const [keyWorld, theme, station, viewport] = (sc.baselineKey ?? '').split('|');
  if (!keyWorld || !station || !viewport) return { skip: `${file}: no baselineKey` };
  // LOOK r6: the DOM world when the capture recorded it (pre-r6 --page-path keys said plaza for every world).
  const world = typeof sc.world === 'string' && sc.world ? sc.world : keyWorld;
  const rung = sidecarRung(sidecar);
  const dpr = sidecarDpr(sidecar);
  const faces = Object.fromEntries((sc.presence.present ?? []).filter((r) => typeof r.visibleRenderables === 'number').map((r) => [r.id, r.visibleRenderables]));
  return {
    key: contentBaselineKey({ world, theme, station, viewport }),
    exactKey: rung !== null ? contentBaselineKey({ world, theme, station, viewport, dpr, rung }) : null,
    rung,
    dpr,
    entry: { renderables: content.renderables, instances: content.instances ?? null, faces, from: file, rung, dpr, at: new Date().toISOString() },
  };
}

/**
 * Merge adoptable rows into a baseline file object ({ version, entries }).
 * Exact (dpr + rung) and rung keys are always (re)written; the rung-less key
 * keeps the most content (never lowered by a lower rung) unless `replace`.
 */
export function mergeBaseline(file, rows, { replace = false } = {}) {
  const out = { version: 1, ...(file ?? {}), entries: { ...(file?.entries ?? {}) } };
  const written = [];
  const plain = new Map();
  for (const r of rows) {
    if (r.exactKey) {
      out.entries[r.exactKey] = r.entry;
      written.push(r.exactKey);
    }
    if (r.rung !== null) {
      out.entries[`${r.key}|q${r.rung}`] = r.entry;
      written.push(`${r.key}|q${r.rung}`);
    }
    const prev = plain.get(r.key);
    if (!prev || r.entry.renderables > prev.renderables) plain.set(r.key, r.entry);
  }
  for (const [key, entry] of plain) {
    if (!replace && out.entries[key]) continue;
    out.entries[key] = entry;
    written.push(key);
  }
  return { file: out, written };
}

/**
 * LOOK r6 (H2): add the exact `|d<dpr>|q<rung>` key for every existing
 * entry whose recorded source sidecar (`from`, a file in `dir`) says what
 * dpr and rung it was shot at; the entry itself gains `dpr` (so a legacy
 * link can be compared). Old keys are never removed or lowered. `readSidecar`
 * (name -> parsed JSON | null) keeps this pure for tests.
 */
export async function rekeyBaseline(file, readSidecar) {
  const out = { version: 1, ...(file ?? {}), entries: { ...(file?.entries ?? {}) } };
  const written = [];
  const skipped = [];
  for (const [key, entry] of Object.entries(file?.entries ?? {})) {
    const parts = key.split('|');
    if (parts.length < 4 || parts.some((p) => /^d[\d.]+$/.test(p))) continue;
    const from = typeof entry?.from === 'string' ? entry.from : null;
    const name = from && from.endsWith('.json') ? from : null;
    const sidecar = name ? await readSidecar(name) : null;
    if (!sidecar) {
      skipped.push(`${key}: source ${from ?? 'n/a'} not readable`);
      continue;
    }
    const dpr = sidecarDpr(sidecar);
    const rung = Number.isInteger(entry.rung) ? entry.rung : sidecarRung(sidecar);
    out.entries[key] = { ...entry, dpr, ...(Number.isInteger(rung) ? { rung } : {}) };
    if (!Number.isInteger(rung)) {
      skipped.push(`${key}: no rung known`);
      continue;
    }
    const [world, theme, station, viewport] = parts;
    const exact = contentBaselineKey({ world, theme, station, viewport, dpr, rung });
    if (out.entries[exact]) continue;
    out.entries[exact] = { ...entry, dpr, rung, rekeyedFrom: key, at: entry.at ?? new Date().toISOString() };
    written.push(exact);
  }
  return { file: out, written, skipped };
}

async function main(argv) {
  const tags = [];
  let dir = resolve('gauntlet', 'evidence');
  let dry = false;
  let replace = false;
  let rekey = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') dir = resolve(argv[++i]);
    else if (argv[i] === '--dry-run') dry = true;
    else if (argv[i] === '--replace') replace = true;
    else if (argv[i] === '--rekey') rekey = true;
    else tags.push(argv[i]);
  }
  if (rekey) {
    const path = resolve(dir, 'station-content-baseline.json');
    let current = null;
    try {
      current = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      console.error(`seed-content-baseline: --rekey needs a readable ${path}`);
      return 2;
    }
    const { file, written, skipped } = await rekeyBaseline(current, async (name) => {
      try {
        return JSON.parse(await readFile(resolve(dir, name), 'utf8'));
      } catch {
        return null;
      }
    });
    for (const k of written) console.log(`seed-content-baseline: ${k} = ${file.entries[k].renderables} (re-keyed from ${file.entries[k].rekeyedFrom})`);
    for (const s of skipped) console.log(`seed-content-baseline: skip ${s}`);
    if (!dry) await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`seed-content-baseline: --rekey ${written.length} exact key(s) ${dry ? '(dry run, not written)' : `-> ${path}`}`);
    return 0;
  }
  if (!tags.length) {
    console.error('usage: node scripts/lib/seed-content-baseline.mjs <tag> [<tag> ...] [--dir gauntlet/evidence] [--dry-run] [--replace]');
    return 2;
  }
  const names = await readdir(dir);
  const rows = [];
  for (const tag of tags) {
    const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-z]+-\\d+\\.json$`);
    for (const name of names.filter((n) => re.test(n)).sort()) {
      let sidecar = null;
      try {
        sidecar = JSON.parse(await readFile(resolve(dir, name), 'utf8'));
      } catch {
        console.log(`seed-content-baseline: skip ${name}: unreadable`);
        continue;
      }
      const row = adoptableRow(sidecar, name);
      if (row.skip) console.log(`seed-content-baseline: skip ${row.skip}`);
      else rows.push(row);
    }
  }
  if (!rows.length) {
    console.error('seed-content-baseline: nothing adoptable');
    return 2;
  }
  const path = resolve(dir, 'station-content-baseline.json');
  let current = null;
  try {
    current = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    current = null;
  }
  const { file, written } = mergeBaseline(current, rows, { replace });
  for (const k of written) console.log(`seed-content-baseline: ${k} = ${file.entries[k].renderables} renderables / ${file.entries[k].instances} instances (${file.entries[k].from})`);
  if (!dry) await writeAtomic(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`seed-content-baseline: ${written.length} entr${written.length === 1 ? 'y' : 'ies'} ${dry ? '(dry run, not written)' : `-> ${path}`}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
