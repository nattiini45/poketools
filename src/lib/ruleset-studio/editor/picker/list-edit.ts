/**
 * Edits of a plain list of entry ids (no preset, no document): what the compact list editor does when its picker acts on
 * ids. A ban adds the ids, an unban or a reset removes them, a toggle flips each one, an allow adds. The list stays sorted
 * and free of duplicates, never grows past the document limit, and the same array comes back when nothing changed.
 * Pure and client-safe.
 */
import { MAX_ID_LENGTH, MAX_IDS_PER_LIST } from '@/lib/ruleset-kit/limits';
import type { BulkAction } from './bulk';

const ID_PATTERN = /^[a-z0-9]+$/;

export function applyListAction(list: readonly string[], action: BulkAction, ids: readonly string[]): readonly string[] {
  const next = new Set(list);
  for (const id of ids) {
    if (id.length === 0 || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) continue;
    const add = action === 'ban' || action === 'allow' || (action === 'toggle' && !next.has(id));
    if (add) {
      if (!next.has(id) && next.size < MAX_IDS_PER_LIST) next.add(id);
    } else {
      next.delete(id);
    }
  }
  if (next.size === list.length && list.every((id) => next.has(id))) return list;
  return [...next].sort();
}
