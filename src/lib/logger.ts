type LogLevel = 'info' | 'warn' | 'error';

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  code?: string;
  /** Supabase / Postgres error details and hint. */
  details?: string;
  hint?: string;
  cause?: SerializedError;
}

const MAX_CAUSE_DEPTH = 3;
const RESERVED_KEYS = new Set(['timestamp', 'level', 'tag', 'message']);

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Log fields for a thrown value. `JSON.stringify(new Error('x'))` is `{}`, and
 * supabase-js throws a `PostgrestError`, a plain object (not an `Error`) whose
 * `String()` is "[object Object]", so `message`, `code`, `details` and `hint`
 * are read directly from any object.
 */
export function serializeError(err: unknown, depth = 0): SerializedError {
  if (typeof err !== 'object' || err === null) return { message: String(err) };

  const fields = err as Record<string, unknown>;
  const message = stringField(fields.message) ?? 'unknown error';
  const code = typeof fields.code === 'string' || typeof fields.code === 'number' ? String(fields.code) : undefined;
  const cause =
    fields.cause !== undefined && fields.cause !== null && depth < MAX_CAUSE_DEPTH
      ? serializeError(fields.cause, depth + 1)
      : undefined;

  return {
    ...(err instanceof Error ? { name: err.name } : stringField(fields.name) ? { name: String(fields.name) } : {}),
    message,
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(stringField(fields.details) ? { details: String(fields.details) } : {}),
    ...(stringField(fields.hint) ? { hint: String(fields.hint) } : {}),
    ...(cause ? { cause } : {}),
  };
}

function normalizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!meta) return out;
  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_KEYS.has(key)) continue;
    // An `error` key always holds a caught value, which may be a plain object.
    if (value instanceof Error || (key === 'error' && typeof value === 'object' && value !== null)) {
      out[key] = serializeError(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function stringify(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry);
  } catch {
    // A circular or BigInt meta value must not turn a log call into a throw.
    return JSON.stringify({
      timestamp: entry.timestamp,
      level: entry.level,
      tag: entry.tag,
      message: entry.message,
      meta: 'unserializable',
    });
  }
}

function log(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>) {
  const line = stringify({ timestamp: new Date().toISOString(), level, tag, message, ...normalizeMeta(meta) });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const logger = {
  info: (tag: string, message: string, meta?: Record<string, unknown>) => log('info', tag, message, meta),
  warn: (tag: string, message: string, meta?: Record<string, unknown>) => log('warn', tag, message, meta),
  error: (tag: string, message: string, meta?: Record<string, unknown>) => log('error', tag, message, meta),
};
