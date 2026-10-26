/**
 * Server compile entry: validates with the zod schema (`validate.ts`), then runs the shared pipeline.
 * Results are memoised by content hash and environment in a 32-entry LRU cache.
 */
import { compileWithValidator, type CompileResult } from './engine/core';
import { LruCache } from './engine/memo';
import { validateFormatDefinition } from './validate';

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
