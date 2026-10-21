/**
 * Browser twin of `validate.ts`: the identity, so zod and the pack schema stay out of client
 * bundles. The server, the build and the tests validate the same pack.
 */
import type { FormatPack } from './types';

export function validatePack<P extends FormatPack>(pack: P): P {
  return pack;
}
