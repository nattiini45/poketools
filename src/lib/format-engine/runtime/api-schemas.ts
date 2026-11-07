/**
 * The request bodies and query strings of the live-format routes (server side, zod). Every body is a `strictObject`: an
 * unknown member (an `actor_id`, say) is a 400, never ignored. Ids are UUIDs, keys follow the format kit's key rule, and
 * free text (`reason`, `note`) must be storable (no NUL, no lone surrogate).
 *
 * The schemas are a cheap structural first line. The authoritative checks are in the library (`applyAdjustment`'s
 * `prepare`, the SQL functions), because the assistant and other callers reach it without this layer. `toAdjustmentInput`
 * maps the snake_case body to the camelCase `AdjustmentInput` in one place so the mapping is tested once.
 *
 * `outcome` is deliberately not an adjustment kind of the body: it is record-only in the library and not exposed.
 * Server only (zod): the UI imports the types of `view-types.ts` and `client-api-admin.ts`, never this file.
 */
import { z } from 'zod';
import { MAX_ACTION_STEPS, MAX_DOMAIN_ENTRIES, MAX_STEP_COUNT, SCORE_ABS_MAX } from '@/lib/format-kit/limits';
import { keySchema } from '@/lib/format-kit/schema/common';
import { domainEntrySchema } from '@/lib/format-kit/schema/primitives';
import { FORMAT_ADJUSTMENT_REASON_MAX } from '@/lib/supabase/queries/format-runtime';
import { isStorableText, UUID_PATTERN } from '@/lib/studio-core/keys';
import type { AdjustmentInput } from './adjust';

const uuid = z.string().regex(UUID_PATTERN);
const key = keySchema;

/** Largest accepted body (bytes) of the small bodies, and of an adjustment (a domain amendment can carry 512 entries). */
export const SMALL_BODY_MAX_BYTES = 8 * 1024;
export const ADJUSTMENT_BODY_MAX_BYTES = 256 * 1024;

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

// ─── Player actions ─────────────────────────────────────────────────────────────────────────────

/** The `[actionId]` path segment: a format key. */
export const actionKeyParam = key;

const pick = z.strictObject({ step: z.number().int().min(0).max(MAX_ACTION_STEPS - 1), item_id: key });
export const actionBody = z.strictObject({ picks: z.array(pick).max(MAX_ACTION_STEPS * MAX_STEP_COUNT) });
export type ActionBody = z.infer<typeof actionBody>;

// ─── Challenge ladder ───────────────────────────────────────────────────────────────────────────

export const challengeMakeBody = z.strictObject({ phase_id: uuid, defender_id: uuid });
export const challengeAnswerBody = z.strictObject({ accept: z.boolean() });
export const challengeWithdrawQuery = z.strictObject({ as: z.enum(['self', 'admin']).default('self') });

// ─── Admin adjustments ──────────────────────────────────────────────────────────────────────────

const reason = z
  .string()
  .trim()
  .min(1)
  // Characters (code points), like the table's check.
  .refine((s) => Array.from(s).length <= FORMAT_ADJUSTMENT_REASON_MAX, 'too long')
  .refine(isStorableText);

/** The same bound and shape as the format kit's own scoring values; the column is numeric. Up to 2 decimals. */
const points = z
  .number()
  .finite()
  .min(-SCORE_ABS_MAX)
  .max(SCORE_ABS_MAX)
  .refine((n) => n !== 0, 'zero')
  .refine((n) => Math.round(n * 100) / 100 === n, 'at most 2 decimals');

const link = z.strictObject({ from: uuid, to: uuid }).refine((l) => l.from !== l.to, 'self link');
const links = z
  .array(link)
  .max(512)
  .refine((all) => unique(all.map((l) => l.from)), 'duplicate giver')
  .refine((all) => unique(all.map((l) => l.to)), 'duplicate receiver');

