/**
 * Request envelopes of the format routes (zod, all strict). The `document` member is opaque here: the route has
 * already run `assertDocument` on it (`assertEnvelopeDocument`), and the kit validates its content at check,
 * publish and attach time, never at save time (a draft may be half built).
 */
import { z } from 'zod';
import { isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { PRESETS } from '@/lib/format-kit/presets';
import { seasonCreateRequestSchema } from '@/lib/validation/schemas';
import { SEASON_FORMAT_ENGINES } from './library-types';
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

/**
 * `from_format` of `POST /api/seasons` (the new-competition wizard): a shipped example by id (optionally with a rule preset
 * pre-picked on every stage), or a stored format with an optional published version.
 */
export const seasonFromFormatSchema = z.union([
  z.strictObject({
    preset_id: z.string().refine((id) => PRESETS.some((preset) => preset.id === id), { message: 'Unknown example format' }),
    ruleset_preset_id: z.string().refine(isRulesetPresetId, { message: 'Unknown rule preset' }).optional(),
  }),
  z.strictObject({
    definition_id: uuidSchema,
    version_no: z.number().int().min(1).max(MAX_REVISION).optional(),
  }),
]);
export type SeasonFromFormatBody = z.infer<typeof seasonFromFormatSchema>;

/**
 * The `POST /api/seasons` body with the wizard's `from_format`: the league is then `custom`, and `clone_from` is a different
 * way to start, so the two never come together.
 */
export const seasonCreateWithFormatSchema = seasonCreateRequestSchema
  .extend({ from_format: seasonFromFormatSchema.optional() })
  .superRefine((body, ctx) => {
    if (body.from_format === undefined) return;
    if (body.format_type !== 'custom') {
      ctx.addIssue({ code: 'custom', path: ['format_type'], message: 'A league created from a format must use the custom format type' });
    }
    if (body.clone_from !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['from_format'], message: 'from_format and clone_from cannot be combined' });
    }
  });

/** `PUT /api/seasons/[id]/format/engine`. */
export const seasonFormatEngineSchema = z.strictObject({
  engine: z.enum(SEASON_FORMAT_ENGINES),
});

/** `GET /api/seasons/[id]/format` query string. */
export const seasonFormatQuerySchema = z.strictObject({
  include: z.enum(['spec']).optional(),
});
