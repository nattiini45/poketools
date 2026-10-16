import { vi } from 'vitest';

/**
 * Chainable Supabase mock factory.
 *
 * Every builder method (.from, .select, .eq, .neq, .in, .order, .limit, etc.)
 * returns `this` so chains resolve naturally.  Terminal methods (.single,
 * .maybeSingle, and the implicit await via .then) resolve to the configured
 * result set via `setResult()` / `setError()`.
 *
 * Usage:
 *   vi.mock('@/lib/supabase/client', () => ({ supabase: createMockSupabase() }));
 *   import { supabase } from '@/lib/supabase/client';
 *   const mock = supabase as unknown as ReturnType<typeof createMockSupabase>;
 *   mock.__setResult([{ id: '1' }]);
 */
type MockResult = { data: unknown; error: null } | { data: null; error: Error };

interface MockSupabaseClient extends Record<string, unknown> {
  __setResult: (data: unknown) => void;
  __setError: (error: Error) => void;
  __reset: () => void;
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

export function createMockSupabase(): MockSupabaseClient {
  let currentResult: MockResult = {
    data: [],
    error: null,
  };

  const builder: Record<string, unknown> = {};

  // Chain methods — return the builder itself
  const chainMethods = [
    'from',
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'ilike',
    'is',
    'in',
    'contains',
    'containedBy',
    'filter',
    'not',
    'or',
    'order',
    'limit',
    'range',
    'match',
    'textSearch',
    'csv',
    'returns',
    'throwOnError',
    'rpc',
  ];

  for (const method of chainMethods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // Terminal methods — resolve to the configured result
  builder.single = vi.fn().mockImplementation(() => {
    const result = currentResult;
    // For single(), unwrap data array to single item
    if (result.data && Array.isArray(result.data)) {
      return Promise.resolve({ data: result.data[0] ?? null, error: result.error });
    }
    return Promise.resolve(result);
  });

  builder.maybeSingle = vi.fn().mockImplementation(() => {
    const result = currentResult;
    if (result.data && Array.isArray(result.data)) {
      return Promise.resolve({ data: result.data[0] ?? null, error: result.error });
    }
    return Promise.resolve(result);
  });

  // .then — makes the builder "thenable" so `await query` works
  builder.then = vi.fn().mockImplementation(
    (resolve: (value: unknown) => void) => resolve(currentResult)
  );

  // Control methods — set what the next query returns
  const mockClient = builder as MockSupabaseClient;

  mockClient.__setResult = (data: unknown) => {
    currentResult = { data, error: null };
  };

  mockClient.__setError = (error: Error) => {
    currentResult = { data: null, error };
  };

  mockClient.__reset = () => {
    currentResult = { data: [], error: null };
    for (const method of chainMethods) {
      (builder[method] as ReturnType<typeof vi.fn>).mockClear();
    }
    (builder.single as ReturnType<typeof vi.fn>).mockClear();
    (builder.maybeSingle as ReturnType<typeof vi.fn>).mockClear();
    (builder.then as ReturnType<typeof vi.fn>).mockClear();
  };

  return mockClient;
}
