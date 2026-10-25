/**
 * Test-only in-memory stand-in for the service-role Supabase client.
 *
 * It records every `.from()` / `.rpc()` call (the query budget) and answers
 * from fixture tables, applying the flat `eq` / `in` / `is` filters, `order`,
 * `range` (an inclusive offset window, as PostgREST reads it) and `limit` the
 * query modules use. Rows are returned whole (the query
 * modules' mappers pick their fields), except where a select string changes
 * the SHAPE PostgREST would send back:
 *   - `child ( count )` embeds become `[{ count: n }]`;
 *   - JSON-path columns (`alias:col->0->>key`) are resolved per row;
 *   - `players ( a, b )` embeds are narrowed to the listed columns, so a
 *     narrow select really does hand the mapper nothing else.
 *
 * Never talks to a network. Not a test file itself (no `.test.` suffix).
 */

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

export interface RecordedQuery {
  table: string;
  kind: 'from' | 'rpc';
  select: string | null;
  filters: Array<{ op: 'eq' | 'in' | 'is' | 'neq'; column: string; value: unknown }>;
  orders: Array<{ column: string; ascending: boolean }>;
  limit: number | null;
  /** Inclusive row window from `.range(from, to)`; null when not called. */
  range?: { from: number; to: number } | null;
  single: 'single' | 'maybeSingle' | null;
  args?: Record<string, unknown>;
}

type Resolved = { data: unknown; error: null; count?: number | null };

function compact(select: string): string {
  return select.replace(/\s+/g, ' ').trim();
}

/** Resolve `col->0->>key` / `col->key` style JSON paths against one row. */
function readJsonPath(row: FakeRow, path: string): unknown {
  const parts = path.split(/->>?/);
  let value: unknown = row[parts[0]];
  for (const raw of parts.slice(1)) {
    if (value === null || value === undefined) return null;
    const key: string | number = /^\d+$/.test(raw) ? Number(raw) : raw;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value === undefined ? null : value;
}

/** Top-level comma split that respects parentheses. */
function splitTopLevel(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function project(row: FakeRow, select: string | null): FakeRow {
  if (!select) return row;
  const items = splitTopLevel(select);
  // A select without `*` projects to the named items only (PostgREST semantics).
  const hasStar = items.includes('*');
  const result: FakeRow = hasStar ? { ...row } : {};
  for (const item of items) {
    if (item === '*') continue;
    const embed = /^(?:(\w+):)?([\w!]+)\s*\((.*)\)$/s.exec(item);
    if (embed) {
      const alias = embed[1];
      const relation = embed[2].split('!')[0];
      const inner = embed[3].trim();
      const key = alias ?? relation;
      const source = row[alias ?? relation] ?? row[relation];
      if (inner === 'count') {
        result[key] = [{ count: Array.isArray(source) ? source.length : source ? 1 : 0 }];
        continue;
      }
      if (inner === '*' || source === null || source === undefined) {
        result[key] = source ?? null;
        continue;
      }
      const innerItems = splitTopLevel(inner);
      const pick = (child: FakeRow): FakeRow => project(child, innerItems.join(', '));
      result[key] = Array.isArray(source) ? source.map((c) => pick(c as FakeRow)) : pick(source as FakeRow);
      continue;
    }
    const aliased = /^(\w+):(.+)$/.exec(item);
    const alias = aliased ? aliased[1] : null;
    const expr = aliased ? aliased[2].trim() : item;
    if (expr.includes('->')) {
      result[alias ?? expr] = readJsonPath(row, expr);
    } else {
      result[alias ?? expr] = row[expr];
    }
  }
  return result;
}

export interface FakeSupabase {
  client: {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<Resolved>;
  };
  queries: RecordedQuery[];
  reset: () => void;
}

export interface FakeSupabaseOptions {
  /** Caps every list response after range and limit, like PostgREST `max_rows`. Unset = no cap. */
  maxRows?: number;
}

export function createFakeSupabase(
  tables: FakeTables,
  rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {},
  options: FakeSupabaseOptions = {},
): FakeSupabase {
  const queries: RecordedQuery[] = [];

  function run(q: RecordedQuery): Resolved {
    let rows = [...(tables[q.table] ?? [])];
    for (const f of q.filters) {
      if (f.column.includes('.')) continue; // embedded filters: fixtures are pre-scoped
      rows = rows.filter((row) => {
        const v = row[f.column];
        if (f.op === 'eq') return v === f.value;
        if (f.op === 'neq') return v !== f.value;
        if (f.op === 'is') return v === f.value;
        return (f.value as unknown[]).includes(v);
      });
    }
    if (q.orders.length > 0) {
      rows.sort((a, b) => {
        for (const o of q.orders) {
          const av = a[o.column] as string | number;
          const bv = b[o.column] as string | number;
          if (av === bv) continue;
          const cmp = av < bv ? -1 : 1;
          return o.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (q.range) rows = rows.slice(q.range.from, q.range.to + 1);
    if (q.limit !== null) rows = rows.slice(0, q.limit);
    if (options.maxRows !== undefined && !q.single) rows = rows.slice(0, options.maxRows);
    const projected = rows.map((row) => project(row, q.select));
    if (q.single) {
      return { data: projected[0] ?? null, error: null };
    }
    return { data: projected, error: null };
  }

  function from(table: string) {
    const q: RecordedQuery = {
      table,
      kind: 'from',
      select: null,
      filters: [],
      orders: [],
      limit: null,
      single: null,
    };
    queries.push(q);
    const builder: Record<string, unknown> = {};
    const chain = (fn: (...args: never[]) => void) =>
      (...args: never[]) => {
        fn(...args);
        return builder;
      };
    Object.assign(builder, {
      select: chain((s: string) => {
        q.select = compact(s ?? '*');
      }),
      eq: chain((column: string, value: unknown) => {
        q.filters.push({ op: 'eq', column, value });
      }),
      neq: chain((column: string, value: unknown) => {
        q.filters.push({ op: 'neq', column, value });
      }),
      in: chain((column: string, value: unknown[]) => {
        q.filters.push({ op: 'in', column, value });
      }),
      is: chain((column: string, value: unknown) => {
        q.filters.push({ op: 'is', column, value });
      }),
      order: chain((column: string, opts?: { ascending?: boolean }) => {
        q.orders.push({ column, ascending: opts?.ascending !== false });
      }),
      limit: chain((n: number) => {
        q.limit = n;
      }),
      range: chain((from: number, to: number) => {
        q.range = { from, to };
      }),
      or: chain(() => {}),
      not: chain(() => {}),
      contains: chain(() => {}),
      filter: chain(() => {}),
      gt: chain(() => {}),
      gte: chain(() => {}),
      lt: chain(() => {}),
      lte: chain(() => {}),
      maybeSingle: () => {
        q.single = 'maybeSingle';
        return Promise.resolve(run(q));
      },
      single: () => {
        q.single = 'single';
        return Promise.resolve(run(q));
      },
      then: (onFulfilled: (v: Resolved) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(run(q)).then(onFulfilled, onRejected),
    });
    return builder;
  }

  async function rpc(fn: string, args: Record<string, unknown> = {}): Promise<Resolved> {
    queries.push({
      table: fn,
      kind: 'rpc',
      select: null,
      filters: [],
      orders: [],
      limit: null,
      single: null,
      args,
    });
    const handler = rpcHandlers[fn];
    return { data: handler ? handler(args) : null, error: null };
  }

  return {
    client: { from, rpc },
    queries,
    reset: () => {
      queries.length = 0;
    },
  };
}
