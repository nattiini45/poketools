import 'server-only';
/**
 * Draft setup readers (plan 3.6.2, phase 4): `draft_setup_get`, `draft_pool_state_get`, `pointbuy_list_get`,
 * `pool_template_list`.
 *
 * Narrow on purpose. The draft room snapshot (`getDraftSnapshot`) carries picks, queues and redraft submissions and
 * ticks the clock, so it is never used: pool state comes from the pool row, and a redraft submission list is never read
 * (plan 6.6). Webhooks are not read at all.
 */
import { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getTemplate, listTemplates } from '@/lib/supabase/queries/draft-pool-templates';
import { getTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getDraftPoolById, getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getActiveListVersion, getPointBuyListById, getPointBuyListVersions } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { defineRunnable } from '../registry/define';
import { capped, code, id, isoDateTime, label, uuidArg } from '../registry/atoms';
import { fenceLabel } from '../registry/fence';

const POOL_CAP = 30;
const TIER_CAP = 30;
const TEMPLATE_CAP = 50;
const LIST_VERSION_CAP = 30;

const poolNotFound = () => new UserFacingError('Draft pool not found', { code: 'POOL_NOT_FOUND', status: 404 });
const seasonNotFound = () => new UserFacingError('League not found', { code: 'SEASON_NOT_FOUND', status: 404 });

// ─── draft_setup_get ─────────────────────────────────────────────────────────

export const draftSetupGet = defineRunnable('season', {
  name: 'draft_setup_get',
  class: 'R',
  description:
    'Get the draft setup of a league: which pools exist (engine, kind, phase, mode, group), the number of pool entries and how they spread over tier labels, the tier limits, the bound point-buy list, and for queue-engine leagues the format rules (budget, picks, token ratios, redraft switch). It never invents tier tables or point values: when they are missing, say so and ask the admin how to build them.',
  args: z.strictObject({ league_id: uuidArg('League id') }),
  phase: 4,
  guard: (args) => ({ kind: 'season', id: args.league_id }),
  output: z.strictObject({
    format_type: code(),
    point_buy_list_id: id().nullable(),
    pools: capped(
      z.strictObject({
        id: id(),
        engine: code(),
        kind: code(),
        phase: code(),
        mode: code(),
        status: code(),
        group_id: id().nullable(),
        group_label: label().nullable(),
        point_budget: z.number().int().nullable(),
      }),
    ),
    entry_count: z.number().int(),
    entries_by_tier: capped(z.strictObject({ tier_label: label(), count: z.number().int() })),
    tier_limits: capped(z.strictObject({ tier: code(), max_picks: z.number().int() })),
    format_rules: z
      .strictObject({
        draft_budget: z.number(),
        draft_picks: z.number().int(),
        draft_token_ratio: z.number(),
        draft_token_max: z.number(),
        draft_token_max_per_line: z.number(),
        redraft_phase_open: z.boolean(),
      })
      .nullable(),
  }),
  async execute(args) {
    const season = await getSeasonById(args.league_id);
    if (season === null) throw seasonNotFound();
    const [pools, entries, limits, rules] = await Promise.all([
      getDraftPoolsBySeasonWithGroups(season.id),
      getPoolEntries(season.id),
      getTierLimits(season.id),
      getFormatRules(season.id),
    ]);
    const byTier = new Map<string, number>();
    for (const entry of entries) byTier.set(entry.power_tier ?? '', (byTier.get(entry.power_tier ?? '') ?? 0) + 1);
    const tiers = [...byTier.entries()].sort((a, b) => b[1] - a[1]);
    return {
      format_type: season.format_type,
      point_buy_list_id: season.point_buy_list_id,
      pools: {
        items: pools.slice(0, POOL_CAP).map((pool) => ({
          id: pool.id,
          engine: pool.engine,
          kind: pool.kind,
          phase: pool.phase,
          mode: pool.mode,
          status: pool.status,
          group_id: pool.season_group_id,
          group_label: pool.season_group_name === null ? null : fenceLabel(pool.season_group_name),
          point_budget: pool.point_budget,
        })),
        total: pools.length,
        truncated: pools.length > POOL_CAP,
        cap: POOL_CAP,
      },
      entry_count: entries.length,
      entries_by_tier: {
        items: tiers.slice(0, TIER_CAP).map(([tier, count]) => ({ tier_label: fenceLabel(tier), count })),
        total: tiers.length,
        truncated: tiers.length > TIER_CAP,
        cap: TIER_CAP,
      },
      tier_limits: {
        items: limits.slice(0, TIER_CAP).map((limit) => ({ tier: limit.power_tier, max_picks: limit.max_picks })),
        total: limits.length,
        truncated: limits.length > TIER_CAP,
        cap: TIER_CAP,
      },
      format_rules:
        rules === null
          ? null
          : {
              draft_budget: rules.draft_budget,
              draft_picks: rules.draft_picks,
              draft_token_ratio: rules.draft_token_ratio,
              draft_token_max: rules.draft_token_max,
              draft_token_max_per_line: rules.draft_token_max_per_line,
              redraft_phase_open: rules.redraft_phase_open,
            },
    };
  },
});

