/**
 * Types of the Admin Assistant's dispatch layer (plan 3.2, 3.3, 6.5).
 *
 * The layer is generic: a `RouteBinding` names a route (method, path pattern), loads its module lazily and carries the
 * hooks the executor needs around the call. The core imports no route; the bindings live in
 * `src/app/api/admin/agent/_ops/` and are injected (`createBindingRegistry`).
 */
import type { Session } from 'next-auth';
import type { NextRequest } from 'next/server';
import type { AgentAuditContext } from '@/lib/audit/agent-context';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** The delivery phases of `ADMIN_AGENT_MAX_PHASE` (kept local: this layer imports no other assistant module). */
export type BindingPhase = 0 | 1 | 2 | 3 | 4 | 5;

/** Plan 3.5: read, pure preview, private write, live reversible write, outward or irreversible write. */
export const ACTION_CLASSES = ['R', 'P', 'D', 'B', 'G'] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

/**
 * A route handler as a route module exports it. The context is typed `never` so a handler that declares its own params
 * shape (`{ params: Promise<{ id: string }> }`) is assignable; `invokeRoute` passes `{ params: Promise<Record<string,
 * string>> }`, checked against the binding's path pattern.
 */
export type RouteHandler = (request: NextRequest, context: never) => Response | Promise<Response>;

/** What `import('@/app/api/.../route')` resolves to; other exports (`maxDuration`, types) are ignored. */
export type RouteModule = { readonly [M in HttpMethod]?: RouteHandler };

/** A query value; `undefined` is skipped, an array repeats the key. */
export type QueryValue = string | number | boolean | undefined;
export type DispatchQuery = Readonly<Record<string, QueryValue | readonly QueryValue[]>>;

/** What a call carries besides the binding: path params, query string, JSON body. All three are optional. */
export interface DispatchInput {
  /** Values for the `[name]` segments of the binding's path pattern. Exactly those names, no others. */
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: DispatchQuery;
  /** Serialised as JSON. Refused on GET. */
  readonly body?: unknown;
}

/** One group of outward effects a G step has (plan 4.5: one acknowledgement per group). */
export interface OutwardEffectGroup {
  /** Stable group id the acknowledgement is keyed by. */
  readonly group: string;
  /** Event names (Discord and social) the route may fire. */
  readonly events: readonly string[];
}

/** How a B or G step is reversed (plan 4.7): not at all, or by another binding with a compensating call. */
export type BindingReversal<TArgs> =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'compensating';
      /** The `operation` of the binding that reverses it. */
      readonly operation: string;
      /** The call that reverses this one, built from the step's args and the `data` its route answered. */
      buildInput(args: TArgs, result: unknown): DispatchInput;
    };

