import 'server-only';

import { z } from 'zod';
import { MissingEnvError } from '@/lib/env';
import { PRICED_MODEL_IDS } from './loop/pricing';

/**
 * Admin Assistant configuration (spec §13 "Admin Assistant", §18.9 and §18.10; plan 6.4).
 *
 * Every `ADMIN_AGENT_*` variable is parsed here with zod and fails closed:
 *  - an unset or blank value is the default, and the default is off or the narrowest setting;
 *  - the string `"false"` is off (never a truthy string);
 *  - an invalid value turns the assistant off (`enabled: false`), except `ADMIN_AGENT_MAX_PHASE`,
 *    which the spec degrades to `0`; the offending key is listed in `problems`, by name and never
 *    by value.
 *
 * `assertAdminAgentBootEnv` is the boot assertion `src/instrumentation.ts` runs beside
 * `assertBootEnv`: it throws only when `ADMIN_AGENT_ENABLED` is on AND a value is invalid, so a
 * deployment that leaves the assistant off never fails to boot over it. It lives here, not in
 * `src/lib/env.ts`, so the central env module does not import the assistant (and so the two do not
 * form an import cycle).
 *
 * Money is configured in whole US dollars (decimals allowed) and held in micro-dollars, the unit of
 * the usage ledger (`reserved_usd_micro`). `NEXT_PUBLIC_ENABLE_ADMIN_ASSISTANT` only hides the UI
 * and lives in `src/lib/feature-flags.ts`; this module is the real gate.
 */

type EnvSource = Record<string, string | undefined>;

/**
 * Models are Anthropic only (§18.10) and must be priced: the ids of the pricing table, each optionally with a dated
 * `-YYYYMMDD` suffix. Any other id would be billed at the table's highest rate while the caps count real money, and a wrong
 * id fails at the first request, so it turns the assistant off at boot instead. This covers the configured defaults of NEW
 * conversations only: a conversation row keeps the id it was created with, and nothing validates that id again.
 */
const MODEL_ID = new RegExp(`^(?:${PRICED_MODEL_IDS.join('|')})(?:-[0-9]{8})?$`);
/** Effort ceiling is `high` (plan 3.4); `xhigh` and `max` are not accepted. */
const EFFORTS = ['low', 'medium', 'high'] as const;
export type AdminAgentEffort = (typeof EFFORTS)[number];

export const ADMIN_AGENT_PHASES = [0, 1, 2, 3, 4, 5] as const;
export type AdminAgentPhase = (typeof ADMIN_AGENT_PHASES)[number];

export type AdminAgentRoles = 'site' | 'any';

const MICRO = 1_000_000;

/** Unset, blank and whitespace-only count as unset; anything else is kept trimmed. */
const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** An optional value of `schema`; unset means `fallback`. */
function optional<T extends z.ZodType>(schema: T, fallback: z.output<T>) {
  return z.preprocess(blankToUndefined, schema.optional()).transform((value) => (value ?? fallback) as z.output<T>);
}

const FLAG_MESSAGE = "must be 'true' or 'false' (or unset)";

/** A switch: `true`/`1` on, `false`/`0` off, case-insensitive; anything else is invalid. */
const flagSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0'], { message: FLAG_MESSAGE }))
  .transform((value) => value === 'true' || value === '1');

const flag = () => optional(flagSchema, false);

/** A whole number in `[min, max]`. */
function intIn(min: number, max: number, fallback: number) {
  return optional(
    z
      .string()
      .regex(/^\d{1,9}$/, { message: `must be a whole number from ${min} to ${max}` })
      .transform(Number)
      .pipe(z.number().min(min, { message: `must be at least ${min}` }).max(max, { message: `must be at most ${max}` })),
    fallback
  );
}

/** US dollars with up to six decimals, above zero, as micro-dollars. */
function usdSchema(maxUsd: number) {
  return z
    .string()
    .regex(/^\d{1,6}(\.\d{1,6})?$/, { message: 'must be an amount in US dollars, e.g. 5 or 2.5' })
    .transform((value) => Math.round(Number(value) * MICRO))
    .pipe(
      z
        .number()
        .min(1, { message: 'must be above zero' })
        .max(maxUsd * MICRO, { message: `must be at most ${maxUsd}` })
    );
}

