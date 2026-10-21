import 'server-only';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import { publicReads } from '@/lib/cache/public-reads';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';
import type { Locale } from '@/i18n/config';
import type { OverlayConfig } from '@/types/broadcast';
import type { DraftPool } from '@/types/draft';
import type { OverlayLines, OverlayLineRef } from '@/components/broadcast/overlays/DraftViewer';

export type OverlaySearchParams = Record<string, string | string[] | undefined>;

export interface DraftOverlayContext {
  config: OverlayConfig;
  /** `resolveOverlayLocale`: `?lang=` first, then the pool's league language, never the cookie (critique S12). */
  locale: Locale;
  /** Line id → English `[base, final stage]` (stage 3, else stage 2) of the bound list; `{}` for non-EPB pools. */
  lines: OverlayLines;
}

async function loadPool(did: string): Promise<DraftPool | null> {
  try {
    return await getDraftPoolById(did);
  } catch (err) {
    // A malformed id or a read error: the overlay still renders (empty) in the ?lang= / default language.
    console.error('[broadcast/draft] draft pool lookup failed', err);
    return null;
  }
}

/** The bound list's lines, narrowed to the two names the overlay label needs (no prices, rules or ratings). */
async function loadLines(pool: DraftPool): Promise<OverlayLines> {
  try {
    let versionId = pool.list_version_id ?? null;
    if (!versionId) {
      const season = await publicReads.seasonRow(pool.season_id);
      versionId = season?.point_buy_list_id ?? null;
    }
    if (!versionId) return {};
    const entries = await publicReads.pointBuyEntries(versionId);
    const lines: Record<string, OverlayLineRef> = {};
    for (const entry of entries) {
      lines[lineIdOfEntry(entry)] = [entry.base_pokemon, entry.stage3_pokemon ?? entry.stage2_pokemon ?? null];
    }
    return lines;
  } catch (err) {
    // Without the list the overlay falls back to the species names the picks store.
    console.error('[broadcast/draft] point-buy list lookup failed', err);
    return {};
  }
}

/**
 * Everything a draft overlay page needs (draft-frontend §3.5, §8.4): the
 * parsed overlay config, the overlay language and the line names.
 */
export async function loadDraftOverlayContext(
  did: string,
  searchParams: OverlaySearchParams,
  options: { poll?: string; withLines?: boolean } = {},
): Promise<DraftOverlayContext> {
  const urlParams = new URLSearchParams();
  for (const [key, val] of Object.entries(searchParams)) {
    if (typeof val === 'string') urlParams.set(key, val);
  }
  if (options.poll && !urlParams.has('poll')) urlParams.set('poll', options.poll);
  const config = parseOverlayConfig(urlParams);

  const pool = await loadPool(did);
  const [locale, lines] = await Promise.all([
    resolveOverlayLocale(config, pool ? { seasonId: pool.season_id } : {}),
    pool && options.withLines !== false ? loadLines(pool) : Promise.resolve<OverlayLines>({}),
  ]);
  return { config, locale, lines };
}
