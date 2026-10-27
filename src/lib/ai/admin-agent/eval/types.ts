/**
 * Shapes of the Admin Assistant eval harness (plan 7.1 to 7.6): the case file, the recording a deterministic run replays,
 * the record of one run and its score.
 *
 * A case file describes conversation turns, what the run must do (tool calls, a Plan, staged proposals, an answer), and
 * what it must never do (a forbidden effect, a masked-error leak). Cases are data (`cases/*.json`, parsed with
 * `caseSchema`); nothing in them is code. The shape extends the player agent's `EvalCase` idea
 * (`src/lib/ai/agent/__tests__/evals/golden-set.ts`) with turns, actors and effects.
 */
import { z } from 'zod';
import type { AgentStreamEvent, DoneReason } from '../loop/types';
import type { Json } from '../store/types';

// ─── Case file ───────────────────────────────────────────────────────

export const EVAL_STAGES = ['plan'] as const;
export type EvalStage = (typeof EVAL_STAGES)[number];

export const EVAL_AREAS = ['RO', 'SF'] as const;
export type EvalArea = (typeof EVAL_AREAS)[number];

/** Who is asking. The tier decides the tool registry (`site` or `scoped`) and what the fixture world shows. */
export const EVAL_ACTORS = ['site_admin', 'league_admin', 'tournament_admin'] as const;
export type EvalActor = (typeof EVAL_ACTORS)[number];

/** `baseline` is the plain fixture; `injection` swaps in hostile stored text (plan 7.2 "injection"). */
export const EVAL_FIXTURES = ['baseline', 'injection'] as const;
export type EvalFixture = (typeof EVAL_FIXTURES)[number];

/** What the admin does with a card after the turn's message. In phase 0 an approval answers 501 `phase_disabled`. */
export const EVAL_CLICKS = ['approve', 'decline', 'double_approve', 'none'] as const;

/** Effects a run can have outside the assistant's own tables (see `effects.ts`). */
export const EFFECT_KINDS = ['stage', 'plan_write', 'approve_attempt', 'draft_write', 'route_call', 'outward_event', 'approval'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

const toolName = z.string().regex(/^[a-z][a-z0-9_]*$/);
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(json), z.record(z.string(), json)]),
) as z.ZodType<Json>;

const turnSchema = z
  .object({
    say: z.string().min(1).max(4_000),
    then: z.enum(EVAL_CLICKS).optional(),
  })
  .strict();

/** One check on the final Plan document (an RFC 6901 pointer into it). */
const planCheckSchema = z
  .object({
    path: z.string().startsWith('/'),
    equals: json.optional(),
    in: z.array(json).min(1).optional(),
    includes: json.optional(),
    exists: z.boolean().optional(),
  })
  .strict()
  .refine((c) => [c.equals, c.in, c.includes, c.exists].filter((v) => v !== undefined).length === 1, { message: 'a check names exactly one of equals, in, includes, exists' });
export type PlanCheck = z.infer<typeof planCheckSchema>;

const countRange = z.object({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }).strict();

/** One `mustMention` group: the phrases alone, or the phrases with the point they stand for (for the judge fallback). */
export const mentionGroupSchema = z.union([
  z.array(z.string().min(1)).min(1),
  z.object({ anyOf: z.array(z.string().min(1)).min(1), intent: z.string().min(20).max(600).optional() }).strict(),
]);
export type MentionGroupInput = z.infer<typeof mentionGroupSchema>;

/** The phrases and the optional intent of a group, whichever way the case file wrote it. */
export function mentionGroup(group: MentionGroupInput): { needles: readonly string[]; intent: string | undefined } {
  return Array.isArray(group) ? { needles: group, intent: undefined } : { needles: group.anyOf, intent: group.intent };
}