const usd = (maxUsd: number, fallbackUsd: number) => optional(usdSchema(maxUsd), Math.round(fallbackUsd * MICRO));

const roles = optional(z.enum(['site', 'any'], { message: "must be 'site' or 'any' (or unset)" }), 'site' as AdminAgentRoles);

/** The phase cap, `0`-`5`. */
const maxPhase = optional(
  z.string().pipe(
    z.enum(['0', '1', '2', '3', '4', '5'], { message: 'must be a whole number from 0 to 5 (or unset)' }).transform((v) => Number(v) as AdminAgentPhase)
  ),
  0 as AdminAgentPhase
);

/** Comma-separated player ids (UUIDs); empty means everyone in the audience (`null`). */
const allowedPlayerIds = z
  .preprocess(blankToUndefined, z.string().optional())
  .transform((value, ctx): readonly string[] | null => {
    if (value === undefined) return null;
    const ids = [...new Set(value.split(',').map((part) => part.trim().toLowerCase()).filter((part) => part !== ''))];
    if (ids.length === 0) return null;
    if (ids.length > 200) {
      ctx.addIssue({ code: 'custom', message: 'lists more than 200 player ids' });
      return z.NEVER;
    }
    if (!ids.every((id) => z.guid().safeParse(id).success)) {
      ctx.addIssue({ code: 'custom', message: 'must be a comma-separated list of player UUIDs' });
      return z.NEVER;
    }
    return ids;
  });

const modelId = (fallback: string) =>
  optional(
    z.string().regex(MODEL_ID, { message: `must be one of ${PRICED_MODEL_IDS.join(', ')} (optionally with a -YYYYMMDD suffix)` }),
    fallback
  );
const effort = (fallback: AdminAgentEffort) =>
  optional(z.enum(EFFORTS, { message: "must be 'low', 'medium' or 'high' (or unset)" }), fallback);

/** `ADMIN_AGENT_*` keys the strict schema reads. */
export const adminAgentEnvSchema = z.object({
  ADMIN_AGENT_ENABLED: flag(),
  ADMIN_AGENT_GOLIVE: flag(),
  ADMIN_AGENT_ROLES: roles,
  ADMIN_AGENT_MAX_PHASE: maxPhase,
  ADMIN_AGENT_ALLOWED_PLAYER_IDS: allowedPlayerIds,
  ADMIN_AGENT_ALLOW_HOSTED: flag(),
  ADMIN_AGENT_LIVE_DB: flag(),

  // Models (one per conversation, never switched mid-conversation; plan 3.4 table).
  ADMIN_AGENT_MODEL_WRITE: modelId('claude-opus-5-5'),
  ADMIN_AGENT_EFFORT_WRITE: effort('medium'),
  ADMIN_AGENT_MODEL_READ: modelId('claude-sonnet-5-5'),
  ADMIN_AGENT_EFFORT_READ: effort('medium'),
  ADMIN_AGENT_MODEL_SMALL: modelId('claude-haiku-5-5'),
  ADMIN_AGENT_EFFORT_SMALL: effort('low'),

  // Dollar caps (plan 6.4; owner-confirmed Q7 values). Warn is optional: unset means 60% of the hard stop.
  ADMIN_AGENT_BUDGET_CONVERSATION_USD: usd(1000, 5),
  ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD: z.preprocess(blankToUndefined, usdSchema(1000).optional()),
  ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: usd(10000, 20),
  ADMIN_AGENT_BUDGET_ADMIN_MONTH_USD: usd(100000, 120),
  ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD: usd(100000, 80),

  // Rate limits and per-turn limits.
  ADMIN_AGENT_TURNS_PER_HOUR: intIn(1, 1000, 40),
  ADMIN_AGENT_WRITES_PER_HOUR: intIn(1, 1000, 60),
  ADMIN_AGENT_MAX_TEXT_CHARS: intIn(100, 20_000, 8000),
  ADMIN_AGENT_MAX_STEPS_PER_TURN: intIn(1, 50, 12),
  ADMIN_AGENT_MAX_TOOL_CALLS_PER_TURN: intIn(1, 200, 30),
  ADMIN_AGENT_MAX_STAGINGS_PER_TURN: intIn(1, 20, 4),
  // `maxDuration` of the chat route is 300 s: the deadline stops new model steps before it.
  ADMIN_AGENT_TURN_DEADLINE_SECONDS: intIn(30, 280, 240),
  ADMIN_AGENT_CONTEXT_REFUSE_PERCENT: intIn(50, 95, 80),

  // Per Build.
  ADMIN_AGENT_MAX_BUILD_STEPS: intIn(1, 200, 40),
  ADMIN_AGENT_MAX_BUILD_CREATES: intIn(1, 100, 10),

  // Blast radius per conversation (counted atomically when a proposal is claimed).
  ADMIN_AGENT_CAP_LEAGUE_CREATES: intIn(0, 100, 3),
  ADMIN_AGENT_CAP_TOURNAMENT_CREATES: intIn(0, 100, 3),
  ADMIN_AGENT_CAP_RULESET_CREATES: intIn(0, 100, 5),
  ADMIN_AGENT_CAP_FORMAT_CREATES: intIn(0, 100, 8),
  ADMIN_AGENT_CAP_GOLIVE_EXECUTIONS: intIn(0, 100, 6),
  // One pins call moves up to 50 targets; the number is provisional until the owner confirms the caps (Q7).
  ADMIN_AGENT_CAP_PIN_TARGETS: intIn(0, 1000, 50),

  // Proposal lifetimes, bounded 5-240 minutes (§18.6).
  ADMIN_AGENT_PROPOSAL_TTL_BUILD_MINUTES: intIn(5, 240, 60),
  ADMIN_AGENT_PROPOSAL_TTL_GOLIVE_MINUTES: intIn(5, 240, 15),
});

