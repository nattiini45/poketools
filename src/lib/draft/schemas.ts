/**
 * Request schemas of the queue-engine draft, redraft and token routes
 * (draft-backend §8.1–§8.2; critique B6). Client-safe zod: the admin forms may
 * pre-validate with the same schemas. Every body object is `.strict()`; a zod
 * failure answers `400 validation_failed {issues}` (`errors/common`, via
 * `draftErrorResponse`). Query schemas strip unknown keys instead.
 *
 * Field names equal the DB columns and DTO keys (`DraftConfig`); there is no
 * `token_purchase_cutoff_at` and no redraft `open` flag.
 */
import { z } from 'zod';
import { LINE_ID_PATTERN } from '@/lib/draft/line-identity';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import { DRAFT_AUDIT_ACTIONS, type DraftConfig, type DraftConfigInput } from '@/types/draft-queue';

// ── Building blocks ──────────────────────────────────────────────────────

export const LINE_ID_MAX_LENGTH = 80;
export const lineIdSchema = z.string().max(LINE_ID_MAX_LENGTH).regex(LINE_ID_PATTERN);
export const uuidSchema = z.uuid();
/** Admin/audit reasons: trimmed, 3..500 characters. */
export const reasonSchema = z.string().trim().min(3).max(500);
/** ISO-8601 UTC instant (`…Z`). */
export const isoInstantSchema = z.iso.datetime();

/** Limits of the stored config (§8.2); the DB CHECKs of M2 are the outer bounds. */
export const DRAFT_CONFIG_LIMITS = {
  roster_size: { min: 1, max: 20 },
  budget: { min: 1, max: 1000 },
  pick_seconds: { live: { min: 30, max: 86_400 }, slow: { min: 600, max: 172_800 } },
  makeup_seconds: { min: 30 },
  slow_ladder_seconds: { minLength: 1, maxLength: 6, min: 600, max: 172_800 },
  redraft_max_lines: { min: 0, max: 20 },
  participant_order: { min: 2, max: 32 },
} as const;

const L = DRAFT_CONFIG_LIMITS;

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isFuture(iso: string): boolean {
  return Date.parse(iso) > Date.now();
}

const participantOrderSchema = z
  .array(uuidSchema)
  .min(L.participant_order.min)
  .max(L.participant_order.max)
  .refine(isUnique, { message: 'participant_order must not repeat a player' });

const slowLadderSchema = z
  .array(z.int().min(L.slow_ladder_seconds.min).max(L.slow_ladder_seconds.max))
  .min(L.slow_ladder_seconds.minLength)
  .max(L.slow_ladder_seconds.maxLength)
  .refine((ladder) => ladder.every((secs, idx) => idx === 0 || secs <= ladder[idx - 1]), {
    message: 'slow_ladder_seconds must not increase',
  });

/** The config fields whose validity depends on each other. */
export type DraftConfigCore = Pick<
  DraftConfig,
  'mode' | 'roster_size' | 'budget' | 'pick_seconds' | 'makeup_seconds' | 'slow_ladder_seconds' | 'redraft_max_lines'
>;

/**
 * First invalid field of a complete (stored + patched) config, or null. Routes merge the
 * stored pool config with the request and raise `INVALID_CONFIG {field}` for the result,
 * because a PATCH may change `mode` without `pick_seconds` (or the reverse).
 */
export function invalidDraftConfigField(c: DraftConfigCore): keyof DraftConfigCore | null {
  const intIn = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (c.mode !== 'live' && c.mode !== 'slow') return 'mode';
  if (!intIn(c.roster_size, L.roster_size.min, L.roster_size.max)) return 'roster_size';
  if (!intIn(c.budget, L.budget.min, L.budget.max)) return 'budget';
  const pick = L.pick_seconds[c.mode];
  if (!intIn(c.pick_seconds, pick.min, pick.max)) return 'pick_seconds';
  if (!intIn(c.makeup_seconds, L.makeup_seconds.min, c.pick_seconds)) return 'makeup_seconds';
  if (!slowLadderSchema.safeParse(c.slow_ladder_seconds).success) return 'slow_ladder_seconds';
  if (c.redraft_max_lines !== null && !intIn(c.redraft_max_lines, L.redraft_max_lines.min, c.roster_size)) {
    return 'redraft_max_lines';
  }
  return null;
}

