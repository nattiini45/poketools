import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bindingInput, checkCall, createBindingRegistry, defineBinding, pathParamNames, validateBinding } from '../binding';
import type { RouteBinding } from '../types';

const load = async () => ({});

const read: RouteBinding = { operation: 'league_get', method: 'GET', path: '/api/seasons/[id]', class: 'R', load };
const draft: RouteBinding = { operation: 'format_save_draft', method: 'PUT', path: '/api/formats/[id]/draft', class: 'D', load };
const build: RouteBinding = {
  operation: 'league_create',
  method: 'POST',
  path: '/api/seasons',
  class: 'B',
  load,
  reversal: { kind: 'none' },
  verify: async () => ({ status: 'confirmed' }),
};
const golive: RouteBinding = {
  operation: 'start_phase',
  method: 'POST',
  path: '/api/generate-round/[tid]',
  class: 'G',
  load,
  outwardEffects: [{ group: 'discord', events: ['round.generated'] }],
  verify: async () => ({ status: 'confirmed' }),
};

describe('validateBinding', () => {
  it('accepts a well formed binding of every class', () => {
    for (const binding of [read, draft, build, golive]) expect(validateBinding(binding)).toEqual([]);
  });

  it('accepts a G binding with an empty outwardEffects list and a compensating reversal', () => {
    expect(validateBinding({ ...golive, outwardEffects: [] })).toEqual([]);
    const reversible: RouteBinding = {
      ...build,
      reversal: { kind: 'compensating', operation: 'league_archive', buildInput: () => ({ params: { id: 'x' } }) },
    };
    expect(validateBinding(reversible)).toEqual([]);
  });

  it.each([
    ['an operation that is not snake_case', { operation: 'League-Create' }, 'operation must be snake_case'],
    ['an unknown method', { method: 'TRACE' as never }, 'unknown method'],
    ['an unknown class', { class: 'N' as never }, 'unknown class'],
    ['a path outside /api', { path: '/admin/seasons' }, 'path must be a /api'],
    ['a catch-all segment', { path: '/api/seasons/[...slug]' }, 'path must be a /api'],
    ['a query in the path', { path: '/api/seasons?x=1' }, 'path must be a /api'],
    ['a dot-dot segment', { path: '/api/seasons/../admin' }, 'must not contain . or .. segments'],
    ['a repeated placeholder', { path: '/api/a/[id]/b/[id]' }, 'repeats a placeholder'],
    ['a timeout that is too short', { timeoutMs: 10 }, 'timeoutMs must be an integer'],
    ['a timeout that is too long', { timeoutMs: 400_000 }, 'timeoutMs must be an integer'],
    ['a fractional timeout', { timeoutMs: 1500.5 }, 'timeoutMs must be an integer'],
    ['a GET write', { method: 'GET' as const, class: 'D' as const }, 'a GET route cannot be class D'],
  ])('refuses %s', (_name, patch, message) => {
    expect(validateBinding({ ...draft, ...patch }).join('\n')).toContain(message);
  });

  it('requires outwardEffects and verify on G, reversal and verify on B', () => {
    expect(validateBinding({ ...golive, outwardEffects: undefined }).join('\n')).toContain('must declare outwardEffects');
    expect(validateBinding({ ...golive, verify: undefined }).join('\n')).toContain('class G must declare verify');
    expect(validateBinding({ ...build, reversal: undefined }).join('\n')).toContain('must declare reversal');
    expect(validateBinding({ ...build, verify: undefined }).join('\n')).toContain('class B must declare verify');
  });

  it('requires buildInput on a compensating reversal', () => {
    const broken = { ...build, reversal: { kind: 'compensating', operation: 'x' } } as unknown as RouteBinding;
    expect(validateBinding(broken).join('\n')).toContain('must declare buildInput');
  });
});

describe('pathParamNames and bindingInput', () => {
  it('lists placeholders in order', () => {
    expect(pathParamNames('/api/seasons/[id]/phases/[phaseId]/participants')).toEqual(['id', 'phaseId']);
    expect(pathParamNames('/api/seasons')).toEqual([]);
  });

  it('applies the builders to the step args', () => {
    const binding = defineBinding<{ id: string; name: string; page?: number }>({
      operation: 'phase_create',
      method: 'POST',
      path: '/api/seasons/[id]/phases',
      class: 'D',
      load,
      buildParams: (args) => ({ id: args.id }),
      buildQuery: (args) => ({ page: args.page }),
      buildBody: (args) => ({ name: args.name }),
    });
    expect(bindingInput(binding, { id: 's1', name: 'Group A', page: 2 })).toEqual({
      params: { id: 's1' },
      query: { page: 2 },
      body: { name: 'Group A' },
    });
    expect(bindingInput(read, undefined)).toEqual({ params: undefined, query: undefined, body: undefined });
  });

  it('lets a typed binding sit in an untyped registry array', () => {
    const typed = defineBinding<{ id: string }>({ ...draft, buildParams: (args) => ({ id: args.id }) });
    const registry: RouteBinding[] = [typed];
    expect(registry).toHaveLength(1);
  });
});

