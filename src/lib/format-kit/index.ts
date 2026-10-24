/**
 * Server barrel of the format kit: everything in `client.ts` with the zod validator and compile entry in place
 * of the browser ones, plus the zod schemas and the server registry. Server code imports this file; client
 * code imports `client.ts`. Nothing in the app imports either yet.
 */
export * from './types';
export * from './limits';
export * from './keys';
export * from './json';
export * from './patch';
export * from './issues';
export * from './ltext';
export * from './expr';
export * from './expr/schema';
export * from './registry';
export * from './registry/server';
export * from './schema';
export { validateFormatDefinition } from './validate';
export { compile, clearCompileCache, compileCacheSize } from './compile';
export * from './engine/diagnostics';
export * from './engine/env';
export { USER_CHOICE_FIXES } from './engine/fixes';
export type { CompileResult } from './engine/core';
export type { StageGraph, StageNode } from './engine/graph';
export type { CountRange, StagePlan } from './engine/plan';
export { deriveCapabilities } from './engine/capabilities';
export { renderDiagnostic, renderFix, renderSeverity } from './engine/render';
export * from './presets';
