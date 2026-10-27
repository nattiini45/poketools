/**
 * Client-safe barrel of the ruleset kit: the document and resolved-rules types, the limits, the structural validator,
 * the effective-rules computation and the compile. Nothing here imports zod, `server-only`, `@pkmn`, `next` or React;
 * `__tests__/client-boundary.test.ts` walks the import closure and fails on any of them.
 */
export * from './types';
export * from './limits';
export * from './validate';
export * from './effective';
export * from './compile';
export * from './overlay';
export * from './legacy';
export * from './resolved';
export * from './entry-state';
export * from './ops';
export * from './changes';
