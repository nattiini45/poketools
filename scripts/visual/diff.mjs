#!/usr/bin/env node
/**
 * Visual-capture harness: compare two capture labels (docs/visual-harness.md).
 *
 *   node scripts/visual/diff.mjs --base <label> --head <label> [--set frozen|surfaces] [--out <dir>]
 *
 * Every frozen capture must be pixel-identical (or within the target's tolerance, used only for GPU-drawn
 * content); a capture that exists on one side only, changed size or changed its root count fails. Writes
 * <out>/diff-<base>-vs-<head>-<set>/report.md and report.json, and for each changed capture a diff PNG
 * (changed pixels in magenta over a dimmed base) next to the base and head images. Surface captures
 * (--set surfaces) are reported the same way but never fail the run.
 *
 * Exits 0 when every frozen capture passes, 1 otherwise, 2 on bad arguments.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { comparePixels, verdictOf } from './lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function option(argv, name, fallback) {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

async function loadManifest(dir) {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) throw new Error('visual: no manifest at ' + path);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  const files = new Map();
  const jobs = new Map();
  for (const entry of manifest.entries) {
    jobs.set(entry.key, entry);
    for (const file of entry.files) files.set(file.file, { ...file, entry });
  }
  return { files, jobs };
}

async function decode(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function writeDiffImage(base, head, threshold, path) {
  const out = Buffer.alloc(base.width * base.height * 4);
  for (let i = 0; i < base.width * base.height; i += 1) {
    const p = i * 4;
    let delta = 0;
    for (let c = 0; c < 4; c += 1) delta = Math.max(delta, Math.abs(base.data[p + c] - head.data[p + c]));
    if (delta > threshold) {
      out[p] = 255;
      out[p + 1] = 0;
      out[p + 2] = 255;
    } else {
      const grey = Math.round((base.data[p] + base.data[p + 1] + base.data[p + 2]) / 3);
      out[p] = out[p + 1] = out[p + 2] = Math.round(grey * 0.35 + 255 * 0.65);
    }
    out[p + 3] = 255;
  }
  await sharp(out, { raw: { width: base.width, height: base.height, channels: 4 } }).png().toFile(path);
}

export async function diffLabels({ base, head, set = 'frozen', out = join(REPO, '.visual') }) {
  const baseDir = join(out, base, set);
  const headDir = join(out, head, set);
  const reportDir = join(out, 'diff-' + base + '-vs-' + head + '-' + set);
  await rm(reportDir, { recursive: true, force: true });
  await mkdir(reportDir, { recursive: true });
  const a = await loadManifest(baseDir);
  const b = await loadManifest(headDir);
  const rows = [];
  const names = [...new Set([...a.files.keys(), ...b.files.keys()])].sort();
  for (const name of names) {
    const left = a.files.get(name) ?? null;
    const right = b.files.get(name) ?? null;
    const entry = (right ?? left).entry;
    const tolerance = entry.tolerance ?? { maxChangedPct: 0, threshold: 0 };
    let comparison = { sameSize: true, changed: 0, changedPct: 0, box: null };
    if (left && right && left.sha256 !== right.sha256) {
      const imgA = await decode(join(baseDir, name));
      const imgB = await decode(join(headDir, name));
      comparison = comparePixels(imgA, imgB, { threshold: tolerance.threshold ?? 0 });
      if (comparison.changed !== 0) {
        const stem = name.replace(/\.png$/, '');
        await copyFile(join(baseDir, name), join(reportDir, stem + '.base.png'));
        await copyFile(join(headDir, name), join(reportDir, stem + '.head.png'));
        if (comparison.sameSize) await writeDiffImage(imgA, imgB, tolerance.threshold ?? 0, join(reportDir, stem + '.diff.png'));
      }
    }
    const verdict = verdictOf({ base: left, head: right, comparison, tolerance });
    rows.push({ file: name, target: entry.target, url: entry.url, ...verdict, changedPct: comparison.changedPct, box: comparison.box });
  }
  // A job that errored on one side has no files: report it, it is never a pass.
  const errored = [...new Set([...a.jobs.keys(), ...b.jobs.keys()])]
    .filter((key) => a.jobs.get(key)?.error || b.jobs.get(key)?.error)
    .map((key) => ({ key, base: a.jobs.get(key)?.error ?? null, head: b.jobs.get(key)?.error ?? null }));
  const failing = rows.filter((r) => !r.pass);
  const pass = set !== 'frozen' || (failing.length === 0 && errored.length === 0);
  const lines = [
    '# Visual diff: ' + base + ' vs ' + head + ' (' + set + ')',
    '',
    rows.length + ' captures compared; ' + rows.filter((r) => r.status === 'same').length + ' identical, ' + failing.length + ' failing, ' + errored.length + ' jobs with errors.',
    '',
  ];
  if (failing.length) {
    lines.push('| Capture | Status | Changed | Box |', '|---|---|---|---|');
    for (const r of failing) lines.push('| ' + r.file + ' | ' + r.status + ' | ' + (r.changedPct === null ? '-' : r.changedPct.toFixed(4) + ' %') + ' | ' + (r.box ? r.box.x + ',' + r.box.y + ' ' + r.box.w + 'x' + r.box.h : '-') + ' |');
    lines.push('');
  }
  for (const e of errored) lines.push('- job ' + e.key + ': base ' + (e.base ?? 'ok') + ', head ' + (e.head ?? 'ok'));
  await writeFile(join(reportDir, 'report.md'), lines.join('\n') + '\n');
  await writeFile(join(reportDir, 'report.json'), JSON.stringify({ base, head, set, pass, rows, errored }, null, 2));
  return { pass, reportDir, compared: rows.length, failing, errored };
}

async function main() {
  const argv = process.argv.slice(2);
  const base = option(argv, 'base');
  const head = option(argv, 'head');
  if (!base || !head) {
    console.error('visual: --base <label> and --head <label> are required');
    process.exit(2);
  }
  const result = await diffLabels({ base, head, set: option(argv, 'set', 'frozen'), out: resolve(option(argv, 'out', join(REPO, '.visual'))) });
  console.log('visual: ' + result.compared + ' compared, ' + result.failing.length + ' failing, ' + result.errored.length + ' errored; report ' + join(result.reportDir, 'report.md'));
  for (const r of result.failing.slice(0, 30)) console.log('visual: ' + r.status.toUpperCase() + ' ' + r.file + (r.changedPct ? ' ' + r.changedPct.toFixed(4) + ' %' : ''));
  process.exit(result.pass ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
