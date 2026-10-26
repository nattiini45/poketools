/**
 * Browser compile entry: the same pipeline as `compile.ts`, fed by the zod-free validator
 * (`validate.browser.ts`). Same names, same results, no zod in the closure.
 */
import { compileWithValidator, type CompileResult } from './engine/core';
import { LruCache } from './engine/memo';
import { validateFormatDefinition } from './validate.browser';

export { CURRENT_ENV, type CompileEnv } from './engine/env';
export type { CompileResult } from './engine/core';

const cache = new LruCache<CompileResult>(32);

/** Compiles a definition document. Never throws; the result is deep-frozen and holds codes and params only. */
export const compile = compileWithValidator(validateFormatDefinition, cache);

export function clearCompileCache(): void {
  cache.clear();
}

export function compileCacheSize(): number {
  return cache.size;
}
