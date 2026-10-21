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
 * Labels of a pack extension's own audit actions (`extension.<name>`), already
 * localized for the request (`extensionAuditActionLabels` in
 * `@/lib/pack-extensions`, passed down by the admin pages). Plain data, so a
 * client component can take it as a prop.
 */
export type ExtensionAuditActionLabels = Readonly<Record<string, string>>;

/**
 * Label of an audit-log action (`player.role.assign`): the `auditActions`
 * message (keys use `__` for the dots); for a pack extension's action
 * (`extension.*`) the extension's own label; else the old humanized raw value
 * for actions no catalog knows (rows written before a rename, or an extension
 * that labels none).
 */
export function auditActionLabel(
  t: Translator<AdminCoreMessagesEn>,
  action: string,
  extensionLabels: ExtensionAuditActionLabels = {},
): string {
  if (action.startsWith('extension.') && Object.prototype.hasOwnProperty.call(extensionLabels, action)) {
    return extensionLabels[action];
  }
  const humanized = action.replace(/\./g, ' ').replace(/_/g, ' ');
  if (!/^[A-Za-z0-9_.]+$/.test(action)) return humanized;
  return t.dynamic(`auditActions.${action.replace(/\./g, '__')}`, undefined, humanized);
}