describe('createBindingRegistry', () => {
  it('indexes bindings by operation', () => {
    const registry = createBindingRegistry([read, draft, build]);
    expect(registry.get('league_get')).toBe(read);
    expect(registry.has('format_save_draft')).toBe(true);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('toString')).toBe(false);
    expect(registry.all().map((b) => b.operation)).toEqual(['league_get', 'format_save_draft', 'league_create']);
  });

  it('throws, listing every problem, for a malformed binding, a duplicate and an unknown reversal target', () => {
    const bad: RouteBinding = { ...draft, operation: 'Bad Op' };
    const reversing: RouteBinding = {
      ...build,
      operation: 'league_create_2',
      reversal: { kind: 'compensating', operation: 'missing_op', buildInput: () => ({}) },
    };
    expect(() => createBindingRegistry([bad, read, read, reversing])).toThrowError(/operation must be snake_case[\s\S]*league_get: registered twice[\s\S]*unknown operation missing_op/);
  });

  it('accepts a reversal that names another registered operation', () => {
    const archive: RouteBinding = { ...draft, operation: 'league_archive' };
    const create: RouteBinding = { ...build, reversal: { kind: 'compensating', operation: 'league_archive', buildInput: () => ({}) } };
    expect(() => createBindingRegistry([create, archive])).not.toThrow();
  });
});

describe('checkCall', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  const fits: RouteBinding = {
    ...build,
    operation: 'phase_create',
    path: '/api/seasons/[id]/phases',
    paramsSchema: z.strictObject({ id: z.uuid() }),
    bodySchema: z.strictObject({ name: z.string().max(5) }),
  };

  it('accepts a request that parses with both schemas', () => {
    expect(checkCall(fits, { params: { id: uuid }, body: { name: 'Group' } })).toEqual({ ok: true });
  });

  it('refuses an extra body key and a body value out of range, naming the paths and codes but not the values', () => {
    const extra = checkCall(fits, { params: { id: uuid }, body: { name: 'A', secret: 'hunter2' } });
    expect(extra).toEqual({ ok: false, reason: 'body', issues: ['body:unrecognized_keys'] });
    const long = checkCall(fits, { params: { id: uuid }, body: { name: 'far too long' } });
    expect(long).toEqual({ ok: false, reason: 'body', issues: ['body.name:too_big'] });
    expect(JSON.stringify([extra, long])).not.toMatch(/hunter2|far too long/);
  });

  it('refuses a path id that is not a uuid, before it looks at the body', () => {
    expect(checkCall(fits, { params: { id: '../admin' }, body: { name: 'A' } })).toEqual({ ok: false, reason: 'params', issues: ['params.id:invalid_format'] });
    expect(checkCall(fits, { params: {}, body: { name: 'A' } })).toMatchObject({ ok: false, reason: 'params' });
  });

  it('refuses a binding that declares no schema for what the step carries (fail closed)', () => {
    expect(checkCall({ ...fits, paramsSchema: undefined }, { params: { id: uuid }, body: { name: 'A' } })).toEqual({ ok: false, reason: 'no_schema', issues: ['params'] });
    expect(checkCall({ ...fits, bodySchema: undefined }, { params: { id: uuid }, body: { name: 'A' } })).toEqual({ ok: false, reason: 'no_schema', issues: ['body'] });
  });

  it('needs no params schema for a path without parameters, and takes null as "no body"', () => {
    const root: RouteBinding = { ...build, bodySchema: null };
    expect(checkCall(root, { params: {}, body: undefined })).toEqual({ ok: true });
    expect(checkCall(root, { params: {}, body: null })).toEqual({ ok: true });
    expect(checkCall(root, { params: {}, body: { a: 1 } })).toEqual({ ok: false, reason: 'body', issues: ['body:not_empty'] });
  });

  it('caps the issue list', () => {
    const wide: RouteBinding = { ...build, bodySchema: z.strictObject(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, z.string()]))) };
    const result = checkCall(wide, { params: {}, body: {} });
    expect(result.ok === false && result.issues).toHaveLength(8);
  });
});
