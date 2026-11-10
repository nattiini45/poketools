import type { ApiErrorCode } from '@/i18n/messages/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';

/**
 * Explicit state machines (docs/state-machines.md, ADR 0004).
 *
 * Every column, timestamp or flag combination that moves through states has one
 * definition built with `defineMachine`: its states, its legal transitions and
 * who may perform each one. Writers ask the machine before they write
 * (`assertTransition`), guard the UPDATE with the machine's source states
 * (`sourcesOf`), and UI derives which action to show from `transitionsFrom`.
 * The definitions are pure data and client-safe.
 *
 * `docs/state-machines.md` is generated from the registry
 * (`src/lib/state-machine/registry.ts`): `npm run docs:state-machines`.
 */

export interface TransitionSpec<S extends string, A extends string> {
  /** States the transition leaves. A self-loop lists `to` here too. */
  readonly from: readonly S[];
  readonly to: S;
  /** Short verb (`start`, `complete`, `reopen`): docs label and UI action key. */
  readonly event: string;
  /** Who may perform it. */
  readonly actors: readonly A[];
  /** Writer(s) that perform it, as repo paths (a SQL function as `path#function`): shown in the docs so an agent finds the code. */
  readonly writers: readonly string[];
  /** One sentence on when it happens and what it guards. */
  readonly note?: string;
}

export interface MachineSpec<S extends string, A extends string> {
  /** Stable id (`season`, `draft_pool.phase`): the error params and the docs anchor. */
  readonly id: string;
  readonly title: string;
  /** Where the state lives (`seasons.status`, or a component for a client flow). */
  readonly storage: string;
  readonly summary: string;
  readonly states: readonly S[];
  /** States a new row (or flow) starts in. */
  readonly initial: readonly S[];
  /** States nothing leaves. */
  readonly terminal: readonly S[];
  readonly actors: readonly A[];
  readonly transitions: readonly TransitionSpec<S, A>[];
  /** Module doc for the domain. */
  readonly doc?: string;
  /**
   * Catalog codes for refusals. Defaults: `state_transition_invalid` and
   * `state_transition_forbidden` (errors/common); a domain may point at its
   * own codes with the same `{from}` / `{to}` placeholders.
   */
  readonly codes?: { readonly invalid?: ApiErrorCode; readonly forbidden?: ApiErrorCode };
}

export type TransitionCheck<S extends string, A extends string> =
  | { readonly ok: true; readonly transition: TransitionSpec<S, A> }
  | { readonly ok: false; readonly reason: 'unknown_state' | 'not_a_transition' | 'actor_not_allowed' };

/**
 * A refused transition. 409 when the move does not exist from the current
 * state (the row moved on, or the caller asked for something impossible), 403
 * when it exists but not for this actor.
 */
export class IllegalTransitionError extends UserFacingError {
  readonly machine: string;
  readonly from: string;
  readonly to: string;
  readonly reason: 'unknown_state' | 'not_a_transition' | 'actor_not_allowed';