/** `DraftConfigInput` (§7.1): every key optional, strict; cross-field rules apply when both keys are present. */
export const draftConfigInputSchema = z
  .object({
    mode: z.enum(['live', 'slow']).optional(),
    roster_size: z.int().min(L.roster_size.min).max(L.roster_size.max).optional(),
    budget: z.int().min(L.budget.min).max(L.budget.max).optional(),
    pick_seconds: z.int().min(L.pick_seconds.live.min).max(L.pick_seconds.slow.max).optional(),
    makeup_seconds: z.int().min(L.makeup_seconds.min).max(L.pick_seconds.slow.max).optional(),
    slow_ladder_seconds: slowLadderSchema.optional(),
    extensions_enabled: z.boolean().optional(),
    redraft_max_lines: z.int().min(L.redraft_max_lines.min).max(L.redraft_max_lines.max).nullable().optional(),
    redraft_lock_no_redraft_lines: z.boolean().optional(),
    participant_order: participantOrderSchema.optional(),
    submission_deadline_at: isoInstantSchema
      .refine(isFuture, { message: 'submission_deadline_at must be in the future' })
      .nullable()
      .optional(),
    token_purchase_closes_at: isoInstantSchema.nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode !== undefined && v.pick_seconds !== undefined) {
      const range = L.pick_seconds[v.mode];
      if (v.pick_seconds < range.min || v.pick_seconds > range.max) {
        ctx.addIssue({ code: 'custom', path: ['pick_seconds'], message: `pick_seconds must be ${range.min}..${range.max} in ${v.mode} mode` });
      }
    }
    if (v.makeup_seconds !== undefined && v.pick_seconds !== undefined && v.makeup_seconds > v.pick_seconds) {
      ctx.addIssue({ code: 'custom', path: ['makeup_seconds'], message: 'makeup_seconds must not exceed pick_seconds' });
    }
    if (
      v.redraft_max_lines !== undefined &&
      v.redraft_max_lines !== null &&
      v.roster_size !== undefined &&
      v.redraft_max_lines > v.roster_size
    ) {
      ctx.addIssue({ code: 'custom', path: ['redraft_max_lines'], message: 'redraft_max_lines must not exceed roster_size' });
    }
  }) satisfies z.ZodType<DraftConfigInput>;

// ── Draft routes (§8.1) ──────────────────────────────────────────────────

/** #1 `POST /api/drafts` (queue engine). */
export const createQueueDraftSchema = z
  .object({
    season_id: uuidSchema,
    kind: z.enum(['initial', 'redraft']),
    config: draftConfigInputSchema.optional(),
    force: z.boolean().optional(),
  })
  .strict();

/** #3 `PATCH /api/drafts/[id]/config`. */
export const draftConfigPatchSchema = draftConfigInputSchema;

/** #4 `POST /api/drafts/[id]/start`. */
export const startDraftSchema = z.object({}).strict();

/** #5 `POST /api/drafts/[id]/end`. */
export const endDraftSchema = z.object({ reason: reasonSchema }).strict();

/** `POST /api/drafts/[id]/free-order` (legacy pools): the reason is optional and goes to the audit log. */
export const freeOrderSchema = z.object({ reason: z.string().trim().max(500).optional() }).strict();

/** #6 `POST /api/drafts/[id]/pause` (pick clocks only, BR-16). */
export const pauseDraftSchema = z
  .object({ paused: z.boolean(), reason: z.string().trim().max(500).optional() })
  .strict();

/** #7 `GET /api/drafts/[id]/state?since=&include=trackers`. */
export const draftStateQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  include: z.literal('trackers').optional(),
});

/** #9 `POST /api/drafts/[id]/picks` on a queue pool (legacy pools keep `draftPickSchema`). */
export const queuePickSchema = z
  .object({
    slot_id: uuidSchema,
    line_id: lineIdSchema,
    client_request_id: uuidSchema,
    redraft_slot_id: uuidSchema.optional(),
    on_behalf_of: uuidSchema.optional(),
    override_reason: reasonSchema.optional(),
  })
  .strict();

/** #10 `POST /api/drafts/[id]/extensions`. */
export const extensionSchema = z.object({ kind: z.enum(['plus120', 'plus60']), slot_id: uuidSchema }).strict();

/** #11 `POST /api/drafts/[id]/picks/[pickId]/void`. */
export const voidPickSchema = z.object({ reason: reasonSchema, requeue: z.boolean() }).strict();

/** #12 `POST /api/drafts/[id]/picks/[pickId]/correct` (`client_request_id` required, critique B6). */
export const correctPickSchema = z
  .object({
    line_id: lineIdSchema,
    reason: reasonSchema,
    client_request_id: uuidSchema,
    redraft_slot_id: uuidSchema.optional(),
  })
  .strict();

/** #13 `POST /api/drafts/[id]/slots/[slotId]/resolve` (`assign` needs `client_request_id`). */
export const resolveSlotSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('assign'),
      line_id: lineIdSchema,
      reason: reasonSchema,
      client_request_id: uuidSchema,
      redraft_slot_id: uuidSchema.optional(),
      resume: z.boolean().default(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('forfeit'),
      reason: reasonSchema,
      resume: z.boolean().default(true),
    })
    .strict(),
]);

/** #14 `POST /api/drafts/[id]/participants/[playerId]/penalty`; the RPC narrows `stage` to the pool's ladder. */
export const penaltySchema = z.object({ stage: z.int().min(0).max(5), reason: reasonSchema }).strict();

/** Largest `bigint` (Postgres int8): a larger cursor is a validation error, not a 22003 cast overflow (500). */
const BIGINT_MAX = BigInt('9223372036854775807');

