/**
 * Request envelopes of the format routes (zod, all strict). The `document` member is opaque here: the route has
 * already run `assertDocument` on it (`assertEnvelopeDocument`), and the kit validates its content at check,
 * publish and attach time, never at save time (a draft may be half built).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isShowdownFormatId, ltextSchema, slugSchema, uuidSchema } from '@/lib/format-kit';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import { FORMAT_KINDS, FORMAT_VISIBILITIES } from './library-types';

/** The largest `draft_rev` a client may send (the column is a 32-bit integer). */
const MAX_REVISION = 2_147_483_646;

/** A plain JSON object, by reference (zod's record parse would copy it and walk its keys). */
const documentSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'Expected a JSON object' },
);

/** A UTF-16 surrogate without its partner: JSON text with one is refused by the database (and by `jsonb`). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const draftRevSchema = z.number().int().min(1).max(MAX_REVISION);

export const FORMAT_LIST_SCOPES = ['all', 'mine', 'shared', 'gallery'] as const;

/** `GET /api/formats` query string (values arrive as text). */
export const formatListQuerySchema = z.strictObject({
  scope: z.enum(FORMAT_LIST_SCOPES).default('all'),
  visibility: z.enum(FORMAT_VISIBILITIES).optional(),
  kind: z.enum(FORMAT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type FormatListQuery = z.infer<typeof formatListQuerySchema>;

/** `POST /api/formats`: a whole document, or just a name to start from a skeleton. */
export const formatCreateSchema = z.union([
  z.strictObject({ document: documentSchema, slug: slugSchema.optional() }),
  z.strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !value.includes('\u0000') && !LONE_SURROGATE.test(value), {
        message: 'Name contains characters that cannot be stored',
      }),
    base_locale: z.enum(['en', 'de']),
    slug: slugSchema.optional(),
  }),
]);
export type FormatCreateBody = z.infer<typeof formatCreateSchema>;

/** `PUT /api/formats/[id]/draft` */
export const formatDraftSchema = z.strictObject({
  draft_rev: draftRevSchema,
  document: documentSchema,
});
export type FormatDraftBody = z.infer<typeof formatDraftSchema>;

/** `POST /api/formats/[id]/publish` */
export const formatPublishSchema = z.strictObject({
  draft_rev: draftRevSchema,
  changelog: ltextSchema.optional(),
});
export type FormatPublishBody = z.infer<typeof formatPublishSchema>;

/** `PATCH /api/formats/[id]` */
export const formatVisibilitySchema = z.strictObject({
  visibility: z.enum(FORMAT_VISIBILITIES),
});
export type FormatVisibilityBody = z.infer<typeof formatVisibilitySchema>;

/** `POST /api/formats/[id]/fork` */
export const formatForkSchema = z.strictObject({
  slug: slugSchema.optional(),
});
export type FormatForkBody = z.infer<typeof formatForkSchema>;

/**
 * `POST /api/formats/presets/[presetId]/fork`: the fork body plus an optional Showdown format (a catalog id such as
 * `gen9ou`) that is pre-picked on every stage of the copy. An id the catalog does not know is a 400.
 */
export const presetForkSchema = formatForkSchema.extend({
  showdown_format: z.string().refine(isShowdownFormatId, { message: 'Unknown Showdown format' }).optional(),
});
export type PresetForkBody = z.infer<typeof presetForkSchema>;

/** `POST /api/seasons/[id]/format` */
export const seasonFormatAttachSchema = z.strictObject({
  definition_id: uuidSchema,
  version_no: z.number().int().min(1).max(MAX_REVISION).optional(),
});
export type SeasonFormatAttachBody = z.infer<typeof seasonFormatAttachSchema>;

/** `GET /api/seasons/[id]/format` query string. */
export const seasonFormatQuerySchema = z.strictObject({
  include: z.enum(['spec']).optional(),
});

/** The 400 `validation_failed` answer every route gives a rejected envelope. */
export function validationFailedResponse(error: z.ZodError): NextResponse<ApiResult<never>> {
  const issues = formatZodErrors(error);
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 },
  );
}
