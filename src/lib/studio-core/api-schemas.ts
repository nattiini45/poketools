/**
 * The pieces of the studio request envelopes that do not depend on the studio (zod, server side): the opaque `document`
 * member, the draft revision, a new definition's name, the visibility, the list query and the 400 answer. A studio's
 * `api-schemas.ts` composes its own strict envelopes from these (adding the slug, UUID and ltext schemas of
 * `text-schema.ts`).
 *
 * The `document` member is opaque here: the route has already run the studio's `assertDocument` on it
 * (`assertEnvelopeDocument`), and the kit validates its content at check and publish time, never at save time (a draft
 * may be half built).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import { STUDIO_KINDS, STUDIO_VISIBILITIES } from './access';
import { DEFINITION_NAME_MAX, isStorableName } from './name';

/** The largest `draft_rev` a client may send (the column is a 32-bit integer). */
export const MAX_REVISION = 2_147_483_646;

/** A plain JSON object, by reference (zod's record parse would copy it and walk its keys). */
export const documentSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  { message: 'Expected a JSON object' },
);

export const draftRevSchema = z.number().int().min(1).max(MAX_REVISION);

/** A new definition's name: the rule in `name.ts`, the same one the browser checks. */
export const definitionNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEFINITION_NAME_MAX)
  .refine(isStorableName, {
    message: 'Name contains characters that cannot be stored',
  });

export const visibilitySchema = z.enum(STUDIO_VISIBILITIES);

export const STUDIO_LIST_SCOPES = ['all', 'mine', 'shared', 'gallery'] as const;

/** `GET` list query string of a studio library (values arrive as text). */
export const studioListQuerySchema = z.strictObject({
  scope: z.enum(STUDIO_LIST_SCOPES).default('all'),
  visibility: visibilitySchema.optional(),
  kind: z.enum(STUDIO_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type StudioListQuery = z.infer<typeof studioListQuerySchema>;

/** The 400 `validation_failed` answer every route gives a rejected envelope. */
export function validationFailedResponse(error: z.ZodError): NextResponse<ApiResult<never>> {
  const issues = formatZodErrors(error);
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 },
  );
}
