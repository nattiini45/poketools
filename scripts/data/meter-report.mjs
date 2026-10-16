#!/usr/bin/env node
/**
 * Summarise a Supabase meter log (DATA-PLAN §4).
 *
 * The meter (`src/lib/supabase/metering.ts`, on with SUPABASE_METER=1 outside
 * production) prints one `[meter:rec] {json}` line per Supabase request. Save
 * the dev server's output and feed it here:
 *
 *   node scripts/data/meter-report.mjs dev.log            # per request id + per target
 *   node scripts/data/meter-report.mjs dev.log --json     # the same, as JSON
 *   node scripts/data/meter-report.mjs - < dev.log        # from stdin
 *   node scripts/data/meter-report.mjs dev.log --request /leagues/abc
 *
 * Reads a file only: no network, no Supabase. Measure against a local
 * `supabase start` stack, never the live project.
 *
 * Exit codes: 0 ok, 1 no meter records found, 2 usage error.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Must match METER_RECORD_PREFIX in src/lib/supabase/metering.ts. */
export const METER_RECORD_PREFIX = '[meter:rec] ';

/** Every meter record in a log (any other line is ignored). */
export function parseMeterLog(text) {
  const records = [];
  let malformed = 0;
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(METER_RECORD_PREFIX);
    if (at === -1) continue;
    try {
      const record = JSON.parse(line.slice(at + METER_RECORD_PREFIX.length));
      if (record && typeof record === 'object' && typeof record.requestId === 'string') records.push(record);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

export function targetLabel(record) {
  if (record.kind === 'table') return record.name ?? '(table)';
  if (record.kind === 'rpc') return `rpc:${record.name ?? '?'}`;
  if (record.kind === 'storage') return `storage:${record.name ?? '?'}`;
  return String(record.kind ?? 'other');
}

/** Sequential rounds: a wave starts when a request starts after every request of the previous wave finished. */
export function countWaves(records) {
  let waves = 0;
  let waveEnd = Number.NEGATIVE_INFINITY;
  const timed = records.filter((r) => typeof r.startMs === 'number' && typeof r.ms === 'number');
  for (const r of [...timed].sort((a, b) => a.startMs - b.startMs)) {
    const end = r.startMs + r.ms;
    if (r.startMs >= waveEnd) {
      waves += 1;
      waveEnd = end;
    } else {
      waveEnd = Math.max(waveEnd, end);
    }
  }
  return waves;
}

function tally(records) {
  const byTarget = new Map();
  let bytes = 0;
  let unknownBytes = 0;
  let errors = 0;
  for (const r of records) {
    if (typeof r.bytes === 'number') bytes += r.bytes;
    else unknownBytes += 1;
    if (r.status === 0 || r.status >= 400) errors += 1;
    const label = targetLabel(r);
    const entry = byTarget.get(label) ?? { target: label, count: 0, bytes: 0, ms: 0 };
    entry.count += 1;
    entry.bytes += typeof r.bytes === 'number' ? r.bytes : 0;
    entry.ms += typeof r.ms === 'number' ? r.ms : 0;
    byTarget.set(label, entry);
  }
  const targets = [...byTarget.values()]
    .map((t) => ({ ...t, ms: Math.round(t.ms) }))
    .sort((a, b) => b.count - a.count || b.bytes - a.bytes || a.target.localeCompare(b.target));
  return { queries: records.length, bytes, unknownBytes, errors, targets };
}

/** The report: totals, one row per request id (in first-seen order), one row per target. */
export function buildReport(records, { request = null } = {}) {
  const scoped = request === null ? records : records.filter((r) => r.requestId === request);
  const groups = new Map();
  for (const r of scoped) {
    const list = groups.get(r.requestId) ?? [];
    list.push(r);
    groups.set(r.requestId, list);
  }
  const requests = [...groups.entries()].map(([requestId, list]) => {
    const t = tally(list);
    return { requestId, queries: t.queries, waves: countWaves(list), bytes: t.bytes, unknownBytes: t.unknownBytes, errors: t.errors, top: t.targets.slice(0, 5) };
  });
  const total = tally(scoped);
  return { totals: { queries: total.queries, bytes: total.bytes, unknownBytes: total.unknownBytes, errors: total.errors, requestIds: requests.length }, requests, targets: total.targets };
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

export function formatReport(report) {
  const lines = [];
  const t = report.totals;
  lines.push(`meter: ${t.queries} Supabase requests across ${t.requestIds} request id(s), ${formatBytes(t.bytes)}${t.unknownBytes ? ` (+${t.unknownBytes} unmeasured)` : ''}${t.errors ? `, ${t.errors} error(s)` : ''}`);
  lines.push('', 'per request id:');
  for (const r of report.requests) {
    const top = r.top.map((x) => `${x.target}×${x.count}`).join(', ');
    lines.push(`  ${r.requestId}  q=${r.queries} waves≈${r.waves} bytes=${formatBytes(r.bytes)}${r.errors ? ` errors=${r.errors}` : ''}${top ? `  top: ${top}` : ''}`);
  }
  lines.push('', 'per target (count, bytes, total ms):');
  for (const x of report.targets) lines.push(`  ${x.target.padEnd(32)} ${String(x.count).padStart(6)}  ${formatBytes(x.bytes).padStart(9)}  ${String(x.ms).padStart(7)} ms`);
  return lines.join('\n');
}

export function parseArgs(argv) {
  const options = { file: null, json: false, request: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') options.json = true;
    else if (token === '--request') {
      const value = argv[i + 1];
      if (value === undefined) return { error: '--request needs a request id' };
      options.request = value;
      i += 1;
    } else if (token === '--help' || token === '-h') return { help: true };
    else if (token.startsWith('--')) return { error: `unknown option "${token}"` };
    else if (options.file === null) options.file = token;
    else return { error: `unexpected argument "${token}"` };
  }
  if (options.file === null) return { error: 'a log file (or - for stdin) is required' };
  return { options };
}

const USAGE = 'usage: meter-report.mjs <log file | -> [--json] [--request <id>]';

export function main(argv = process.argv.slice(2), { readInput = (file) => readFileSync(file === '-' ? 0 : file, 'utf8'), out = console.log, err = console.error } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    out(USAGE);
    return 0;
  }
  if (parsed.error) {
    err(`meter-report: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  const { records, malformed } = parseMeterLog(readInput(options.file));
  if (malformed > 0) err(`meter-report: skipped ${malformed} malformed [meter:rec] line(s)`);
  const report = buildReport(records, { request: options.request });
  if (report.totals.queries === 0) {
    err(`meter-report: no meter records${options.request ? ` for request id "${options.request}"` : ''} (was the dev server run with SUPABASE_METER=1?)`);
    return 1;
  }
  out(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return 0;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
