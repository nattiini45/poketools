/**
 * Supabase request meter (DATA-PLAN §4, D36): counts the requests and bytes
 * the one server client (`client.ts`) sends, per request id.
 *
 * Dev and local measurement only. `client.ts` installs it as
 * `global.fetch` ONLY when `SUPABASE_METER=1` and `NODE_ENV !== 'production'`;
 * otherwise nothing here runs. Measure against a local `supabase start`
 * stack, never against the live project (AGENTS.md: automation never spends
 * the Supabase quota).
 *
 * Output (the log sink): one `[meter:rec] {json}` line per Supabase request,
 * and, once a request id has been quiet for `idleMs`, one human summary:
 *   [meter] /leagues/abc q=29 waves≈11 bytes=1.4MB top: season_participants×3 …
 * `scripts/data/meter-report.mjs` summarises a saved log.
 *
 * Request ids come from an AsyncLocalStorage scope: wrap a unit of work in
 * `runWithMeterRequest(id, fn)` for exact attribution. Unscoped requests are
 * grouped under `unscoped` and summarised per burst.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type MeterTargetKind = 'table' | 'rpc' | 'storage' | 'auth' | 'other';

export interface MeterTarget {
  kind: MeterTargetKind;
  /** Table (`/rest/v1/<t>`), function (`/rest/v1/rpc/<fn>`), storage bucket, or null. */
  name: string | null;
}

export interface MeterRecord {
  requestId: string;
  method: string;
  kind: MeterTargetKind;
  name: string | null;
  /** HTTP status; 0 when the fetch itself threw. */
  status: number;
  /** Response body bytes: `content-length` when sent, else the length of a buffered clone. */
  bytes: number | null;
  bytesSource: 'content-length' | 'body' | 'none';
  /** Start time on the meter clock (ms), for the wave estimate. */
  startMs: number;
  /** Time to response headers (ms). */
  ms: number;
  /** Set when the fetch threw; the error is rethrown to the caller unchanged. */
  error?: string;
}

export interface MeterSink {
  record(entry: MeterRecord): void;
}

/** `fetch` plus `idle()`, which settles once every pending body measurement has been recorded. */
export type MeteredFetch = typeof fetch & { idle(): Promise<void> };

export const UNSCOPED_REQUEST_ID = 'unscoped';
/** Prefix of the per-request log line; `scripts/data/meter-report.mjs` parses it. */
export const METER_RECORD_PREFIX = '[meter:rec] ';

// Created on first use, so importing this module (client.ts always does)
// allocates nothing while the meter is off.
let meterScope: AsyncLocalStorage<{ requestId: string }> | null = null;

/** Run `fn` with every Supabase request inside it attributed to `requestId`. */
export function runWithMeterRequest<T>(requestId: string, fn: () => T): T {
  meterScope ??= new AsyncLocalStorage<{ requestId: string }>();
  return meterScope.run({ requestId }, fn);
}

export function currentMeterRequestId(): string {
  return meterScope?.getStore()?.requestId ?? UNSCOPED_REQUEST_ID;
}

/** The gate `client.ts` applies: metering only with SUPABASE_METER=1 outside production. */
export function isMeterEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.SUPABASE_METER === '1' && env.NODE_ENV !== 'production';
}

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** What a Supabase URL addresses: `/rest/v1/<table>`, `/rest/v1/rpc/<fn>`, storage, auth. */
export function parseSupabaseTarget(url: string): MeterTarget {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { kind: 'other', name: null };
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'rest' && parts[1] === 'v1') {
    if (parts[2] === 'rpc') return { kind: 'rpc', name: decodeSegment(parts[3]) };
    return { kind: 'table', name: decodeSegment(parts[2]) };
  }
  if (parts[0] === 'storage' && parts[1] === 'v1') {
    // /storage/v1/object/[public|sign|authenticated|info/]<bucket>/<path>
    if (parts[2] === 'object') {
      const scoped = ['public', 'sign', 'authenticated', 'info', 'list'].includes(parts[3] ?? '');
      return { kind: 'storage', name: decodeSegment(scoped ? parts[4] : parts[3]) };
    }
    return { kind: 'storage', name: null };
  }
  if (parts[0] === 'auth' && parts[1] === 'v1') return { kind: 'auth', name: null };
  return { kind: 'other', name: null };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === 'object' && !(input instanceof URL) && typeof input.method === 'string') return input.method.toUpperCase();
  return 'GET';
}

function recordSafely(sink: MeterSink, entry: MeterRecord): void {
  try {
    sink.record(entry);
  } catch (err) {
    // A broken sink must never break the query it measures; it is still reported.
    console.error('[meter] sink failed to record a request:', err);
  }
}

/**
 * Wrap `inner` so every request is recorded into `sink` under the current
 * request id. The response the caller gets is `inner`'s own response; the
 * body is measured on a clone, off the caller's path. Errors from `inner`
 * are recorded (status 0) and rethrown unchanged.
 */
