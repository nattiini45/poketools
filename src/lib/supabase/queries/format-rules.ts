import { supabase } from '../client';
import { formatPack } from '@/lib/format-pack';
import type { Tables, TablesInsert } from '@/types/database';
import type { FormatRules, FormatRulesFormData, TeraRules, TiebreakerStep } from '@/types/format-rules';

type FormatRulesRow = Tables<'format_rules'>;

/** DB row → `FormatRules` (exported for tests). */
export function toFormatRules(row: FormatRulesRow): FormatRules {
  return {
    id: row.id,
    season_id: row.season_id,
    banned_moves: row.banned_moves,
    banned_items: row.banned_items,
    tera_rules: row.tera_rules as unknown as TeraRules,
    tiebreaker_order: row.tiebreaker_order as TiebreakerStep[],
    draft_budget: row.draft_budget,
    draft_picks: row.draft_picks,
    draft_token_ratio: row.draft_token_ratio,
    draft_token_max: row.draft_token_max,
    draft_token_max_per_line: row.draft_token_max_per_line,
    redraft_phase_open: row.redraft_phase_open,
    // `=== true`: the epb_set_redraft_phase_open RPC hands back a jsonb row, so read it defensively.
    comeback_spend_open: row.comeback_spend_open === true,
    created_at: row.created_at,
  };
}

/** Get format rules for a season. Returns null if not configured. */
export async function getFormatRules(seasonId: string): Promise<FormatRules | null> {
  const { data, error } = await supabase
    .from('format_rules')
    .select('*')
    .eq('season_id', seasonId)
    .maybeSingle();

  if (error) throw error;
  return data ? toFormatRules(data) : null;
}

/** Create or update format rules for a season. */
export async function upsertFormatRules(
  seasonId: string,
  input: FormatRulesFormData
): Promise<FormatRules> {
  // Fallbacks of a missing field come from the active format pack (`epb.defaults`, `teraByStage`,
  // `tiebreakerChain`); every column is always written (§D.3: the SQL column defaults stay unused).
  const pack = formatPack.epb;
  const row: TablesInsert<'format_rules'> = {
    season_id: seasonId,
    banned_moves: input.banned_moves ?? [],
    banned_items: input.banned_items ?? [],
    tera_rules: JSON.parse(JSON.stringify(input.tera_rules ?? pack.teraByStage)),
    tiebreaker_order: input.tiebreaker_order ?? [...pack.tiebreakerChain],
    draft_budget: input.draft_budget ?? pack.defaults.draftBudget,
    draft_picks: input.draft_picks ?? pack.defaults.draftPicks,
    draft_token_ratio: input.draft_token_ratio ?? pack.defaults.tokenRatio,
    draft_token_max: input.draft_token_max ?? pack.defaults.tokenMax,
    draft_token_max_per_line: input.draft_token_max_per_line ?? pack.defaults.tokenMaxPerLine,
  };
  // Only written when given: saving other rules must not silently close an opened redraft phase
  // or Comeback switch (a new row takes the column default, false).
  if (input.redraft_phase_open !== undefined) row.redraft_phase_open = input.redraft_phase_open;
  if (input.comeback_spend_open !== undefined) row.comeback_spend_open = input.comeback_spend_open;

  const { data, error } = await supabase
    .from('format_rules')
    .upsert(row, { onConflict: 'season_id' })
    .select()
    .single();

  if (error) throw error;
  return toFormatRules(data);
}

/** Toggle the redraft phase for an EPB season. */
export async function setRedraftPhaseOpen(
  seasonId: string,
  open: boolean
): Promise<FormatRules> {
  const existing = await getFormatRules(seasonId);
  if (!existing) {
    return upsertFormatRules(seasonId, { redraft_phase_open: open });
  }

  // Route the toggle through the epb_set_redraft_phase_open RPC so it takes the
  // SAME per-season advisory lock epb_execute_trade_request uses. This makes a
  // phase close/open mutually exclusive with an in-flight trade execution — the
  // toggle cannot commit while a trade holds the lock, and vice versa — closing
  // the phase-close / trade-execute race. The RPC returns the updated row as
  // jsonb. A 'format_rules_not_found' (P0002) should never happen post-
  // getFormatRules (EPB seasons always have a row), but we fall back to the
  // upsert path defensively to keep the contract identical.
  const { data, error } = await supabase.rpc('epb_set_redraft_phase_open', {
    p_season_id: seasonId,
    p_open: open,
  });

  if (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    if (code === 'P0002') {
      return upsertFormatRules(seasonId, { redraft_phase_open: open });
    }
    throw error;
  }

  return toFormatRules(data as FormatRulesRow);
}
