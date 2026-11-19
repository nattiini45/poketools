import { z } from 'zod';
import { castSessionCreateSchema, castSessionPopulateSchema, castSessionUpdateSchema } from '@/lib/validation';

const phaseRefId = z.string().uuid().transform((id) => id.toLowerCase());
const phaseRefSchema = z.strictObject({
  season_id: phaseRefId,
  phase_id: phaseRefId,
  match_id: phaseRefId.nullable(),
});

export const studioCastSessionCreateSchema = castSessionCreateSchema.extend({
  phase_ref: phaseRefSchema.optional(),
});
export const studioCastSessionUpdateSchema = castSessionUpdateSchema.extend({
  phase_ref: phaseRefSchema.optional(),
});
export const studioCastSessionPopulateSchema = z.union([
  castSessionPopulateSchema.strict(),
  z.strictObject({ phase_ref: phaseRefSchema.extend({ match_id: phaseRefId }) }),
]);
