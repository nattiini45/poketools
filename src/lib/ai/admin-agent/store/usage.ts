/**
 * The usage ledger and its caps (plan 6.4, "Cost accounting").
 *
 * Every model call (a turn step, a title, a judge) reserves its estimated cost BEFORE the call and settles with the
 * API's real meters after it. `admin_agent_reserve_usage` does the check and the insert under one global advisory lock:
 * it sums what each window has spent (a settled row counts its cost, an unsettled one its reservation, so a crashed call
 * can only make the cap stricter) and refuses when the new estimate would pass a cap. All four caps are required (a
 * missing one would silently disable it, so the function raises): fail closed.
 *
 * Windows are UTC calendar days and months (`usageWindows`). The window policy lives here, the function only compares.
 * Every call proves the conversation (reserve) or the usage row (settle) is this admin's, because the SQL functions
 * take bare ids.
 *
 * The sums in `getSpend` / `getGlobalDaySpend` are for display and the warn threshold; the cap itself is enforced
 * only inside `admin_agent_reserve_usage`. They page the rows (a row per model call) up to a bound and say when they hit it.
 */
import { readBoundedPages } from '@/lib/supabase/read-bounded-pages';
import { isValidUuid } from '@/lib/utils/uuid';
import { parseAdminAgentEnv } from '../env';
import { ownedConversation, type StoreContext } from './context';
import { AdminAgentStoreDbError, AdminAgentStoreError, mapStoreDbError, unwrap } from './errors';
import { assertAdminId, type AdminId } from './ids';
import type { ReserveUsageResult, SpendSummary, UsageCapName, UsageCaps, UsageReservation, UsageSettlement } from './types';

const USAGE_PAGES = 20;

/** The start of the current UTC day and UTC month: the windows the day and month caps sum over. */
export function usageWindows(now: Date): { daySince: string; monthSince: string } {
  return {
    daySince: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    monthSince: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
  };
}

/** The configured caps (`ADMIN_AGENT_BUDGET_*`, micro-dollars), read at call time. */
export function defaultUsageCaps(): UsageCaps {
  const { budgets } = parseAdminAgentEnv();
  return {
    conversationMicro: budgets.conversationMicro,
    adminDayMicro: budgets.adminDayMicro,
    adminMonthMicro: budgets.adminMonthMicro,
    globalDayMicro: budgets.globalDayMicro,
  };
}

const BUDGET_CODE = {
  conversation: 'agent_budget_conversation',
  admin_day: 'agent_budget_admin_day',
  admin_month: 'agent_budget_admin_month',
  global_day: 'agent_budget_global_day',
} as const;

/** The catalogued error of a refused reservation (the cap names the code; the amounts stay in `detail`). */
export function budgetExceededError(result: Extract<ReserveUsageResult, { ok: false }>): AdminAgentStoreError {
  return new AdminAgentStoreError(BUDGET_CODE[result.exceeded], undefined, { detail: { used: result.usedMicro, cap: result.capMicro } });
}

const isCapName = (value: unknown): value is UsageCapName =>
  value === 'conversation' || value === 'admin_day' || value === 'admin_month' || value === 'global_day';

function wholeMicro(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'bad_usage_amount', detail: { field: label } });
  }
  return value;
}

interface SpendRow {
  created_at: string;
  settled_at: string | null;
  reserved_usd_micro: number;
  cost_usd_micro: number;
}

const spendOf = (row: Pick<SpendRow, 'settled_at' | 'reserved_usd_micro' | 'cost_usd_micro'>) =>
  row.settled_at ? row.cost_usd_micro : row.reserved_usd_micro;

