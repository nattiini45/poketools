/**
 * The zod schema of a whole `FormatDefinition`. SERVER ONLY.
 *
 * It validates what is left after the shared pre-pass (`prepareDocument`): reserved sections and
 * kinds are already reported and removed, and unknown rule kinds are already degraded to manual
 * rule cards, so the schema itself stays strict and small. It must only see input that
 * `inspectJson` has bounded (depth, nodes, bytes); `validate.ts` guarantees that.
 */
import { z } from 'zod';
import { ltextSchema, slugSchema } from '@/lib/studio-core/text-schema';
import {
  MAX_ATTRIBUTES,
  MAX_DOMAINS,
  MAX_EDGES,
  MAX_METRICS,
  MAX_MODULES,
  MAX_RELATIONS,
  MAX_RESOURCES,
  MAX_RULES,
  MAX_STAGES,
  MAX_TEXT_SECTIONS,
  MAX_TUNABLES,
  MAX_VIEWS,
} from '../limits';
import { boundedArray } from './common';
import {
  adjustRuleSchema,
  attributeDefSchema,
  checkRuleSchema,
  crossStageViewSchema,
  domainDefSchema,
  edgeSchema,
  legacyModuleSchema,
  metricEntrySchema,
  onEventRuleSchema,
  playerActionRuleSchema,
  relationDefSchema,
  resourceDefSchema,
  ruleCardSchema,
  stageSchema,
  textSectionSchema,
  themeSchema,
  tunableDefSchema,
} from './primitives';

/** The open `rules` list after the pre-pass: every kind the document knows (unknown kinds became rule cards). */
export const ruleEntrySchema = z.discriminatedUnion('kind', [
  ruleCardSchema,
  onEventRuleSchema,
  playerActionRuleSchema,
  checkRuleSchema,
  adjustRuleSchema,
]);

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
  attributes: boundedArray(attributeDefSchema, 0, MAX_ATTRIBUTES).optional(),
  domains: boundedArray(domainDefSchema, 0, MAX_DOMAINS).optional(),
  relations: boundedArray(relationDefSchema, 0, MAX_RELATIONS).optional(),
  resources: boundedArray(resourceDefSchema, 0, MAX_RESOURCES).optional(),
  metrics: boundedArray(metricEntrySchema, 0, MAX_METRICS).optional(),
  tunables: boundedArray(tunableDefSchema, 0, MAX_TUNABLES).optional(),
});
