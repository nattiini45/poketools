/**
 * Client-safe barrel of the format kit: types, limits, keys, JSON and patch helpers, localized text, the
 * expression language (without its zod schema), the registry (manifest and descriptions, not the zod twin),
 * the browser validator, the browser compile entry, diagnostic rendering, the whole-definition renderer and the presets.
 *
 * Nothing here imports zod, `server-only`, `@pkmn`, `next` or React; `__tests__/client-boundary.test.ts`
 * walks the import closure of this file and fails on any of them. Client code imports this file and never the
 * server barrel, so no bundler alias is needed: the entry file is the boundary (the Studio client-boundary test
 * enforces it for the Studio components and pages).
 */
export * from './types';
export * from './limits';
export * from './keys';
export * from './json';
export * from './patch';
export * from './issues';
export * from './ltext';
export * from './expr';
export * from './registry';
export { validateFormatDefinition } from './validate.browser';
export { compile, clearCompileCache, compileCacheSize } from './compile.browser';
export * from './engine/diagnostics';
export * from './engine/env';
export { USER_CHOICE_FIXES } from './engine/fixes';
export type { CompileResult } from './engine/core';
export type { StageGraph, StageNode } from './engine/graph';
export type { CountRange, StagePlan } from './engine/plan';
export { deriveCapabilities } from './engine/capabilities';
export { renderDiagnostic, renderFix, renderSeverity } from './engine/render';
export * from './engine/describe-definition';
export * from './presets';
