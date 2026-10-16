/**
 * Audit-log action labels (T08/T09). A plain module, not a client one, so
 * server components and client components share the same helper:
 *
 * ```ts
 * const t = useT(adminCoreMessages);
 * auditActionLabel(t, entry.action); // 'player.role.assign' → 'Role assigned'
 * ```
 */
import type { Translator } from '../core';
import type adminCoreEn from '../messages/admin-core/en';

export type AdminCoreMessagesEn = typeof adminCoreEn;

/**
 * Label of an audit-log action (`player.role.assign`): the `auditActions`
 * message (keys use `__` for the dots), else the old humanized raw value for
 * actions the catalog does not know (rows written before a rename).
 */
export function auditActionLabel(t: Translator<AdminCoreMessagesEn>, action: string): string {
  const humanized = action.replace(/\./g, ' ').replace(/_/g, ' ');
  if (!/^[A-Za-z0-9_.]+$/.test(action)) return humanized;
  return t.dynamic(`auditActions.${action.replace(/\./g, '__')}`, undefined, humanized);
}
