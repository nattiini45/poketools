/**
 * Request envelopes of the format routes (zod, all strict). The `document` member is opaque here: the route has
 * already run `assertDocument` on it (`assertEnvelopeDocument`), and the kit validates its content at check,
 * publish and attach time, never at save time (a draft may be half built).
 */
import { z } from 'zod';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { ltextSchema, slugSchema, uuidSchema } from '@/lib/studio-core/text-schema';
import {
  MAX_REVISION,
  definitionNameSchema,
  documentSchema,
  draftRevSchema,
  studioListQuerySchema,
  visibilitySchema,
} from '@/lib/studio-core/api-schemas';

export { validationFailedResponse } from '@/lib/studio-core/api-schemas';

/** `GET /api/formats` query string (values arrive as text). */
export const formatListQuerySchema = studioListQuerySchema;
export type FormatListQuery = z.infer<typeof formatListQuerySchema>;

/** `POST /api/formats`: a whole document, or just a name to start from a skeleton. */
export const formatCreateSchema = z.union([
  z.strictObject({ document: documentSchema, slug: slugSchema.optional() }),
  z.strictObject({
    name: definitionNameSchema,
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
  visibility: visibilitySchema,
});
export type FormatVisibilityBody = z.infer<typeof formatVisibilitySchema>;

/** `POST /api/formats/[id]/fork` */
export const formatForkSchema = z.strictObject({
  slug: slugSchema.optional(),
});
export type FormatForkBody = z.infer<typeof formatForkSchema>;

/**
 * `POST /api/formats/presets/[presetId]/fork`: the fork body plus an optional rule preset (a catalog id such as
 * `gen9ou` or `gen9natdexdraft`) that is pre-picked on every stage of the copy. An id the catalog does not know is
 * a 400.
 */
export const presetForkSchema = formatForkSchema.extend({
  ruleset_preset: z.string().refine(isRulesetPresetId, { message: 'Unknown rule preset' }).optional(),
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
