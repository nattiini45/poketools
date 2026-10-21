/**
 * DATA-PLAN §4: meter-report.mjs summarises `[meter:rec]` lines from a saved
 * dev-server log. Pure text in, text out: no network, no Supabase.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { METER_RECORD_PREFIX, buildReport, countWaves, formatReport, main, parseArgs, parseMeterLog } from '../meter-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function rec(partial) {
  return { requestId: '/leagues/abc', method: 'GET', kind: 'table', name: 'seasons', status: 200, bytes: 100, bytesSource: 'content-length', startMs: 0, ms: 10, ...partial };
}

const LOG = [
  '   ▲ Next.js 16 (dev)',
  ` GET /leagues/abc 200 in 812ms`,
  `${METER_RECORD_PREFIX}${JSON.stringify(rec({ name: 'seasons', startMs: 0, ms: 10, bytes: 2048 }))}`,
  `${METER_RECORD_PREFIX}${JSON.stringify(rec({ name: 'season_participants', startMs: 1, ms: 12, bytes: 4096 }))}`,
  `${METER_RECORD_PREFIX}${JSON.stringify(rec({ name: 'season_participants', startMs: 15, ms: 8, bytes: 4096 }))}`,
  `${METER_RECORD_PREFIX}${JSON.stringify(rec({ kind: 'rpc', name: 'process_aggregate_jobs', method: 'POST', startMs: 30, ms: 4, bytes: null, bytesSource: 'none' }))}`,
  `[meter] /leagues/abc  q=4 waves≈3 bytes=10.0KB`,
  `${METER_RECORD_PREFIX}${JSON.stringify(rec({ requestId: 'unscoped', name: 'players', status: 500, bytes: 64 }))}`,
  `${METER_RECORD_PREFIX}{not json`,
].join('\r\n');

describe('parseMeterLog', () => {
  it('keeps only [meter:rec] lines and counts malformed ones', () => {
    const { records, malformed } = parseMeterLog(LOG);
    expect(records).toHaveLength(5);
    expect(malformed).toBe(1);
    expect(records[0]).toMatchObject({ requestId: '/leagues/abc', name: 'seasons', bytes: 2048 });
  });

  it('matches the prefix the meter prints (src/lib/supabase/metering.ts)', () => {
    const source = readFileSync(resolve(here, '..', '..', '..', 'src', 'lib', 'supabase', 'metering.ts'), 'utf8');
    expect(source).toContain(`export const METER_RECORD_PREFIX = '${METER_RECORD_PREFIX}';`);
  });
});

describe('buildReport', () => {
  const { records } = parseMeterLog(LOG);

  it('summarises per request id: queries, waves, bytes, top targets', () => {
    const report = buildReport(records);
    expect(report.totals).toEqual({ queries: 5, bytes: 10304, unknownBytes: 1, errors: 1, requestIds: 2 });
    const league = report.requests.find((r) => r.requestId === '/leagues/abc');
    expect(league).toMatchObject({ queries: 4, waves: 3, bytes: 10240, unknownBytes: 1, errors: 0 });
    expect(league.top[0]).toMatchObject({ target: 'season_participants', count: 2, bytes: 8192 });
    expect(report.targets.map((t) => t.target)).toEqual(['season_participants', 'seasons', 'players', 'rpc:process_aggregate_jobs']);
  });

  it('filters to one request id', () => {
    const report = buildReport(records, { request: 'unscoped' });
    expect(report.totals.queries).toBe(1);
    expect(report.requests.map((r) => r.requestId)).toEqual(['unscoped']);
  });

  it('counts sequential waves', () => {
    expect(countWaves([rec({ startMs: 0, ms: 10 }), rec({ startMs: 5, ms: 10 }), rec({ startMs: 16, ms: 1 })])).toBe(2);
    expect(countWaves([])).toBe(0);
  });

  it('formats a readable report', () => {
    const text = formatReport(buildReport(records));
    expect(text).toContain('meter: 5 Supabase requests across 2 request id(s), 10.1KB (+1 unmeasured), 1 error(s)');
    expect(text).toContain('/leagues/abc  q=4 waves≈3 bytes=10.0KB  top: season_participants×2, seasons×1, rpc:process_aggregate_jobs×1');
    expect(text).toMatch(/season_participants\s+2\s+8\.0KB\s+20 ms/);
  });
});

describe('CLI', () => {
  it('parses arguments', () => {
    expect(parseArgs(['dev.log', '--json']).options).toEqual({ file: 'dev.log', json: true, request: null });
    expect(parseArgs(['-', '--request', '/x']).options).toEqual({ file: '-', json: false, request: '/x' });
    expect(parseArgs([]).error).toMatch(/log file/);
    expect(parseArgs(['a', 'b']).error).toMatch(/unexpected/);
    expect(parseArgs(['a', '--bogus']).error).toMatch(/unknown option/);
  });

  it('prints the report (or JSON) and exits 0; exits 1 with no records; 2 on usage errors', () => {
    const out = [];
    const err = [];
    const io = { readInput: () => LOG, out: (s) => out.push(s), err: (s) => err.push(s) };
    expect(main(['dev.log'], io)).toBe(0);
    expect(out.join('\n')).toContain('per request id:');
    expect(err.join('\n')).toContain('skipped 1 malformed');
    out.length = 0;
    expect(main(['dev.log', '--json'], io)).toBe(0);
    expect(JSON.parse(out[0]).totals.queries).toBe(5);
    expect(main(['dev.log'], { ...io, readInput: () => 'no meter here' })).toBe(1);
    expect(main([], io)).toBe(2);
  });
});