/** What a `verify` read-back concluded (plan 3.3, 4.5 step f). */
export interface VerifyResult {
  /** `confirmed`: the write is visible; `absent`: it is not; `unknown`: the read could not tell. */
  readonly status: 'confirmed' | 'absent' | 'unknown';
  /** Small, allow-listed facts for the ledger (ids, counts). Never free text from the model. */
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface VerifyContext {
  /** The admin the step runs for; a verify read goes through the same guards as any reader. */
  readonly adminId: string;
}

/**
 * A route the assistant may call. Hooks are declared with method syntax on purpose: that makes their parameters
 * bivariant, so a `RouteBinding<{ id: string }>` fits a `RouteBinding` (a `RouteBinding<unknown>`) in a registry array.
 *
 * The hooks are data for the executor and the static tests (plan 3.9 test 6): dispatch itself calls only `load`,
 * `method`, `path` and `timeoutMs`.
 */
export interface RouteBinding<TArgs = unknown> {
  /** Stable snake_case id of the operation (`league_create`). The ledger and the proposals name it, never the path. */
  readonly operation: string;
  readonly method: HttpMethod;
  /** Path pattern as the route file is laid out, with `[name]` segments: `/api/seasons/[id]/phases`. No catch-alls. */
  readonly path: string;
  readonly class: ActionClass;
  /**
   * Delivery phase (`ADMIN_AGENT_MAX_PHASE`, spec §18.17) the operation ships in. The executor refuses a stored step whose
   * binding is above the configured cap; a binding that does not say is treated as the last phase (5), never as phase 0.
   */
  readonly phase?: BindingPhase;
  /** Lazy import of the route module, with a literal specifier: `() => import('@/app/api/seasons/route')`. */
  load(): Promise<RouteModule>;
  /**
   * Per-binding step timeout in ms; default `DEFAULT_ROUTE_TIMEOUT_MS`. A route with `maxDuration = 300` gets roughly
   * that minus a margin (`league_trash`).
   */
  readonly timeoutMs?: number;
  /** Builders from the step's validated args to the call, so the executor rebuilds the request from stored fields. */
  buildParams?(args: TArgs): Readonly<Record<string, string>>;
  buildQuery?(args: TArgs): DispatchQuery;
  buildBody?(args: TArgs): unknown;
  /** G: the outward effects, by group. Required for class G (an empty array says "none"). */
  readonly outwardEffects?: readonly OutwardEffectGroup[];
  /** B: how to reverse it. Required for class B; `{ kind: 'none' }` says it cannot be. */
  readonly reversal?: BindingReversal<TArgs>;
  /** B and G: the read-back that runs after the call and after any outcome that is not `ok`. Required for B and G. */
  verify?(args: TArgs, outcome: Outcome, ctx: VerifyContext): Promise<VerifyResult>;
}

/** Everything `invokeRoute` needs about who is acting and on whose behalf. */
export interface DispatchContext {
  /**
   * The session `authAndRecord()` returned on the CURRENT request (chat or approve). `runAsVerifiedSession` refuses
   * any other object; its `expires` is checked before every dispatch.
   */
  readonly session: Session;
  /**
   * The inbound request (or anything with its headers): `x-forwarded-for` and `x-real-ip` are copied from it so IP
   * limiters see the admin's address. Nothing else is copied; in particular no cookie and no authorization header.
   */
  readonly inbound: Pick<Request, 'headers'>;
  /**
   * Who stands behind the write (plan 6.5). `agent_tool` defaults to the binding's `operation`.
   */
  readonly audit: AgentAuditContext;
}

/** Codes the harness itself reports (all keys of `errors/admin-assistant` or `errors/common`). */
export type HarnessErrorCode = 'agent_harness_error' | 'unknown_outcome' | 'upstream_timeout';

/** Why the harness, not the route, produced a result. Logged; the model sees only the code. */
export type HarnessErrorReason =
  | 'step_timeout'
  | 'load_failed'
  | 'no_handler'
  | 'bad_params'
  | 'bad_input'
  | 'session_refused'
  | 'handler_threw'
  | 'bad_response'
  | 'unexpected_status';

/** Catalogued `code`/`params` of an error response. `code` is always a key of an error catalog. */
export interface OutcomeError {
  readonly httpStatus: number;
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/**
 * Typed outcome of a dispatched route call (plan 3.3, "no masking").
 *
 * `unknownOutcome` marks the results after which a write may have committed (a masked 500, a 504, a step timeout, a
 * handler that threw or answered nonsense, all on a non-GET route): the executor records the step `unknown`, runs the
 * binding's `verify`, and never retries it. It is `false` when nothing ran or the call was a read.
 */
export type Outcome<T = unknown> =
  | {
      readonly kind: 'ok';
      readonly httpStatus: number;
      /** `body.data` when the route answered the `{ success, data }` shape, else the whole body. */
      readonly data: T;
      /** The whole parsed JSON body (some routes carry fields beside `data`, e.g. `rebuild_warning`). */
      readonly body: unknown;
    }
  | ({
      readonly kind: 'validation';
      /** The route's issue list, control characters stripped, capped. */
      readonly issues: string;
    } & OutcomeError)
  | {
      readonly kind: 'unauthenticated';
      readonly httpStatus: 401;
      readonly code: 'unauthenticated';
      /** True when the harness refused the call because `session.expires` had passed. */
      readonly sessionExpired: boolean;
    }
  | ({ readonly kind: 'forbidden' } & OutcomeError)
  | ({ readonly kind: 'not_found' } & OutcomeError)
  | ({ readonly kind: 'conflict' } & OutcomeError)
  | ({ readonly kind: 'locked' } & OutcomeError)
  | {
      readonly kind: 'rate_limited';
      readonly httpStatus: 429 | 503;
      readonly code: 'rate_limited' | 'rate_limit_unavailable';
      readonly retryAfterSeconds: number;
    }
  | { readonly kind: 'upstream_timeout'; readonly httpStatus: 504; readonly code: 'upstream_timeout'; readonly unknownOutcome: boolean }
  | ({ readonly kind: 'masked_server_error'; readonly unknownOutcome: boolean } & OutcomeError)
  | {
      readonly kind: 'harness_error';
      readonly httpStatus: number | null;
      readonly code: HarnessErrorCode;
      readonly reason: HarnessErrorReason;
      readonly unknownOutcome: boolean;
    };

export type OutcomeKind = Outcome['kind'];

/** Default per-binding step timeout (plan 3.3). */
export const DEFAULT_ROUTE_TIMEOUT_MS = 55_000;
/** Bounds `validateBinding` accepts for `timeoutMs` (a route's `maxDuration` is at most 300 s). */
export const MIN_ROUTE_TIMEOUT_MS = 1_000;
export const MAX_ROUTE_TIMEOUT_MS = 290_000;