export type AdminAgentEnvKey = keyof z.input<typeof adminAgentEnvSchema>;

export interface AdminAgentModelChoice {
  readonly model: string;
  readonly effort: AdminAgentEffort;
}

export interface AdminAgentConfig {
  /** `ADMIN_AGENT_ENABLED` asked for the assistant, whether or not the rest is valid. Only the boot assertion reads it. */
  readonly requested: boolean;
  /** The assistant is on: requested and nothing is misconfigured. The route 404s when this is false. */
  readonly enabled: boolean;
  /** Go-live (G tier) proposals may run. Never true while `enabled` is false. */
  readonly golive: boolean;
  readonly roles: AdminAgentRoles;
  /** The registry exposes only operations of a phase at or below this. */
  readonly maxPhase: AdminAgentPhase;
  /** Lower-case player ids, or `null` for everyone in the audience. */
  readonly allowedPlayerIds: readonly string[] | null;
  /** Explicit opt-in to run against a non-local database outside a production build (§18.15). */
  readonly allowHosted: boolean;
  /** Test-only opt-in for the local-database suites; never honoured when `CI` is `true`. */
  readonly liveDb: boolean;
  readonly models: { readonly write: AdminAgentModelChoice; readonly read: AdminAgentModelChoice; readonly small: AdminAgentModelChoice };
  /** Dollar caps in micro-dollars (the ledger unit). */
  readonly budgets: {
    readonly conversationWarnMicro: number;
    readonly conversationMicro: number;
    readonly adminDayMicro: number;
    readonly adminMonthMicro: number;
    readonly globalDayMicro: number;
  };
  readonly limits: {
    readonly turnsPerHour: number;
    readonly writesPerHour: number;
    readonly maxTextChars: number;
    readonly maxStepsPerTurn: number;
    readonly maxToolCallsPerTurn: number;
    readonly maxStagingsPerTurn: number;
    readonly turnDeadlineSeconds: number;
    readonly contextRefusePercent: number;
    readonly maxBuildSteps: number;
    readonly maxBuildCreates: number;
  };
  /** Per-conversation counters for the blast radius. */
  readonly caps: {
    readonly leagueCreates: number;
    readonly tournamentCreates: number;
    readonly rulesetCreates: number;
    readonly formatCreates: number;
    readonly golive: number;
    readonly pinTargets: number;
  };
  readonly proposalTtlMinutes: { readonly build: number; readonly golive: number };
  /** Every invalid key with its reason. Never a value. */
  readonly problems: ReadonlyArray<{ key: string; reason: string }>;
}

