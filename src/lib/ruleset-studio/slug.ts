/**
 * Ruleset slugs (the stable address of a stored definition): the studio core's slug helpers
 * (`@/lib/studio-core/slug`) with `ruleset` as the slug of a name with nothing usable (emoji only).
 */
import { slugFromName as coreSlugFromName } from '@/lib/studio-core/slug';

export { withSlugSuffix } from '@/lib/studio-core/slug';

const FALLBACK_SLUG = 'ruleset';

export function slugFromName(name: string): string {
  return coreSlugFromName(name, FALLBACK_SLUG);
}
