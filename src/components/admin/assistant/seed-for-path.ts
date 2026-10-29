import type { ConversationSeed } from './types';

/**
 * The seed a conversation started from the drawer carries: the area of the page the admin is on, nothing else. A seed is
 * a whitelisted key plus ids (plan 5.2), so no id is taken from the path here: a page that wants an entity in the seed
 * passes it through its own entry point, and the server checks it with the entity's guard.
 */
export function seedForPath(pathname: string | null): ConversationSeed {
  const path = pathname ?? '';
  if (path === '/admin/leagues') return { area: 'leagues' };
  if (path.startsWith('/admin/rulesets')) return { area: 'rulesets' };
  if (path.startsWith('/admin/formats')) return { area: 'formats' };
  if (path === '/admin/tournaments') return { area: 'tournaments' };
  return { area: 'admin' };
}