  constructor(
    machine: string,
    from: string,
    to: string,
    reason: 'unknown_state' | 'not_a_transition' | 'actor_not_allowed',
    code: ApiErrorCode,
  ) {
    super(
      reason === 'actor_not_allowed'
        ? `Not allowed: ${machine} ${from} → ${to}`
        : `Invalid transition: ${machine} ${from} → ${to}`,
      { code, params: { machine, from, to }, status: reason === 'actor_not_allowed' ? 403 : 409 },
    );
    this.name = 'IllegalTransitionError';
    this.machine = machine;
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

export interface Machine<S extends string, A extends string> {
  readonly spec: MachineSpec<S, A>;
  /** Whether `value` is a declared state (own-key check: `constructor` is not a state). */
  isState(value: unknown): value is S;
  /** Every transition that leaves `from`, optionally only those `actor` may perform. */
  transitionsFrom(from: S, actor?: A): TransitionSpec<S, A>[];
  /** States reachable from `from` in one move, optionally for one actor. */
  nextStates(from: S, actor?: A): S[];
  /**
   * States from which `to` is legal, optionally for one actor: the
   * compare-and-set guard of a write (`.in('status', machine.sourcesOf(to))`).
   */
  sourcesOf(to: S, actor?: A): S[];
  can(from: S, to: S, actor: A): boolean;
  check(from: S, to: S, actor: A): TransitionCheck<S, A>;
  /** Returns the transition, or throws `IllegalTransitionError`. */
  assertTransition(from: S, to: S, actor: A): TransitionSpec<S, A>;
}

export function defineMachine<const S extends string, const A extends string>(
  spec: MachineSpec<S, A>,
): Machine<S, A> {
  const states = new Set<string>(spec.states);
  const isState = (value: unknown): value is S => typeof value === 'string' && states.has(value);
  const transitionsFrom = (from: S, actor?: A) =>
    spec.transitions.filter((t) => t.from.includes(from) && (actor === undefined || t.actors.includes(actor)));
  const unique = <T>(values: T[]) => [...new Set(values)];
  const check = (from: S, to: S, actor: A): TransitionCheck<S, A> => {
    if (!isState(from) || !isState(to)) return { ok: false, reason: 'unknown_state' };
    const candidates = spec.transitions.filter((t) => t.to === to && t.from.includes(from));
    if (candidates.length === 0) return { ok: false, reason: 'not_a_transition' };
    const transition = candidates.find((t) => t.actors.includes(actor));
    return transition ? { ok: true, transition } : { ok: false, reason: 'actor_not_allowed' };
  };

  return {
    spec,
    isState,
    transitionsFrom,
    nextStates: (from, actor) => unique(transitionsFrom(from, actor).map((t) => t.to)),
    sourcesOf: (to, actor) =>
      unique(
        spec.transitions
          .filter((t) => t.to === to && (actor === undefined || t.actors.includes(actor)))
          .flatMap((t) => t.from),
      ),
    can: (from, to, actor) => check(from, to, actor).ok,
    check,
    assertTransition(from, to, actor) {
      const result = check(from, to, actor);
      if (result.ok) return result.transition;
      const code =
        result.reason === 'actor_not_allowed'
          ? (spec.codes?.forbidden ?? 'state_transition_forbidden')
          : (spec.codes?.invalid ?? 'state_transition_invalid');
      throw new IllegalTransitionError(spec.id, String(from), String(to), result.reason, code);
    },
  };
}

/**
 * Structural problems of a spec: a transition naming an undeclared state or
 * actor, a terminal state with an outgoing transition, a state that no
 * transition or initial entry reaches, the same move declared twice for one
 * actor. Empty when the spec is sound; the registry test runs it on every
 * machine.
 */
export function specProblems<S extends string, A extends string>(spec: MachineSpec<S, A>): string[] {
  const problems: string[] = [];
  const states = new Set<string>(spec.states);
  const actors = new Set<string>(spec.actors);
  if (states.size !== spec.states.length) problems.push('duplicate state');
  for (const s of [...spec.initial, ...spec.terminal]) {
    if (!states.has(s)) problems.push(`initial/terminal state ${s} is not declared`);
  }
  const seen = new Set<string>();
  for (const t of spec.transitions) {
    if (!t.event) problems.push(`transition to ${t.to} has no event`);
    if (t.from.length === 0) problems.push(`${t.event} has no source state`);
    if (t.actors.length === 0) problems.push(`${t.event} has no actor`);
    if (t.writers.length === 0) problems.push(`${t.event} names no writer`);
    if (!states.has(t.to)) problems.push(`${t.event} targets undeclared state ${t.to}`);
    for (const a of t.actors) if (!actors.has(a)) problems.push(`${t.event} names undeclared actor ${a}`);
    for (const f of t.from) {
      if (!states.has(f)) problems.push(`${t.event} leaves undeclared state ${f}`);
      if (spec.terminal.includes(f)) problems.push(`terminal state ${f} has outgoing transition ${t.event}`);
      for (const a of t.actors) {
        const key = `${f}→${t.to}:${a}`;
        if (seen.has(key)) problems.push(`${key} is declared twice`);
        seen.add(key);
      }
    }
  }
  const reached = new Set<string>([...spec.initial, ...spec.transitions.map((t) => t.to)]);
  for (const s of spec.states) if (!reached.has(s)) problems.push(`state ${s} is unreachable`);
  return problems;
}
