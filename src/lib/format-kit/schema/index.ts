/**
 * Barrel of the zod schemas (SERVER ONLY) and the compile-time proof that the schema output equals
 * the hand-written types in `../types.ts`: if the two drift, `tsc` fails in this file.
 */
import type { z } from 'zod';
import type {
  AdvanceSelect,
  Edge,
  FormatDefinition,
  LText,
  Pairing,
  RankStep,
  RuleCard,
  Stage,
} from '../types';
import { documentShape } from './document';
import { ltextSchema } from '@/lib/studio-core/text-schema';
import {
  advanceSelectSchema,
  edgeSchema,
  pairingSchema,
  rankStepSchema,
  ruleCardSchema,
  stageSchema,
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
  Expect<Same<z.output<typeof ltextSchema>, LText>>,
];

/** The document schema; its output is `FormatDefinition`. */
export const formatDefinitionSchema: z.ZodType<FormatDefinition> = documentShape;
