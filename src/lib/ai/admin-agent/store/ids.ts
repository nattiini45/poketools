import { isValidUuid } from '@/lib/utils/uuid';

declare const adminIdBrand: unique symbol;

/**
 * The player id of the admin a store call acts for. Every store method takes one as its first argument and filters by
 * it (plan 3.9 test 8), so a row of another admin is "not found". It is minted only here, from a UUID, so a call that
 * passes a conversation id, a route param or `undefined` where the admin belongs fails to compile.
 */
export type AdminId = string & { readonly [adminIdBrand]: true };

/** Whether `value` is a UUID string (and so can be an `AdminId`). */
export function isAdminId(value: unknown): value is AdminId {
  return typeof value === 'string' && isValidUuid(value);
}

/** The `AdminId` of a live admin's player id (`requireAnyAdmin()` returns it). Throws a `TypeError` for a non-UUID. */
export function adminIdOf(playerId: string): AdminId {
  if (!isAdminId(playerId)) throw new TypeError('admin-agent store: adminId must be a player UUID');
  return playerId.toLowerCase() as AdminId;
}

/** Throws unless `value` is an `AdminId`; the first line of every store method, so a forged argument never reaches a query. */
export function assertAdminId(value: unknown): asserts value is AdminId {
  if (!isAdminId(value)) throw new TypeError('admin-agent store: adminId must be a player UUID');
}