export function createMeteredFetch(inner: typeof fetch, sink: MeterSink, now: () => number = () => performance.now()): MeteredFetch {
  const pending = new Set<Promise<void>>();

  const metered = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestId = currentMeterRequestId();
    const method = requestMethod(input, init);
    const target = parseSupabaseTarget(requestUrl(input));
    const startMs = now();
    let response: Response;
    try {
      response = await inner(input, init);
    } catch (err) {
      recordSafely(sink, {
        requestId,
        method,
        ...target,
        status: 0,
        bytes: null,
        bytesSource: 'none',
        startMs,
        ms: now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    const base = { requestId, method, ...target, status: response.status, startMs, ms: now() - startMs };

    const header = response.headers.get('content-length');
    const declared = header === null ? Number.NaN : Number(header);
    if (Number.isFinite(declared) && declared >= 0) {
      recordSafely(sink, { ...base, bytes: declared, bytesSource: 'content-length' });
      return response;
    }
    if (response.body === null) {
      recordSafely(sink, { ...base, bytes: 0, bytesSource: 'body' });
      return response;
    }
    const measured = response
      .clone()
      .arrayBuffer()
      .then(
        (buffer) => recordSafely(sink, { ...base, bytes: buffer.byteLength, bytesSource: 'body' }),
        () => recordSafely(sink, { ...base, bytes: null, bytesSource: 'none' }),
      );
    pending.add(measured);
    void measured.finally(() => pending.delete(measured));
    return response;
  };

  const idle = async (): Promise<void> => {
    while (pending.size > 0) await Promise.all([...pending]);
  };

  return Object.assign(metered, { idle }) as MeteredFetch;
}

// ---------------------------------------------------------------------------
// Summaries and the log sink
// ---------------------------------------------------------------------------

export interface MeterTopEntry {
  name: string;
  count: number;
  bytes: number;
}

export interface MeterSummary {
  queries: number;
  /** Sequential rounds: a wave starts when a request starts after every request of the previous wave finished. */
  waves: number;
  bytes: number;
  /** Requests whose body size could not be measured. */
  unknownBytes: number;
  errors: number;
  top: MeterTopEntry[];
}

function targetLabel(record: Pick<MeterRecord, 'kind' | 'name'>): string {
  if (record.kind === 'table') return record.name ?? '(table)';
  if (record.kind === 'rpc') return `rpc:${record.name ?? '?'}`;
  if (record.kind === 'storage') return `storage:${record.name ?? '?'}`;
  return record.kind;
}

export function summarizeMeterRecords(records: readonly MeterRecord[], topN = 5): MeterSummary {
  let waves = 0;
  let waveEnd = Number.NEGATIVE_INFINITY;
  for (const r of [...records].sort((a, b) => a.startMs - b.startMs)) {
    const end = r.startMs + r.ms;
    if (r.startMs >= waveEnd) {
      waves += 1;
      waveEnd = end;
    } else {
      waveEnd = Math.max(waveEnd, end);
    }
  }
  const byTarget = new Map<string, MeterTopEntry>();
  let bytes = 0;
  let unknownBytes = 0;
  let errors = 0;
  for (const r of records) {
    if (r.bytes === null) unknownBytes += 1;
    else bytes += r.bytes;
    if (r.status === 0 || r.status >= 400) errors += 1;
    const label = targetLabel(r);
    const entry = byTarget.get(label) ?? { name: label, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += r.bytes ?? 0;
    byTarget.set(label, entry);
  }
  const top = [...byTarget.values()].sort((a, b) => b.count - a.count || b.bytes - a.bytes || a.name.localeCompare(b.name)).slice(0, topN);
  return { queries: records.length, waves, bytes, unknownBytes, errors, top };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

export function formatMeterLine(requestId: string, summary: MeterSummary): string {
  const top = summary.top.map((t) => `${t.name}×${t.count}`).join(', ');
  const unknown = summary.unknownBytes > 0 ? ` (+${summary.unknownBytes} unmeasured)` : '';
  const errors = summary.errors > 0 ? ` errors=${summary.errors}` : '';
  return `[meter] ${requestId}  q=${summary.queries} waves≈${summary.waves} bytes=${formatBytes(summary.bytes)}${unknown}${errors}${top ? `  top: ${top}` : ''}`;
}

export interface LogMeterSink extends MeterSink {
  /** Print the summary of every request id that has records, now. */
  flush(): void;
}

/**
 * Sink that logs each record (`[meter:rec] {json}`) and, after a request id
 * has been quiet for `idleMs`, its summary line. Timers are unref'd, so the
 * sink never keeps a process alive.
 */
export function createLogMeterSink({ log = (line: string) => console.log(line), idleMs = 500, emitRecords = true }: { log?: (line: string) => void; idleMs?: number; emitRecords?: boolean } = {}): LogMeterSink {
  const open = new Map<string, { records: MeterRecord[]; timer: ReturnType<typeof setTimeout> | null }>();

  const flushOne = (requestId: string) => {
    const group = open.get(requestId);
    if (!group) return;
    if (group.timer) clearTimeout(group.timer);
    open.delete(requestId);
    if (group.records.length > 0) log(formatMeterLine(requestId, summarizeMeterRecords(group.records)));
  };

  return {
    record(entry) {
      if (emitRecords) log(`${METER_RECORD_PREFIX}${JSON.stringify(entry)}`);
      const group = open.get(entry.requestId) ?? { records: [], timer: null };
      group.records.push(entry);
      if (group.timer) clearTimeout(group.timer);
      const timer = setTimeout(() => flushOne(entry.requestId), idleMs);
      (timer as { unref?: () => void }).unref?.();
      group.timer = timer;
      open.set(entry.requestId, group);
    },
    flush() {
      for (const requestId of [...open.keys()]) flushOne(requestId);
    },
  };
}