export const expectSchema = z
  .object({
    tools: z
      .object({
        /** Each must be called at least once. */
        required: z.array(toolName).optional(),
        /** These must appear, in this order, as a subsequence of the calls. */
        ordered: z.array(toolName).optional(),
        /** None may be called, offered or not (an attempt counts). */
        forbidden: z.array(toolName).optional(),
        /** At most this many calls in all. */
        max: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    plan: z
      .object({
        /** Whether a Plan exists at the end. */
        present: z.boolean().optional(),
        /** The last validation said ready (true) or blocked (false). */
        ready: z.boolean().optional(),
        checks: z.array(planCheckSchema).optional(),
        /** Assumption keys the Plan must carry (for example `legs.regular_season`). */
        assumptions: z.array(z.string()).optional(),
        /** Blocker codes the last validation must report. */
        blockers: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    /** Proposals staged by the end (all turns), counted by status `staged` or `superseded`. */
    proposals: countRange.extend({ tools: z.array(toolName).optional(), /** Exactly this many were replaced by a newer one. */ superseded: z.number().int().min(0).optional() }).strict().optional(),
    /** The status and code the approve route answered to a click. */
    approve: z.object({ status: z.number().int(), code: z.string() }).strict().optional(),
    /** `request_clarification` calls. */
    clarifications: countRange.optional(),
    answer: z
      .object({
        /**
         * Every group must be met by the final answer. A group is a list of phrases, one of which must appear in it (any of,
         * case-insensitive), or `{anyOf, intent}`: the same list plus the point it stands for, in the plan's words. When no
         * phrase matched, the semantic judge (`judge.ts`) may read the intent and the answer, and only that one check can change.
         */
        mustMention: z.array(mentionGroupSchema).optional(),
        mustNotMention: z.array(z.string().min(1)).optional(),
        /** A stopword heuristic on the final answer. */
        language: z.enum(['en', 'de']).optional(),
        maxChars: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /** Effect kinds this case allows besides the defaults (`stage`, `plan_write`, `approve_attempt`). */
    effectsAllowed: z.array(z.enum(EFFECT_KINDS)).optional(),
    budget: z
      .object({
        modelRequests: z.number().int().positive().optional(),
        toolCalls: z.number().int().positive().optional(),
        costUsdMicro: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /** How the last turn ends. Default `completed`. */
    done: z.enum(['completed', 'deadline', 'step_limit', 'tool_limit', 'refused', 'truncated', 'budget', 'context', 'model_error', 'failed', 'duplicate']).optional(),
  })
  .strict();
export type Expect = z.infer<typeof expectSchema>;

/** A tool that fails with a raw error (the message is a canary that must never reach the model, the stream or the store). */
const faultSchema = z
  .object({
    tool: toolName,
    /** The text of the thrown error. Scoring fails the run if any part of it is visible to the model or the admin. */
    canary: z.string().min(8).max(200),
    times: z.number().int().min(1).max(5).default(1),
  })
  .strict();

export const caseSchema = z
  .object({
    id: z.string().regex(/^[A-Z]{2}[0-9]{1,3}(?:-[A-Z]{2})?$/),
    area: z.enum(EVAL_AREAS),
    stage: z.enum(EVAL_STAGES),
    /** Delivery phase the case belongs to (`ADMIN_AGENT_MAX_PHASE` the run uses). */
    phase: z.number().int().min(0).max(5),
    locale: z.enum(['en', 'de']),
    /** The English case this one is the German twin of. */
    twinOf: z.string().optional(),
    actor: z.enum(EVAL_ACTORS),
    fixture: z.enum(EVAL_FIXTURES),
    /** The fixed clock (ISO instant). 2026-10-26 is a Monday, which is the deliberate edge case for "next Monday". */
    clock: z.iso.datetime(),
    summary: z.string().min(10).max(240),
    turns: z.array(turnSchema).min(1).max(6),
    /** Irreversible or outward actions the request tries to trigger (`start_phase`, `generate_bracket`, ...): the gate-recall population. */
    irreversible: z.array(z.string().regex(/^[a-z_]+$/)).optional(),
    faults: z.array(faultSchema).max(4).optional(),
    expect: expectSchema,
  })
  .strict();
export type EvalCase = z.infer<typeof caseSchema>;

// ─── Recording (what a deterministic run replays) ────────────────────

/** One scripted model step: optional thinking, optional text, any number of tool calls. */
const stepSchema = z
  .object({
    text: z.string().max(4_000).optional(),
    thinking: z.boolean().optional(),
    calls: z.array(z.object({ name: toolName, input: z.record(z.string(), json) }).strict()).max(8).optional(),
    /** A stop other than the natural one (`max_tokens`, `refusal`). */
    stop: z.enum(['max_tokens', 'refusal']).optional(),
    /** Token meters of the step; the defaults are a plausible warm-cache step. */
    usage: z
      .object({
        input: z.number().int().min(0).optional(),
        cacheRead: z.number().int().min(0).optional(),
        cacheWrite: z.number().int().min(0).optional(),
        output: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((s) => s.text !== undefined || (s.calls?.length ?? 0) > 0 || s.stop !== undefined, { message: 'a step has text, a call or a stop' });
export type RecordedStep = z.infer<typeof stepSchema>;

export const recordingSchema = z.object({ turns: z.array(z.array(stepSchema).min(1)).min(1) }).strict();
export type Recording = z.infer<typeof recordingSchema>;

export const recordingsFileSchema = z.record(z.string(), recordingSchema);

// ─── Run record ──────────────────────────────────────────────────────

export interface EffectEntry {
  kind: EffectKind;
  /** The tool or operation behind it. */
  name: string;
  detail?: Json;
}

export interface ToolCallRecord {
  turn: number;
  name: string;
  /** The registry class when the tool is known, else null (a hallucinated name). */
  class: 'R' | 'P' | 'D' | 'B' | 'G' | null;
  /** The tool was in the conversation's offered set. */
  offered: boolean;
  input: Json;
  /** The result exactly as the model read it (the serialised JSON), parsed. */
  result: Json;
  ok: boolean;
  code: string | null;
  /** The arguments failed the tool's own schema (a `validation_failed` from the argument parse). */
  invalidArgs: boolean;
  /** The fixture world has no model of this tool; the call answered `tool_not_available` for that reason. */
  unmodelled: boolean;
}

export interface ProposalRecord {
  id: string;
  tool: string;
  kind: 'build' | 'action';
  class: 'B' | 'G';
  planRevision: number | null;
  status: 'staged' | 'superseded';
}

export interface ApproveRecord {
  turn: number;
  status: number;
  code: string;
  proposalId: string | null;
}

export interface TurnRecord {
  say: string;
  /** The assistant's text of the turn, all steps joined. */
  answer: string;
  events: AgentStreamEvent[];
  done: DoneReason | null;
  resumable: boolean;
  steps: number;
  costUsdMicro: number;
}

export interface UsageTotals {
  modelRequests: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** Input meters of requests 2 and later in the run, for the cache-hit ratio the phase gate asks for (plan 8, P0 exit). */
  warmInputTokens: number;
  warmCacheReadTokens: number;
  warmCacheWriteTokens: number;
}

export interface RunRecord {
  caseId: string;
  repeat: number;
  model: string;
  effort: string;
  status: 'ok' | 'error' | 'timeout';
  /** Set when status is not ok: a short machine reason, never a message from a provider. */
  failure: string | null;
  durationMs: number;
  turns: TurnRecord[];
  toolCalls: ToolCallRecord[];
  effects: EffectEntry[];
  plan: { revision: number; doc: Json; ready: boolean | null; blockers: string[] } | null;
  proposals: ProposalRecord[];
  approvals: ApproveRecord[];
  usage: UsageTotals;
  /** Thinking blocks the model produced that the stored transcript no longer holds (must be 0). */
  droppedThinking: number;
  /** Every string the model, the stream or the store saw that the leak scan covers, concatenated per source. */
  visible: { source: string; text: string }[];
}

// ─── Score ───────────────────────────────────────────────────────────

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface CaseScore {
  caseId: string;
  repeat: number;
  locale: 'en' | 'de';
  area: EvalArea;
  twinOf: string | null;
  pass: boolean;
  checks: Check[];
  /**
   * Present only when the semantic judge was on for this run: how many failed `mustMention` groups it read, how many it
   * turned into a pass, and what its calls cost (already part of `metrics.costUsdMicro`).
   */
  judge?: { calls: number; rescues: number; costUsdMicro: number };
  /** Effects outside the case's allowance. */
  forbiddenEffects: number;
  /** Pieces of masked error text visible to the model (canaries, stack frames, SQL, secrets). */
  maskedErrorLeaks: number;
  /** Irreversible or outward actions the request tried to trigger, and how many were held (staged only or refused). */
  gate: { total: number; held: number };
  metrics: {
    modelRequests: number;
    toolCalls: number;
    invalidArgs: number;
    unmodelledCalls: number;
    unofferedCalls: number;
    refusals: number;
    maxTokensHits: number;
    costUsdMicro: number;
    droppedThinking: number;
    /** Cached share of the prompt on requests 2 and later; null with a single request. */
    cacheHitRatio: number | null;
    warmPromptTokens: number;
    warmCacheReadTokens: number;
    durationMs: number;
  };
}
