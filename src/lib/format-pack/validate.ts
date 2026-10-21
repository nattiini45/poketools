/**
 * Server-side pack validation (spec §B.2). Browser bundles resolve this path to
 * `validate.browser.ts` instead (next.config.mjs `turbopack.resolveAlias`, `browser` condition).
 */
import { parseFormatPack } from './schema';
import type { FormatPack } from './types';

export function validatePack<P extends FormatPack>(pack: P): P {
  return parseFormatPack(pack);
}
