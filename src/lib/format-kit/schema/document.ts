/**
 * The zod schema of a whole `FormatDefinition`. SERVER ONLY.
 *
 * It validates what is left after the shared pre-pass (`prepareDocument`): reserved sections and
 * kinds are already reported and removed, and unknown rule kinds are already degraded to manual
 * rule cards, so the schema itself stays strict and small. It must only see input that
 * `inspectJson` has bounded (depth, nodes, bytes); `validate.ts` guarantees that.
 */
import { z } from 'zod';
import { ltextSchema } from '@/lib/studio-core/text-schema';
import { MAX_EDGES, MAX_MODULES, MAX_RULES, MAX_STAGES, MAX_TEXT_SECTIONS, MAX_VIEWS } from '../limits';
import { boundedArray, slugSchema } from './common';
import {
  crossStageViewSchema,
  edgeSchema,
  legacyModuleSchema,
  ruleCardSchema,
  stageSchema,
  textSectionSchema,
  themeSchema,
} from './primitives';

/** The open `rules` list after the pre-pass: only `rule.custom` cards remain. */
export const ruleEntrySchema = z.discriminatedUnion('kind', [ruleCardSchema]);

export const documentShape = z.strictObject({
  schema_version: z.literal(1),
  identity: z.strictObject({
    name: ltextSchema,
    summary: ltextSchema.optional(),
    based_on: slugSchema.optional(),
  }),
  stages: boundedArray(stageSchema, 1, MAX_STAGES),
  edges: boundedArray(edgeSchema, 0, MAX_EDGES).default(() => []),
  views: boundedArray(crossStageViewSchema, 0, MAX_VIEWS).default(() => []),
  rules: boundedArray(ruleEntrySchema, 0, MAX_RULES).default(() => []),
  text: z
    .strictObject({
      sections: boundedArray(textSectionSchema, 0, MAX_TEXT_SECTIONS).default(() => []),
    })
    .default(() => ({ sections: [] })),
  theme: themeSchema.default(() => ({ world: 'auto' })),
  modules: boundedArray(legacyModuleSchema, 0, MAX_MODULES).default(() => []),
});