type Parsed = z.output<typeof adminAgentEnvSchema>;

const DEFAULTS = adminAgentEnvSchema.parse({});

/** The `ADMIN_AGENT_*` keys of `source` and `CI`; no other variable reaches the parser or an error message. */
function pick(source: EnvSource): EnvSource {
  const input: EnvSource = {};
  for (const key of Object.keys(adminAgentEnvSchema.shape)) input[key] = source[key];
  return input;
}

function build(values: Parsed, requested: boolean, problems: AdminAgentConfig['problems'], ci: boolean): AdminAgentConfig {
  // A bad MAX_PHASE degrades to 0 and does not switch the assistant off (spec §13); any other
  // problem does.
  const blocking = problems.some((p) => p.key !== 'ADMIN_AGENT_MAX_PHASE');
  const enabled = requested && !blocking;
  const conversationMicro = values.ADMIN_AGENT_BUDGET_CONVERSATION_USD;
  const warn = values.ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD;
  return {
    requested,
    enabled,
    golive: enabled && values.ADMIN_AGENT_GOLIVE,
    roles: values.ADMIN_AGENT_ROLES,
    maxPhase: values.ADMIN_AGENT_MAX_PHASE,
    allowedPlayerIds: values.ADMIN_AGENT_ALLOWED_PLAYER_IDS,
    allowHosted: values.ADMIN_AGENT_ALLOW_HOSTED,
    liveDb: values.ADMIN_AGENT_LIVE_DB && !ci,
    models: {
      write: { model: values.ADMIN_AGENT_MODEL_WRITE, effort: values.ADMIN_AGENT_EFFORT_WRITE },
      read: { model: values.ADMIN_AGENT_MODEL_READ, effort: values.ADMIN_AGENT_EFFORT_READ },
      small: { model: values.ADMIN_AGENT_MODEL_SMALL, effort: values.ADMIN_AGENT_EFFORT_SMALL },
    },
    budgets: {
      conversationMicro,
      conversationWarnMicro: warn ?? Math.round(conversationMicro * 0.6),
      adminDayMicro: values.ADMIN_AGENT_BUDGET_ADMIN_DAY_USD,
      adminMonthMicro: values.ADMIN_AGENT_BUDGET_ADMIN_MONTH_USD,
      globalDayMicro: values.ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD,
    },
    limits: {
      turnsPerHour: values.ADMIN_AGENT_TURNS_PER_HOUR,
      writesPerHour: values.ADMIN_AGENT_WRITES_PER_HOUR,
      maxTextChars: values.ADMIN_AGENT_MAX_TEXT_CHARS,
      maxStepsPerTurn: values.ADMIN_AGENT_MAX_STEPS_PER_TURN,
      maxToolCallsPerTurn: values.ADMIN_AGENT_MAX_TOOL_CALLS_PER_TURN,
      maxStagingsPerTurn: values.ADMIN_AGENT_MAX_STAGINGS_PER_TURN,
      turnDeadlineSeconds: values.ADMIN_AGENT_TURN_DEADLINE_SECONDS,
      contextRefusePercent: values.ADMIN_AGENT_CONTEXT_REFUSE_PERCENT,
      maxBuildSteps: values.ADMIN_AGENT_MAX_BUILD_STEPS,
      maxBuildCreates: values.ADMIN_AGENT_MAX_BUILD_CREATES,
    },
    caps: {
      leagueCreates: values.ADMIN_AGENT_CAP_LEAGUE_CREATES,
      tournamentCreates: values.ADMIN_AGENT_CAP_TOURNAMENT_CREATES,
      rulesetCreates: values.ADMIN_AGENT_CAP_RULESET_CREATES,
      formatCreates: values.ADMIN_AGENT_CAP_FORMAT_CREATES,
      golive: values.ADMIN_AGENT_CAP_GOLIVE_EXECUTIONS,
      pinTargets: values.ADMIN_AGENT_CAP_PIN_TARGETS,
    },
    proposalTtlMinutes: {
      build: values.ADMIN_AGENT_PROPOSAL_TTL_BUILD_MINUTES,
      golive: values.ADMIN_AGENT_PROPOSAL_TTL_GOLIVE_MINUTES,
    },
    problems,
  };
}

