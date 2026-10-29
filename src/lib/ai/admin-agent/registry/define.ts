import { z } from 'zod';
import { guardFor, type GuardKind, type GuardSpec, type GuardSpecOf, type GuardedAs } from './guard';
import { toolError, toolErrorFromThrown } from './errors';
import type { AdminAgentPhase } from '../env';
import type {
  ArgsSchema,
  OutwardEffect,
  RouteRef,
  ToolAudience,
  ToolBase,
  ToolContext,
  ToolResult,
  ToolVerifyId,
} from './types';

/**
 * Constructors of registry entries.
 *
 * `defineRunnable` builds an R or P tool. Its `run` is the whole call path and the only one the loop uses:
 *   1. parse the arguments with the tool's full Zod schema (constraints included);
 *   2. `guardFor(guard(args))`: the route's own live `require*` helper, before any data is read;
 *   3. `execute(args, guarded, ctx)`, which receives the `Guarded` token and so cannot be written without a guard;
 *   4. validate the result with the tool's strict output schema (an allow-list: a new column cannot leak by default).
 * Every failure on the way is a catalogued code (`errors.ts`); the model never receives `err.message`.
 *
 * `defineStaged` builds the model-facing entry of a D, B or G tool: name, description, arguments and the facts the
 * invariants check (routes, outward effects, reversal, verify). It has no `execute`: D writes are bound by the loop,
 * B and G are staged as proposals and run only by the approve route (plan 3.9 tests 4 and 6).
 */

export interface RunnableTool extends ToolBase {
  readonly class: 'R' | 'P';
  /** The guard kind this tool declares (what `guard(args)` returns), for the structure tests. */
  readonly guardKind: GuardKind;
  /** The strict allow-list schema every result must satisfy. */
  readonly output: z.ZodType;
  /** The whole call path: validate, guard, execute, validate the result. Every outcome is a `ToolResult`. */
  run(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface StagedTool extends ToolBase {
  readonly class: 'D' | 'B' | 'G';
  /** Routes the tool's operation dispatches through. Empty for the Plan tools (own tables only). */
  readonly routes: readonly RouteRef[];
  /** G only: the outward effects the Go-live card lists. An empty array means "none" and is asserted. */
  readonly outwardEffects?: readonly OutwardEffect[];
  /** B only (and D where an Undo exists): how the operation is reversed, or `'none'`. */
  readonly reversal?: string;
  /** B and G: the read-back that proves the write happened. */
  readonly verify?: ToolVerifyId;
  /** G only: the exact name the admin types on the card. */
  readonly typedName?: 'league' | 'format';
  /** There is intentionally no `execute`. */
  readonly execute?: never;
}

export type ToolDefinition = RunnableTool | StagedTool;

interface RunnableInput<A extends ArgsSchema, K extends GuardKind, O extends z.ZodType> {
  readonly name: string;
  readonly class: 'R' | 'P';
  readonly description: string;
  readonly args: A;
  readonly phase: AdminAgentPhase;
  readonly audience?: ToolAudience;
  /** Built from the validated arguments; its kind is `K`. */
  readonly guard: (args: z.output<A>) => GuardSpecOf<K>;
  readonly output: O;
  readonly execute: (args: z.output<A>, guarded: GuardedAs<K>, ctx: ToolContext) => Promise<z.input<O>>;
}

/**
 * `guardKind` is declared once, up front, so the structure tests can read it without calling `guard`; the call path
 * checks that `guard` really returns that kind.
 */
export function defineRunnable<A extends ArgsSchema, K extends GuardKind, O extends z.ZodType>(
  guardKind: K,
  input: RunnableInput<A, K, O>,
): RunnableTool {
  return {
    name: input.name,
    class: input.class,
    description: input.description,
    args: input.args,
    phase: input.phase,
    audience: input.audience ?? 'any',
    guardKind,
    output: input.output,
    async run(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
      const parsed = input.args.safeParse(rawArgs);
      if (!parsed.success) {
        return toolError('validation_failed', { issues: describeIssues(parsed.error) });
      }
      let spec: GuardSpec;
      try {
        spec = input.guard(parsed.data);
      } catch (err) {
        return toolErrorFromThrown(err, `${input.name} guard`);
      }
      // A tool declares its guard kind once; a guard function that returns another kind is a coding error.
      if (spec.kind !== guardKind) {
        console.error(`[admin-agent] ${input.name}: guard function returned ${spec.kind}, declared ${guardKind}`);
        return toolError('agent_harness_error');
      }
      try {
        const guarded = await guardFor(spec as GuardSpecOf<K>);
        const raw = await input.execute(parsed.data, guarded, ctx);
        const checked = input.output.safeParse(raw);
        if (!checked.success) {
          // An output the allow-list rejects is a projection bug: fail closed, log the paths (never the values).
          console.error(`[admin-agent] ${input.name}: output rejected by its strict schema: ${describeIssues(checked.error)}`);
          return toolError('agent_harness_error');
        }
        return { ok: true, data: checked.data };
      } catch (err) {
        return toolErrorFromThrown(err, input.name);
      }
    },
  };
}

/** `path: message` for each Zod issue, joined, at most 300 characters. Paths and our own messages only, never values. */
export function describeIssues(error: z.ZodError): string {
  const text = error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(arguments)'}: ${issue.message}`)
    .join('; ');
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

interface StagedInput {
  readonly name: string;
  readonly class: 'D' | 'B' | 'G';
  readonly description: string;
  readonly args: ArgsSchema;
  readonly phase: AdminAgentPhase;
  readonly audience?: ToolAudience;
  readonly routes?: readonly RouteRef[];
  readonly outwardEffects?: readonly OutwardEffect[];
  readonly reversal?: string;
  readonly verify?: ToolVerifyId;
  readonly typedName?: 'league' | 'format';
}

export function defineStaged(input: StagedInput): StagedTool {
  return {
    name: input.name,
    class: input.class,
    description: input.description,
    args: input.args,
    phase: input.phase,
    audience: input.audience ?? 'any',
    routes: input.routes ?? [],
    ...(input.outwardEffects === undefined ? {} : { outwardEffects: input.outwardEffects }),
    ...(input.reversal === undefined ? {} : { reversal: input.reversal }),
    ...(input.verify === undefined ? {} : { verify: input.verify }),
    ...(input.typedName === undefined ? {} : { typedName: input.typedName }),
  };
}
