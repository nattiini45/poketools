import { vi } from 'vitest';

/**
 * A fake service-role client for query-module tests: no network. Every `from(table)` chain records its builder
 * calls and resolves with the next queued result; `rpc`, Storage and GoTrue admin calls record their arguments and
 * resolve with their own queues. Wire it in with
 * `vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }))`.
 */
type Call = [method: string, args: unknown[]];
export interface RecordedQuery {
  table: string;
  calls: Call[];
}
export interface QueryResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}
export interface RecordedStorageCall {
  bucket: string;
  method: string;
  args: unknown[];
}

const state = {
  queries: [] as RecordedQuery[],
  results: [] as QueryResult[],
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  rpcResults: [] as QueryResult[],
  storage: [] as RecordedStorageCall[],
  storageResults: [] as QueryResult[],
  authAdmin: [] as Array<{ method: string; args: unknown[] }>,
  authAdminResults: [] as QueryResult[],
};

function builder(entry: RecordedQuery): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          const result = state.results.shift() ?? { data: null, error: null };
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null, count: null, ...result }).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          entry.calls.push([String(prop), args]);
          return proxy;
        };
      },
    }
  );
  return proxy;
}

export const mock = {
  state,
  supabase: {
    from: (table: string) => {
      const entry: RecordedQuery = { table, calls: [] };
      state.queries.push(entry);
      return builder(entry);
    },
    rpc: (fn: string, args: unknown) => {
      state.rpcs.push({ fn, args });
      const result = state.rpcResults.shift() ?? { data: null, error: null };
      return Promise.resolve({ data: null, error: null, ...result });
    },
    storage: {
      from: (bucket: string) => {
        const record = (method: string, fallback: QueryResult) =>
          vi.fn(async (...args: unknown[]) => {
            state.storage.push({ bucket, method, args });
            return { ...fallback, ...(state.storageResults.shift() ?? {}) };
          });
        return {
          upload: record('upload', { data: { path: 'p' }, error: null }),
          remove: record('remove', { data: [], error: null }),
          getPublicUrl: (path: string) => {
            state.storage.push({ bucket, method: 'getPublicUrl', args: [path] });
            return { data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
        };
      },
    },
    auth: {
      admin: new Proxy(
        {},
        {
          get: (_target, method) => async (...args: unknown[]) => {
            state.authAdmin.push({ method: String(method), args });
            return { data: null, error: null, ...(state.authAdminResults.shift() ?? {}) };
          },
        }
      ),
    },
  },
};

export function resetQueryMock(): void {
  state.queries = [];
  state.results = [];
  state.rpcs = [];
  state.rpcResults = [];
  state.storage = [];
  state.storageResults = [];
  state.authAdmin = [];
  state.authAdminResults = [];
}

/** The recorded builder calls of query `index`, as `method(args)` pairs keyed by method name. */
export function callsOf(index: number): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [method, args] of state.queries[index]?.calls ?? []) out[method] = args;
  return out;
}