export const adjustmentBody = z.strictObject({
  reason,
  adjustment: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('points'), stage: key, player_id: uuid, points }),
    z.strictObject({ kind: z.literal('rank'), stage: key, order: z.array(uuid).min(1).max(256).refine(unique, 'duplicate player') }),
    z.strictObject({
      kind: z.literal('resource'),
      resource: key,
      player_id: uuid,
      item_id: key.nullable().optional(),
      amount: z.number().int().min(-64).max(64).refine((n) => n !== 0, 'zero'),
    }),
    z
      .strictObject({
        kind: z.literal('relation'),
        relation: key,
        reveal: z.boolean().optional(),
        links: links.optional(),
        /** Draw the links from the league seed on the server (the organizer never sees the mapping being made). */
        draw: z.boolean().optional(),
      })
      .refine((v) => v.reveal === true || v.links !== undefined || v.draw === true, 'nothing to do')
      .refine((v) => !(v.draw === true && v.links !== undefined), 'draw and links are exclusive'),
    z.strictObject({ kind: z.literal('action'), action: key, state: z.enum(['open', 'locked']) }),
    z
      .strictObject({
        kind: z.literal('domain'),
        domain: key,
        add: z.array(domainEntrySchema).max(MAX_DOMAIN_ENTRIES).optional(),
        remove: z.array(key).max(MAX_DOMAIN_ENTRIES).optional(),
      })
      .refine((v) => v.add !== undefined || v.remove !== undefined, 'nothing to do')
      .refine((v) => v.add === undefined || unique(v.add.map((e) => e.id)), 'duplicate entry'),
  ]),
});
export type AdjustmentBody = z.infer<typeof adjustmentBody>;

/** The body of `POST .../adjustments` as the library's input (snake_case to camelCase). */
export function toAdjustmentInput(adjustment: AdjustmentBody['adjustment']): AdjustmentInput {
  switch (adjustment.kind) {
    case 'points':
      return { kind: 'points', stage: adjustment.stage, playerId: adjustment.player_id, points: adjustment.points };
    case 'rank':
      return { kind: 'rank', stage: adjustment.stage, order: adjustment.order };
    case 'resource':
      return {
        kind: 'resource',
        resource: adjustment.resource,
        playerId: adjustment.player_id,
        ...(adjustment.item_id !== undefined ? { itemId: adjustment.item_id } : {}),
        amount: adjustment.amount,
      };
    case 'relation':
      return {
        kind: 'relation',
        relation: adjustment.relation,
        ...(adjustment.reveal !== undefined ? { reveal: adjustment.reveal } : {}),
        ...(adjustment.links !== undefined ? { links: adjustment.links.map((l) => ({ from: l.from, to: l.to })) } : {}),
        ...(adjustment.draw !== undefined ? { draw: adjustment.draw } : {}),
      };
    case 'action':
      return { kind: 'action', action: adjustment.action, state: adjustment.state };
    case 'domain':
      return {
        kind: 'domain',
        domain: adjustment.domain,
        ...(adjustment.add !== undefined ? { add: adjustment.add } : {}),
        ...(adjustment.remove !== undefined ? { remove: adjustment.remove } : {}),
      };
  }
}

// ─── Admin checks and lists ─────────────────────────────────────────────────────────────────────

export const checkResolveBody = z.strictObject({
  /** Not `status`: a response (and a request) of this surface never has a member of that name. */
  verdict: z.enum(['confirmed', 'rejected']),
  note: z
    .string()
    .trim()
    // Characters (code points), like `reason` and like the admin UI's counter: `.max` would count UTF-16 units.
    .refine((s) => Array.from(s).length <= FORMAT_ADJUSTMENT_REASON_MAX, 'too long')
    .refine(isStorableText)
    .optional(),
});
export type CheckResolveBody = z.infer<typeof checkResolveBody>;

const limit = z.coerce.number().int().min(1).max(100).default(50);
const offset = z.coerce.number().int().min(0).max(10_000).default(0);

/** `GET .../checks?status=&limit=&offset=` (`status` is a QUERY parameter, never a response member). */
export const checkListQuery = z.strictObject({
  status: z.enum(['open', 'confirmed', 'rejected', 'all']).default('open'),
  limit,
  offset,
});
export type CheckListQuery = z.infer<typeof checkListQuery>;

/** `GET .../adjustments?limit=&offset=`. */
export const adjustmentListQuery = z.strictObject({ limit, offset });
export type AdjustmentListQuery = z.infer<typeof adjustmentListQuery>;

/** `POST .../relations/unmask` takes no input. */
export const unmaskBody = z.strictObject({});