/** A positive `draft_action_log.id`, at most 19 digits and within `bigint`. */
const AUDIT_CURSOR_PATTERN = /^[1-9]\d{0,18}$/;
export const auditCursorSchema = z
  .string()
  .refine((v) => AUDIT_CURSOR_PATTERN.test(v) && BigInt(v) <= BIGINT_MAX, { message: 'cursor must be a bigint id' });

/**
 * Legacy-engine `POST /api/drafts/[id]/picks` extras beside `draftPickSchema`
 * (`pokemon_name`, `stage3_pokemon`): who the pick is for, and the client's
 * price. The route derives the real cost (pool entry cost, EPB list price);
 * the client value is only a free auction bid or a cross-check, so it must be
 * a non-negative integer.
 */
export const legacyPickExtrasSchema = z.object({
  player_id: uuidSchema.optional(),
  points_spent: z.int().min(0).max(LEGACY_POINTS_MAX).nullable().optional(),
});
export type LegacyPickExtras = z.infer<typeof legacyPickExtrasSchema>;

/** #15 `GET /api/drafts/[id]/audit` — `action` repeatable; `cursor` = a `draft_action_log.id` (bigint). */
export const auditQuerySchema = z.object({
  action: z.array(z.enum(DRAFT_AUDIT_ACTIONS)).optional(),
  player: uuidSchema.optional(),
  cursor: auditCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Builds the `auditQuerySchema` input from URL search params (keeps repeated `action` keys). */
export function auditQueryInput(searchParams: URLSearchParams): Record<string, unknown> {
  const actions = searchParams.getAll('action');
  return {
    action: actions.length > 0 ? actions : undefined,
    player: searchParams.get('player') ?? undefined,
    cursor: searchParams.get('cursor') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  };
}

/** #17 `PUT /api/drafts/[id]/favorites`. */
export const favoriteSchema = z.object({ line_id: lineIdSchema, favorite: z.boolean() }).strict();

// ── Redraft routes ───────────────────────────────────────────────────────

/** #18 `GET /api/drafts/[id]/redraft/submission[?player_id=]`. */
export const redraftSubmissionQuerySchema = z.object({ player_id: uuidSchema.optional() });

/** #19 `PUT /api/drafts/[id]/redraft/submission`. */
export const redraftSubmissionSchema = z
  .object({
    line_ids: z
      .array(lineIdSchema)
      .max(L.redraft_max_lines.max)
      .refine(isUnique, { message: 'line_ids must not repeat a line' }),
  })
  .strict();

/** #21 `PATCH /api/drafts/[id]/redraft` (submissions phase only; there is no `open` field). */
export const redraftPatchSchema = z
  .object({
    deadline_at: isoInstantSchema.refine(isFuture, { message: 'deadline_at must be in the future' }).optional(),
    redraft_max_lines: z.int().min(L.redraft_max_lines.min).max(L.redraft_max_lines.max).optional(),
    participant_order: participantOrderSchema.optional(),
  })
  .strict();

/** #22 `POST /api/drafts/[id]/redraft/publish` (the RPC requires `reason` with `force`). */
export const redraftPublishSchema = z.object({ force: z.boolean().optional(), reason: reasonSchema.optional() }).strict();

/** #23 `POST /api/drafts/[id]/redraft/slots/[redraftSlotId]/restore`. */
export const restoreDropSchema = z.object({ reason: reasonSchema }).strict();

// ── Token routes ─────────────────────────────────────────────────────────

/** #25 `GET /api/seasons/[id]/tokens/me[?player_id=]`. */
export const tokensQuerySchema = z.object({ player_id: uuidSchema.optional() });

/** #26 `POST /api/seasons/[id]/draft-kill-tokens` (one token per request, BR-4). */
export const draftKillTokenPurchaseSchema = z.object({ line_id: lineIdSchema, client_request_id: uuidSchema }).strict();

/** #27 `POST /api/seasons/[id]/comeback-tokens/spend`. */
export const comebackSpendSchema = z
  .object({
    allocations: z
      .array(z.object({ line_id: lineIdSchema, count: z.int().min(1).max(20) }).strict())
      .min(1)
      .max(9)
      .refine((rows) => isUnique(rows.map((r) => r.line_id)), { message: 'allocations must not repeat a line' }),
    client_request_id: uuidSchema,
  })
  .strict();

/** #28 `POST /api/seasons/[id]/comeback-tokens/open`. */
export const comebackOpenSchema = z.object({ open: z.boolean() }).strict();

// ── Cron ─────────────────────────────────────────────────────────────────

/** #32 `GET/POST /api/cron/draft-ticks?limit=`. */
export const draftTicksQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

export type CreateQueueDraftInput = z.infer<typeof createQueueDraftSchema>;
export type QueuePickInput = z.infer<typeof queuePickSchema>;
export type ResolveSlotInput = z.infer<typeof resolveSlotSchema>;
export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type ComebackSpendInput = z.infer<typeof comebackSpendSchema>;