// ─── draft_pool_state_get ────────────────────────────────────────────────────

export const draftPoolStateGet = defineRunnable('draft', {
  name: 'draft_pool_state_get',
  class: 'R',
  description:
    'Get the state of one draft pool: engine, kind, phase, mode, status, roster size, point budget and when it was created. It does not read picks, queues or redraft submissions, and it never advances the draft clock.',
  args: z.strictObject({ pool_id: uuidArg('Draft pool id') }),
  phase: 4,
  guard: (args) => ({ kind: 'draft', id: args.pool_id }),
  output: z.strictObject({
    pool: z.strictObject({
      id: id(),
      league_id: id(),
      engine: code(),
      kind: code(),
      phase: code(),
      mode: code(),
      status: code(),
      draft_type: code(),
      point_budget: z.number().int().nullable(),
      roster_size: z.number().int().nullable(),
      list_version_id: id().nullable(),
      parent_pool_id: id().nullable(),
      created_at: isoDateTime(),
    }),
  }),
  async execute(args) {
    const pool = await getDraftPoolById(args.pool_id);
    if (pool === null) throw poolNotFound();
    return {
      pool: {
        id: pool.id,
        league_id: pool.season_id,
        engine: pool.engine,
        kind: pool.kind,
        phase: pool.phase,
        mode: pool.mode,
        status: pool.status,
        draft_type: pool.draft_type,
        point_budget: pool.point_budget,
        roster_size: pool.roster_size,
        list_version_id: pool.list_version_id,
        parent_pool_id: pool.parent_pool_id,
        created_at: pool.created_at,
      },
    };
  },
});

// ─── pointbuy_list_get ───────────────────────────────────────────────────────

export const pointbuyListGet = defineRunnable('any', {
  name: 'pointbuy_list_get',
  class: 'R',
  description:
    'List the point-buy list versions (name, version, source, whether active) or, with list_id, one version. Creating or importing a list is a human action in the admin pages; the assistant can bind an existing version to a league and read these.',
  args: z.strictObject({ list_id: uuidArg('Point-buy list version id').optional() }),
  phase: 4,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    active_list_id: id().nullable(),
    lists: capped(z.strictObject({ id: id(), label: label(), version: z.number().int(), source_label: label().nullable(), is_active: z.boolean(), created_at: isoDateTime() })),
  }),
  async execute(args) {
    const [active, versions] = await Promise.all([
      getActiveListVersion(),
      args.list_id === undefined ? getPointBuyListVersions() : getPointBuyListById(args.list_id).then((v) => (v === null ? [] : [v])),
    ]);
    return {
      active_list_id: active?.id ?? null,
      lists: {
        items: versions.slice(0, LIST_VERSION_CAP).map((v) => ({
          id: v.id,
          label: fenceLabel(v.name),
          version: v.version,
          source_label: v.source === null ? null : fenceLabel(v.source),
          is_active: v.is_active,
          created_at: v.created_at,
        })),
        total: versions.length,
        truncated: versions.length > LIST_VERSION_CAP,
        cap: LIST_VERSION_CAP,
      },
    };
  },
});

// ─── pool_template_list ──────────────────────────────────────────────────────

export const poolTemplateList = defineRunnable('any', {
  name: 'pool_template_list',
  class: 'R',
  description:
    'List the saved draft pool templates (name, mode and entry count), newest first, or one template by id. Applying a template means appending its entries to a league pool, which the assistant stages as a change; it never replaces or clears a pool.',
  args: z.strictObject({ template_id: uuidArg('Template id').optional() }),
  phase: 4,
  guard: () => ({ kind: 'any' }),
  output: z.strictObject({
    templates: capped(z.strictObject({ id: id(), label: label(), pool_mode: code(), entry_count: z.number().int(), created_at: isoDateTime() })),
  }),
  async execute(args) {
    const templates = args.template_id === undefined ? await listTemplates() : await getTemplate(args.template_id).then((t) => (t === null ? [] : [t]));
    return {
      templates: {
        items: templates.slice(0, TEMPLATE_CAP).map((t) => ({
          id: t.id,
          label: fenceLabel(t.name),
          pool_mode: t.pool_mode,
          entry_count: t.entries.length,
          created_at: t.created_at,
        })),
        total: templates.length,
        truncated: templates.length > TEMPLATE_CAP,
        cap: TEMPLATE_CAP,
      },
    };
  },
});

export const DRAFT_READERS = [draftSetupGet, draftPoolStateGet, pointbuyListGet, poolTemplateList] as const;
