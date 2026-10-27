/**
 * Binding helpers: the shape check the registry tests share (plan 3.9 test 6) and the injected registry
 * (`createAdminAgent({ ops })`, plan 3.2).
 *
 * Nothing here imports a route. A binding carries its own lazy `load()`; the registry only indexes bindings by
 * `operation`, so the core stays testable without Next.
 */
import {
  ACTION_CLASSES,
  HTTP_METHODS,
  MAX_ROUTE_TIMEOUT_MS,
  MIN_ROUTE_TIMEOUT_MS,
  type DispatchInput,
  type RouteBinding,
} from './types';

const OPERATION = /^[a-z][a-z0-9_]{0,63}$/;
const PARAM_SEGMENT = /\[([A-Za-z_][A-Za-z0-9_]*)\]/g;
const PATH_SHAPE = /^\/api(\/([A-Za-z0-9_.~-]+|\[[A-Za-z_][A-Za-z0-9_]*\]))+$/;

/** Identity helper: infers `TArgs` from the builders and checks the literal against `RouteBinding`. */
export function defineBinding<TArgs>(binding: RouteBinding<TArgs>): RouteBinding<TArgs> {
  return binding;
}

/** The `[name]` placeholders of a path pattern, in order. */
export function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(PARAM_SEGMENT), (match) => match[1] as string);
}

/**
 * Problems with a binding's declaration, empty when it is well formed. Checked at registry creation and by the static
 * tests, never at dispatch time (a bad binding must fail the build, not an admin's request).
 *
 * - `operation` is snake_case; `method` and `class` are known; `path` is a plain `/api/...` pattern with `[name]`
 *   segments (no catch-all, no query, no `.` or `..` segment).
 * - `timeoutMs`, when set, is an integer within bounds.
 * - A GET route is never class D, B or G.
 * - Class G declares `outwardEffects` (an empty list says none) and `verify`; class B declares `reversal` (`{ kind:
 *   'none' }` says none) and `verify`.
 */
export function validateBinding(binding: RouteBinding): string[] {
  const problems: string[] = [];
  const name = typeof binding.operation === 'string' ? binding.operation : '(unnamed)';
  const fail = (message: string) => problems.push(`${name}: ${message}`);

  if (!OPERATION.test(binding.operation)) fail('operation must be snake_case (^[a-z][a-z0-9_]{0,63}$)');
  if (!(HTTP_METHODS as readonly string[]).includes(binding.method)) fail(`unknown method ${String(binding.method)}`);
  if (!(ACTION_CLASSES as readonly string[]).includes(binding.class)) fail(`unknown class ${String(binding.class)}`);
  if (typeof binding.load !== 'function') fail('load must be a function');

  if (typeof binding.path !== 'string' || !PATH_SHAPE.test(binding.path)) {
    fail('path must be a /api/... pattern of plain segments and [name] placeholders');
  } else {
    const segments = binding.path.split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) fail('path must not contain . or .. segments');
    const names = pathParamNames(binding.path);
    if (new Set(names).size !== names.length) fail('path repeats a placeholder name');
  }

  if (binding.timeoutMs !== undefined) {
    const t = binding.timeoutMs;
    if (!Number.isInteger(t) || t < MIN_ROUTE_TIMEOUT_MS || t > MAX_ROUTE_TIMEOUT_MS) {
      fail(`timeoutMs must be an integer from ${MIN_ROUTE_TIMEOUT_MS} to ${MAX_ROUTE_TIMEOUT_MS}`);
    }
  }

  if (binding.method === 'GET' && (binding.class === 'D' || binding.class === 'B' || binding.class === 'G')) {
    fail(`a GET route cannot be class ${binding.class}`);
  }
  if (binding.class === 'G') {
    if (!Array.isArray(binding.outwardEffects)) fail('class G must declare outwardEffects (an empty list says none)');
    if (typeof binding.verify !== 'function') fail('class G must declare verify');
  }
  if (binding.class === 'B') {
    if (binding.reversal === undefined) fail("class B must declare reversal ({ kind: 'none' } says none)");
    if (typeof binding.verify !== 'function') fail('class B must declare verify');
  }
  if (binding.reversal?.kind === 'compensating' && typeof binding.reversal.buildInput !== 'function') {
    fail('a compensating reversal must declare buildInput');
  }
  return problems;
}

/** The call a step's args produce through the binding's builders (each is optional). */
export function bindingInput<TArgs>(binding: RouteBinding<TArgs>, args: TArgs): DispatchInput {
  return {
    params: binding.buildParams?.(args),
    query: binding.buildQuery?.(args),
    body: binding.buildBody?.(args),
  };
}

/** Bindings indexed by `operation`: what the core receives as `ops`. */
export interface BindingRegistry {
  /** The binding of `operation`, or `undefined` (a stored operation the running code does not know is stale). */
  get(operation: string): RouteBinding | undefined;
  has(operation: string): boolean;
  /** Every binding, in registration order. */
  all(): readonly RouteBinding[];
}

/**
 * Builds the registry. Throws, listing every problem, when a binding is malformed (`validateBinding`), an
 * `operation` repeats, or a compensating reversal names an operation the registry does not have.
 */
export function createBindingRegistry(bindings: readonly RouteBinding[]): BindingRegistry {
  const byOperation = new Map<string, RouteBinding>();
  const problems: string[] = [];
  for (const binding of bindings) {
    problems.push(...validateBinding(binding));
    if (byOperation.has(binding.operation)) problems.push(`${binding.operation}: registered twice`);
    byOperation.set(binding.operation, binding);
  }
  for (const binding of bindings) {
    if (binding.reversal?.kind === 'compensating' && !byOperation.has(binding.reversal.operation)) {
      problems.push(`${binding.operation}: reversal names unknown operation ${binding.reversal.operation}`);
    }
  }
  if (problems.length > 0) throw new Error(`[admin-agent] invalid route bindings:\n${problems.join('\n')}`);

  const all = Object.freeze([...bindings]);
  return Object.freeze({
    get: (operation: string) => byOperation.get(operation),
    has: (operation: string) => byOperation.has(operation),
    all: () => all,
  });
}