/**
 * The assistant configuration from `source` (default `process.env`). Never throws: a value that does
 * not parse is replaced by its default, listed in `problems`, and (except `ADMIN_AGENT_MAX_PHASE`)
 * leaves `enabled` false.
 */
export function parseAdminAgentEnv(source: EnvSource = process.env): AdminAgentConfig {
  const input = pick(source);
  const ci = source.CI?.trim().toLowerCase() === 'true';
  const parsed = adminAgentEnvSchema.safeParse(input);
  if (parsed.success) return build(parsed.data, parsed.data.ADMIN_AGENT_ENABLED, validateRelations(parsed.data), ci);

  // Some keys are invalid. Parse each key alone so the valid ones keep their value and every
  // invalid one falls back to its default.
  const problems = new Map<string, string>();
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    if (!problems.has(key)) problems.set(key, issue.message);
  }
  const values: Record<string, unknown> = { ...DEFAULTS };
  for (const key of Object.keys(adminAgentEnvSchema.shape)) {
    if (problems.has(key)) continue;
    const one = (adminAgentEnvSchema.shape as Record<string, z.ZodType>)[key].safeParse(input[key]);
    if (one.success) values[key] = one.data;
  }
  const merged = values as Parsed;
  const list = [...problems].map(([key, reason]) => ({ key, reason }));
  // `ADMIN_AGENT_ENABLED` is on only when it parsed as on.
  const requested = !problems.has('ADMIN_AGENT_ENABLED') && merged.ADMIN_AGENT_ENABLED;
  return build(merged, requested, [...list, ...validateRelations(merged, problems)], ci);
}

/** Cross-field rules. A key already invalid is not judged again. */
function validateRelations(values: Parsed, invalid: ReadonlyMap<string, string> = new Map()): Array<{ key: string; reason: string }> {
  const out: Array<{ key: string; reason: string }> = [];
  const warn = values.ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD;
  if (
    warn !== undefined &&
    !invalid.has('ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD') &&
    !invalid.has('ADMIN_AGENT_BUDGET_CONVERSATION_USD') &&
    warn >= values.ADMIN_AGENT_BUDGET_CONVERSATION_USD
  ) {
    out.push({ key: 'ADMIN_AGENT_BUDGET_CONVERSATION_WARN_USD', reason: 'must be below ADMIN_AGENT_BUDGET_CONVERSATION_USD' });
  }
  return out;
}

/**
 * The boot assertion (run beside `assertBootEnv` from `src/instrumentation.ts`): throws one
 * `MissingEnvError` listing every invalid `ADMIN_AGENT_*` key, but only when `ADMIN_AGENT_ENABLED` is
 * on. With the flag off (or unset, or itself unreadable) the deployment boots whatever else is set.
 */
export function assertAdminAgentBootEnv(source: EnvSource = process.env): void {
  const config = parseAdminAgentEnv(source);
  if (config.requested && config.problems.length > 0) throw new MissingEnvError(config.problems);
}

/** Who is asking: the live roles and id of the signed-in admin. */
export interface AdminAgentViewer {
  readonly playerId: string | null | undefined;
  /** Live site admin (what `requireAdmin` accepts). */
  readonly isSiteAdmin: boolean;
  /** Live site admin or resource admin (what `requireAnyAdmin` accepts). */
  readonly isAnyAdmin: boolean;
}

/**
 * Whether the assistant is on for this viewer: the server switch, the audience (`site` admits site
 * admins, `any` admits every admin) and the optional player allow-list (§18.9). Checked at chat and
 * again at approve; the route guards still run on every call.
 */
export function agentEnabledFor(config: AdminAgentConfig, viewer: AdminAgentViewer): boolean {
  if (!config.enabled) return false;
  if (!(config.roles === 'any' ? viewer.isAnyAdmin : viewer.isSiteAdmin)) return false;
  if (config.allowedPlayerIds === null) return true;
  return viewer.playerId != null && config.allowedPlayerIds.includes(viewer.playerId.toLowerCase());
}

/** Whether an operation of delivery phase `phase` is exposed under `ADMIN_AGENT_MAX_PHASE`. */
export function agentPhaseAllowed(config: AdminAgentConfig, phase: number): boolean {
  return phase <= config.maxPhase;
}
