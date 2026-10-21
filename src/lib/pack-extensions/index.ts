import 'server-only';
import { cache } from 'react';
import raw from '@pack-extensions';
import type { PackAdminLink, PackExtensions, PackRequestContext } from './types';

export type * from './types';

/**
 * The active pack's extensions (docs/format-packs.md, "Pack extensions"). The ONLY module that
 * imports `@pack-extensions`; call sites read `packExtensions` and the helpers below.
 *
 * `@pack-extensions` resolves like `@format-pack`: `src/format-packs/<pack>/extensions/index.ts`
 * of the active pack (next.config.mjs, tsconfig paths, vitest.config.ts per project). The example
 * pack exports `{}`, so a public checkout never runs any of this beyond the presence checks.
 */
export const packExtensions: PackExtensions = raw;

/**
 * The request context, memoised per server render. Display-grade: the session copy decides whose
 * choices a provider reads, never what anyone may do. The auth helpers load only here, on first
 * use, so a pack without providers never pulls the session code into a page or route.
 */
const packRequestContext = cache(async (): Promise<PackRequestContext> => {
  const { getSessionPlayer } = await import('@/lib/auth/helpers');
  const player = await getSessionPlayer();
  return { viewerPlayerId: player?.playerId ?? null };
});

/**
 * Whether supplementary records count for this request: the extension's resolver, memoised per
 * render so a page and its sections share one decision; true when the extension has none.
 */
const supplementaryRecordsIncluded = cache(async (): Promise<boolean> => {
  const resolve = packExtensions.includeSupplementaryRecords;
  if (!resolve) return true;
  return resolve(await packRequestContext());
});

/**
 * What a supplementary provider yielded for this request:
 * - `absent`: the active pack has no such provider (nothing ran, nothing to show);
 * - `excluded`: the provider exists but supplementary records do not count for this viewer;
 * - `ready`: the provider's value (null when it has nothing for this subject);
 * - `failed`: the include decision or the provider threw; the error is logged here with the
 *   provider's name, and the call site says so instead of showing partial numbers.
 */
export type SupplementResult<T> =
  | { state: 'absent' }
  | { state: 'excluded' }
  | { state: 'ready'; value: T }
  | { state: 'failed' };

/**
 * Run one supplementary provider for the current request. Never call it inside a cached read.
 * Costs nothing (no session read, no query) when the provider is absent.
 */
export async function loadSupplement<T>(
  name: string,
  provider: ((ctx: PackRequestContext) => Promise<T>) | undefined,
): Promise<SupplementResult<T>> {
  if (!provider) return { state: 'absent' };
  try {
    if (!(await supplementaryRecordsIncluded())) return { state: 'excluded' };
    return { state: 'ready', value: await provider(await packRequestContext()) };
  } catch (err) {
    console.error(`[pack-extensions] ${name} failed:`, err);
    return { state: 'failed' };
  }
}

/**
 * Public pages the active pack extension adds to the site navigation; [] without a provider
 * (nothing runs). A provider is static pack code: an error it throws propagates to the caller
 * (the route's error boundary), it is never swallowed (docs/format-packs.md, "Pack extensions").
 */
export async function siteNavExtraLinks(): Promise<{ href: string; label: string }[]> {
  const siteNavItems = packExtensions.siteNavItems;
  if (!siteNavItems) return [];
  return (await siteNavItems()).map((item) => ({ href: item.href, label: item.label }));
}

/**
 * Admin rail pages the active pack extension adds; [] without a provider (nothing runs). Copies
 * the documented fields only. Errors propagate like `siteNavExtraLinks`.
 */
export async function extensionAdminLinks(): Promise<PackAdminLink[]> {
  const adminLinks = packExtensions.adminLinks;
  if (!adminLinks) return [];
  return (await adminLinks()).map((link) => ({
    href: link.href,
    label: link.label,
    group: link.group,
    siteAdminOnly: link.siteAdminOnly,
    superadminOnly: link.superadminOnly,
  }));
}

/**
 * Labels of the active pack extension's own audit actions (`extension.*`), localized for the
 * request; {} without a provider (nothing runs). Only `extension.`-prefixed keys with a non-empty
 * string label are kept, so an extension cannot relabel a built-in action; an `extension.*` action
 * without a label is shown humanized (`auditActionLabel`). Errors propagate like
 * `siteNavExtraLinks`.
 */
export async function extensionAuditActionLabels(): Promise<Record<string, string>> {
  const provider = packExtensions.auditActionLabels;
  if (!provider) return {};
  const labels = await provider();
  const out: Record<string, string> = {};
  for (const [action, label] of Object.entries(labels)) {
    if (action.startsWith('extension.') && typeof label === 'string' && label.trim() !== '') out[action] = label;
  }
  return out;
}
