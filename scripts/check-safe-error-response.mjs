// CI guard: flags raw response returns inside `catch` blocks of
// src/app/api/**/route.ts that bypass `safeErrorResponse`. Runs in two modes
// controlled by the `ENFORCE` env var:
//   - report-only (default): prints offenders, exits 0
//   - enforce (ENFORCE=1): prints offenders, exits 1 if any remain
//
// Per-occurrence semantics (see scripts/safe-error-scan.mjs): EVERY
// `return NextResponse...` / `return new Response...` inside a catch block is
// an offender unless the block first `console.error`s the caught error, or the
// preceding line carries `// safe-error-response-allow: <reason>`. There is no
// block-level exemption — a `safeErrorResponse` call elsewhere in the block or
// a trailing `throw` does NOT excuse a raw return branch.
//
// Usage:
//   node scripts/check-safe-error-response.mjs          # report-only
//   ENFORCE=1 node scripts/check-safe-error-response.mjs # enforce

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { scanSource } from './safe-error-scan.mjs';

const API_DIR = join('src', 'app', 'api');
const ROUTE_GLOB = 'route.ts';

const enforce = process.env.ENFORCE === '1';

function walkRouteFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkRouteFiles(full, acc);
    } else if (entry === ROUTE_GLOB) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walkRouteFiles(API_DIR);
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const o of scanSource(src)) {
    offenders.push({ file: file.split(sep).join('/'), line: o.line });
  }
}

if (offenders.length === 0) {
  console.log(
    `[safe-error-response] OK: no raw response returns inside catch blocks across ${files.length} route files.`
  );
  process.exit(0);
}

console.log(
  `[safe-error-response] ${offenders.length} raw response return(s) inside catch blocks bypassing safeErrorResponse:`
);
for (const o of offenders) {
  console.log(`  ${o.file}:${o.line}`);
}
console.log(`[safe-error-response] mode: ${enforce ? 'ENFORCE' : 'report-only'}`);
if (enforce) {
  console.error(`[safe-error-response] ENFORCE mode: failing CI.`);
  process.exit(1);
}
process.exit(0);
