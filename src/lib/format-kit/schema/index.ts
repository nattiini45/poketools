/**
 * Barrel of the zod schemas (SERVER ONLY) and the compile-time proof that the schema output equals
 * the hand-written types in `../types.ts`: if the two drift, `tsc` fails in this file.
 */
import type { z } from 'zod';
import type {
  AdjustRule,
  AdvanceSelect,
  AttributeDef,
  CheckRule,
  CountSource,
  DeadlinePolicy,
  DomainDef,
  Edge,
  Effect,
  EndWhen,
  EventSpec,
  FilterBase,
  FormatDefinition,
  MetricEntry,
  OnEventRule,
  Pairing,
  PlayerActionRule,
  RankStep,
  RelationDef,
  ResourceDef,
  RuleCard,
  RuleEntry,
  Stage,
  StageCalendar,
  TeamConstraint,
  TunableDef,
} from '../types';
import type { LText } from '@/lib/studio-core/ltext';
import { ltextSchema } from '@/lib/studio-core/text-schema';
import { documentShape, ruleEntrySchema } from './document';
import {
  adjustRuleSchema,
  advanceSelectSchema,
  attributeDefSchema,
  checkRuleSchema,
  countSourceSchema,
  deadlinePolicySchema,
  domainDefSchema,
  edgeSchema,
  effectSchema,
  endWhenSchema,
  eventSpecSchema,
  filterBaseSchema,
  metricEntrySchema,
  onEventRuleSchema,
  pairingSchema,
  playerActionRuleSchema,
  rankStepSchema,
  relationDefSchema,
  resourceDefSchema,
  ruleCardSchema,
  stageCalendarSchema,
  stageSchema,
  teamConstraintSchema,
  tunableDefSchema,
} from './primitives';

export * from './common';
export * from './primitives';
export { documentShape, ruleEntrySchema } from './document';

/** Both types assignable to each other: no extra, missing, optional or widened member. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;

export type SchemaMatchesTypes = [
  Expect<Same<z.output<typeof documentShape>, FormatDefinition>>,
  Expect<Same<z.output<typeof stageSchema>, Stage>>,
  Expect<Same<z.output<typeof edgeSchema>, Edge>>,
  Expect<Same<z.output<typeof pairingSchema>, Pairing>>,
  Expect<Same<z.output<typeof rankStepSchema>, RankStep>>,
  Expect<Same<z.output<typeof advanceSelectSchema>, AdvanceSelect>>,
  Expect<Same<z.output<typeof ruleCardSchema>, RuleCard>>,
  Expect<Same<z.output<typeof ruleEntrySchema>, RuleEntry>>,
  Expect<Same<z.output<typeof attributeDefSchema>, AttributeDef>>,
  Expect<Same<z.output<typeof domainDefSchema>, DomainDef>>,
  Expect<Same<z.output<typeof relationDefSchema>, RelationDef>>,
  Expect<Same<z.output<typeof resourceDefSchema>, ResourceDef>>,
  Expect<Same<z.output<typeof metricEntrySchema>, MetricEntry>>,
  Expect<Same<z.output<typeof tunableDefSchema>, TunableDef>>,
  Expect<Same<z.output<typeof eventSpecSchema>, EventSpec>>,
  Expect<Same<z.output<typeof effectSchema>, Effect>>,
  Expect<Same<z.output<typeof onEventRuleSchema>, OnEventRule>>,
  Expect<Same<z.output<typeof playerActionRuleSchema>, PlayerActionRule>>,
  Expect<Same<z.output<typeof checkRuleSchema>, CheckRule>>,
  Expect<Same<z.output<typeof adjustRuleSchema>, AdjustRule>>,
  Expect<Same<z.output<typeof filterBaseSchema>, FilterBase>>,
  Expect<Same<z.output<typeof countSourceSchema>, CountSource>>,
  Expect<Same<z.output<typeof teamConstraintSchema>, TeamConstraint>>,
  Expect<Same<z.output<typeof stageCalendarSchema>, StageCalendar>>,
  Expect<Same<z.output<typeof deadlinePolicySchema>, DeadlinePolicy>>,
  Expect<Same<z.output<typeof endWhenSchema>, EndWhen>>,
  Expect<Same<z.output<typeof ltextSchema>, LText>>,
];

/** The document schema; its output is `FormatDefinition`. */
export const formatDefinitionSchema: z.ZodType<FormatDefinition> = documentShape;
