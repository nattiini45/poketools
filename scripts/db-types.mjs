#!/usr/bin/env node
/**
 * db-types.mjs
 *
 * Regenerates src/types/database.ts from the LOCAL Supabase stack (`supabase start`, then
 * `supabase db reset` to replay supabase/migrations/). It runs the CLI pinned in the lockfile
 * (`supabase gen types typescript --local --schema public`), never a linked or hosted project.
 *
 * The output is captured and written atomically (temp file + rename) only after the CLI exited 0
 * with non-empty TypeScript, so a stopped stack can never truncate the committed file. Line
 * endings are normalised to LF.
 *
 * Usage:
 *   npm run db:types           # write src/types/database.ts
 *   npm run db:types:check     # exit 1 when the committed file differs from the local schema
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry-point.mjs';

const TAG = '[db-types]';
export const GEN_ARGS = Object.freeze(['gen', 'types', 'typescript', '--local', '--schema', 'public']);
export const OUTPUT_REL = 'src/types/database.ts';

/** @param {string} text */
export function normalizeTypes(text) {
  const lf = text.replace(/\r\n?/g, '\n');
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}

/** The generated file starts with this declaration; anything before it is not types. */
const TYPES_START = /^export type Json\b/m;

/**
 * Validate the CLI result. Returns the normalised types or an error message; never both. Text the
 * CLI printed before the generated file (an update notice, say) is cut off and returned as
 * `discarded` so the caller shows it; it is never written into the types file.
 * @param {{ status: number | null, stdout: string, stderr: string, error?: Error }} result
 * @returns {{ ok: true, types: string, discarded: string } | { ok: false, message: string }}
 */
export function interpretGenResult(result) {
  if (result.error) {
    return { ok: false, message: `${TAG} could not start the Supabase CLI: ${result.error.message}` };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message:
        `${TAG} supabase gen types failed (exit ${result.status}). Is the local stack running? ` +
        `Run \`npx supabase start\` and \`npx supabase db reset\` first.\n${result.stderr.trim()}`,
    };
  }
  const normalized = normalizeTypes(result.stdout);
  const start = normalized.search(TYPES_START);
  const types = start < 0 ? '' : normalized.slice(start);
  if (start < 0 || !/^export type Database\b/m.test(types)) {
    return {
      ok: false,
      message: `${TAG} the CLI output has no \`export type Json\` followed by \`export type Database\`; ${OUTPUT_REL} was left unchanged`,
    };
  }
  return { ok: true, types, discarded: normalized.slice(0, start).trim() };
}

/**
 * Compare generated types with the committed file (line endings ignored).
 * @param {string} generated
 * @param {string | null} committed null when the file is missing
 */
export function typesUpToDate(generated, committed) {
  return committed !== null && normalizeTypes(committed) === generated;
}

/** Path of the lockfile-pinned CLI entry (the `supabase` package's bin script). */
export function supabaseCliEntry(root) {
  const require = createRequire(join(root, 'package.json'));
  return require.resolve('supabase/dist/supabase.js');
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.slice(2).includes('--check');
  const unknown = process.argv.slice(2).filter((a) => a !== '--check');
  if (unknown.length > 0) {
    console.error(`${TAG} unknown argument(s): ${unknown.join(' ')} (expected --check)`);
    process.exit(2);
  }
  // The npm bin shim runs the platform binary with inherited stdio, so its stdout is this pipe.
  const result = spawnSync(process.execPath, [supabaseCliEntry(root), ...GEN_ARGS], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const outcome = interpretGenResult({ status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error });
  if (!outcome.ok) {
    console.error(outcome.message);
    process.exit(1);
  }
  if (outcome.discarded !== '') {
    console.warn(`${TAG} ignored CLI output before the generated types:\n${outcome.discarded}`);
  }
  const outPath = join(root, OUTPUT_REL);
  const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (check) {
    if (typesUpToDate(outcome.types, committed)) {
      console.log(`${TAG} ${OUTPUT_REL} matches the local schema`);
      return;
    }
    console.error(`${TAG} ${OUTPUT_REL} differs from the local schema; run npm run db:types and review the diff`);
    process.exit(1);
  }
  const tmp = `${outPath}.tmp`;
  writeFileSync(tmp, outcome.types);
  renameSync(tmp, outPath);
  console.log(`${TAG} wrote ${OUTPUT_REL}${typesUpToDate(outcome.types, committed) ? ' (unchanged)' : ''}`);
}

// Run only when executed directly (see lib/entry-point.mjs).
if (isEntryPoint(import.meta.url, process.argv[1])) main();
