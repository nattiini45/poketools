import { formatPack } from '@/lib/format-pack';
import { upsertFormatRules } from '@/lib/supabase/queries/format-rules';
import {
  DEFAULT_BANNED_MOVES,
  DEFAULT_BANNED_ITEMS,
  DEFAULT_TERA_RULES,
  DEFAULT_TIEBREAKER_ORDER,
} from '@/types/format-rules';
import type { FormatRulesFormData } from '@/types/format-rules';

const D = formatPack.epb.defaults;

/**
 * Default format rules for Evolution Point Buy, from the active format pack (`epb.defaults`,
 * `epb.teraByStage`, `epb.tiebreakerChain`).
 * These are automatically applied when a season with this format is created.
 */
export const EPB_DEFAULT_RULES: FormatRulesFormData = {
  banned_moves: DEFAULT_BANNED_MOVES,
  banned_items: DEFAULT_BANNED_ITEMS,
  tera_rules: { ...DEFAULT_TERA_RULES },
  tiebreaker_order: DEFAULT_TIEBREAKER_ORDER,
  draft_budget: D.draftBudget,
  draft_picks: D.draftPicks,
  draft_token_ratio: D.tokenRatio,
  draft_token_max: D.tokenMax,
  draft_token_max_per_line: D.tokenMaxPerLine,
};

/**
 * Initialize default format rules for a newly created EPB season.
 * Called automatically during season creation — admins do not need to
 * press "Initialize" during normal setup.
 */
export async function initializeEpbFormatRules(seasonId: string): Promise<void> {
  await upsertFormatRules(seasonId, EPB_DEFAULT_RULES);
}