export function usageRepository(ctx: StoreContext) {
  const api = {
    /**
     * Reserves `estimateUsdMicro` for one model call. `ok: true` carries the usage id to settle; otherwise `exceeded`
     * names the first cap the estimate would pass, with what was used and the cap (turn this into the catalogued error
     * with `budgetExceededError`). Nothing is inserted when refused.
     */
    async reserveUsage(adminId: AdminId, input: UsageReservation): Promise<ReserveUsageResult> {
      assertAdminId(adminId);
      const estimate = wholeMicro(input.estimateUsdMicro, 'estimateUsdMicro');
      const given = input.caps ?? defaultUsageCaps();
      const caps = {
        conversation: wholeMicro(given.conversationMicro, 'conversationMicro'),
        adminDay: wholeMicro(given.adminDayMicro, 'adminDayMicro'),
        adminMonth: wholeMicro(given.adminMonthMicro, 'adminMonthMicro'),
        globalDay: wholeMicro(given.globalDayMicro, 'globalDayMicro'),
      };
      if (input.conversationId !== null) await ownedConversation(ctx, adminId, input.conversationId);
      const { daySince, monthSince } = usageWindows(ctx.now());
      const { data, error } = await ctx.db.rpc('admin_agent_reserve_usage', {
        p_admin_id: adminId,
        p_admin_name: input.adminName,
        p_conversation_id: input.conversationId as string,
        p_purpose: input.purpose,
        p_model: input.model,
        p_estimate_usd_micro: estimate,
        p_cap_conversation: caps.conversation,
        p_cap_admin_day: caps.adminDay,
        p_cap_admin_month: caps.adminMonth,
        p_cap_global_day: caps.globalDay,
        p_day_since: daySince,
        p_month_since: monthSince,
      });
      if (error) throw mapStoreDbError('usage.reserve', error);
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.out_usage_id) return { ok: true, usageId: row.out_usage_id };
      if (row && isCapName(row.out_exceeded)) return { ok: false, exceeded: row.out_exceeded, usedMicro: row.out_used, capMicro: row.out_cap };
      throw new AdminAgentStoreDbError('usage.reserve', new Error('reserve function answered neither a reservation nor a cap'));
    },

    /**
     * Settles a reservation once with the real meters and cost. Returns `false` when it was already settled (a repeat
     * is harmless); a usage row that is not this admin's throws.
     */
    async settleUsage(adminId: AdminId, usageId: string, settlement: UsageSettlement): Promise<boolean> {
      assertAdminId(adminId);
      if (!isValidUuid(usageId)) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'usage_not_found' });
      const row = unwrap(
        'usage.settleOwned',
        await ctx.db.from('admin_agent_usage').select('id, settled_at').eq('id', usageId).eq('admin_id', adminId).maybeSingle(),
      );
      if (!row) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'usage_not_found' });
      if (row.settled_at) return false;
      const { error } = await ctx.db.rpc('admin_agent_settle_usage', {
        p_usage_id: usageId,
        p_input_tokens: wholeMicro(settlement.inputTokens, 'inputTokens'),
        p_cache_write_5m_tokens: wholeMicro(settlement.cacheWrite5mTokens, 'cacheWrite5mTokens'),
        p_cache_write_1h_tokens: wholeMicro(settlement.cacheWrite1hTokens, 'cacheWrite1hTokens'),
        p_cache_read_tokens: wholeMicro(settlement.cacheReadTokens, 'cacheReadTokens'),
        p_output_tokens: wholeMicro(settlement.outputTokens, 'outputTokens'),
        p_cost_usd_micro: wholeMicro(settlement.costUsdMicro, 'costUsdMicro'),
        p_stop_reason: settlement.stopReason as string,
      });
      if (!error) return true;
      if ((error as { message?: string }).message === 'ADMIN_AGENT_USAGE_NOT_FOUND') return false;
      throw mapStoreDbError('usage.settle', error);
    },

    /** Releases a reservation for a call that was never made (settles it at cost 0). */
    async releaseUsage(adminId: AdminId, usageId: string, reason = 'not_called'): Promise<boolean> {
      return api.settleUsage(adminId, usageId, {
        inputTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costUsdMicro: 0,
        stopReason: reason,
      });
    },

    /**
     * What this admin (and, with `conversationId`, this conversation) has spent: settled cost plus unsettled
     * reservations. The admin day and month sums come from one read of the month's rows.
     */
    async getSpend(adminId: AdminId, conversationId?: string): Promise<SpendSummary> {
      assertAdminId(adminId);
      if (conversationId !== undefined) await ownedConversation(ctx, adminId, conversationId);
      const { daySince, monthSince } = usageWindows(ctx.now());
      const month = await readBoundedPages<SpendRow>(
        (from, to) =>
          ctx.db
            .from('admin_agent_usage')
            .select('created_at, settled_at, reserved_usd_micro, cost_usd_micro')
            .eq('admin_id', adminId)
            .gte('created_at', monthSince)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'admin-agent usage (admin month)', maxPages: USAGE_PAGES },
      ).catch((error: unknown) => {
        throw mapStoreDbError('usage.spendMonth', error);
      });
      let adminDayMicro = 0;
      let adminMonthMicro = 0;
      for (const row of month.rows) {
        const spent = spendOf(row);
        adminMonthMicro += spent;
        if (row.created_at >= daySince) adminDayMicro += spent;
      }
      let conversationMicro: number | null = null;
      let truncated = month.truncated;
      if (conversationId !== undefined) {
        const conversation = await readBoundedPages<SpendRow>(
          (from, to) =>
            ctx.db
              .from('admin_agent_usage')
              .select('created_at, settled_at, reserved_usd_micro, cost_usd_micro')
              .eq('conversation_id', conversationId)
              .order('created_at', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to),
          { label: 'admin-agent usage (conversation)', maxPages: USAGE_PAGES },
        ).catch((error: unknown) => {
          throw mapStoreDbError('usage.spendConversation', error);
        });
        conversationMicro = conversation.rows.reduce((sum, row) => sum + spendOf(row), 0);
        truncated = truncated || conversation.truncated;
      }
      return { conversationMicro, adminDayMicro, adminMonthMicro, truncated };
    },

    /** The spend of all admins today (UTC), as one number: what the global daily cap compares against. */
    async getGlobalDaySpend(adminId: AdminId): Promise<{ micro: number; truncated: boolean }> {
      assertAdminId(adminId);
      const { daySince } = usageWindows(ctx.now());
      const day = await readBoundedPages<SpendRow>(
        (from, to) =>
          ctx.db
            .from('admin_agent_usage')
            .select('created_at, settled_at, reserved_usd_micro, cost_usd_micro')
            .gte('created_at', daySince)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'admin-agent usage (global day)', maxPages: USAGE_PAGES },
      ).catch((error: unknown) => {
        throw mapStoreDbError('usage.spendGlobalDay', error);
      });
      return { micro: day.rows.reduce((sum, row) => sum + spendOf(row), 0), truncated: day.truncated };
    },
  };
  return api;
}

export type UsageRepository = ReturnType<typeof usageRepository>;
