// CI guard: flags double-encoding ("mojibake") artifacts in tracked text files.
// On 2026-07-08 a remediation pass double-encoded 14 markdown files (UTF-8 read
// as cp1252, re-saved as UTF-8) -- "Poke" gained an "A-tilde + copyright" and
// em-dashes gained an "a-circumflex + euro" prefix. This guard prevents
// recurrence by scanning tracked text files -- Markdown, the TS/JS family
// (.ts/.tsx/.js/.jsx/.mjs/.cjs), JSON, SQL, HTML and CSS -- for those patterns.
//
// Runs in two modes controlled by the `ENFORCE` env var:
//   - report-only (default): prints offenders, exits 0
//   - enforce (ENFORCE=1): prints offenders, exits 1 if any remain
//
// Scan/exempt semantics live in scripts/mojibake-scan.mjs (pure, unit-tested).
// A file, line, or the line above an offender may carry `mojibake-allow` to
// exempt a legitimate occurrence (e.g. an incident postmortem quoting the bug).
//
// Usage:
//   node scripts/check-mojibake.mjs           # report-only
//   ENFORCE=1 node scripts/check-mojibake.mjs # enforce

import { spawnSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { scanText } from './mojibake-scan.mjs';

const enforce = process.env.ENFORCE === '1';

const EXTENSIONS = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.sql',
  '.html',
  '.css',
]);
// Build output and dependency dirs are not tracked source. The file list comes
// from `git ls-files` (tracked plus untracked-but-not-ignored), so gitignored
// scratch output (profiles, captures, build trees) is never read; the walk
// below is only the fallback when git is unavailable.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.vercel',
  '.turbo',
  'coverage',
  'dist',
  'build',
  '.claude',
]);
// No hand-written text file comes near this; anything bigger is generated data
// and reading it whole can exceed V8's maximum string length (ERR_STRING_TOO_LONG).
const MAX_BYTES = 8 * 1024 * 1024;

function extname(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot);
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), acc);
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

/** Tracked and untracked-not-ignored text files, or null when git cannot list them. */
function gitFiles() {
  const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0 || typeof res.stdout !== 'string') return null;
  const seen = new Set();
  for (const rel of res.stdout.split('\0')) {
    if (!rel || seen.has(rel)) continue;
    if (rel.split('/').some((part) => SKIP_DIRS.has(part))) continue;
    if (EXTENSIONS.has(extname(rel))) seen.add(rel);
  }
  return [...seen];
}

const files = gitFiles() ?? walk('.');
const skipped = [];
const offenders = [];

let scanned = 0;
for (const file of files) {
  const rel = file.split(sep).join('/').replace(/^\.\//, '');
  // Stat and read through one descriptor, so the size check covers the bytes actually read.
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch (err) {
    // Listed by git but deleted (or a parent replaced) in the work tree; any other read failure must not shrink the scan.
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') continue;
    throw err;
  }
  let text;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) continue; // replaced by a directory or other non-file in the work tree
    if (st.size > MAX_BYTES) {
      skipped.push(rel);
      continue;
    }
    text = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  scanned += 1;
  for (const o of scanText(text)) {
    offenders.push({ file: rel, ...o });
  }
}

if (skipped.length > 0) {
  console.log(`[mojibake] skipped ${skipped.length} file(s) over ${MAX_BYTES} bytes: ${skipped.join(', ')}`);
}

if (offenders.length === 0) {
  console.log(
    `[mojibake] OK: no double-encoding markers across ${scanned} text files.`
  );
  process.exit(0);
}

console.log(`[mojibake] ${offenders.length} double-encoding marker(s) found:`);
for (const o of offenders) {
  console.log(`  ${o.file}:${o.line}:${o.column}  [${o.marker}]  ${JSON.stringify(o.match)}`);
}
console.log(`[mojibake] mode: ${enforce ? 'ENFORCE' : 'report-only'}`);
if (enforce) {
  console.error('[mojibake] ENFORCE mode: failing CI.');
  process.exit(1);
}
process.exit(0);
