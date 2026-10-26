/**
 * Client-safe barrel of the primitive registry: kinds, manifest, Spec types, the document spec, the
 * Spec validator and `describePrimitive`. The zod twin (`server.ts`) is NOT exported here.
 */
export * from './kinds';
export * from './spec';
export {
  MANIFEST,
  RESERVED_KIND_OWNERS,
  RESERVED_PAIRING_TAGS,
  RESERVED_RULE_KINDS,
  RESERVED_SECTIONS,
  RESERVED_STAGE_FIELDS,
  manifestEntry,
  manifestForSlot,
  specOf,
  type ManifestEntry,
  type ManifestSlot,
  type PrimitiveLevel,
} from './manifest';
export { DOCUMENT_SPEC } from './document-spec';
export {
  classifyRuleEntry,
  cloneJson,
  createSpecOut,
  precheckInput,
  prepareDocument,
  validateSpec,
  type PreparedDocument,
  type RuleDecision,
  type SpecOut,
} from './validate-spec';
export { describePrimitive } from './describe';
