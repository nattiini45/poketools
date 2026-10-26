/**
 * New format documents. Pure and client-safe (no zod): the skeleton a new format starts from.
 */
import { ltext, type Locale } from '@/lib/studio-core/ltext';

/**
 * A new document that has only a name. It is invalid on purpose (no stage): the check the editor shows reports
 * what is still missing.
 */
export function skeletonDocument(name: string, base: Locale): Record<string, unknown> {
  const text = base === 'en' ? ltext('en', name) : ltext('de', undefined, name);
  return { schema_version: 1, identity: { name: text }, stages: [] };
}
