/**
 * Opening and resolving assisted checks of a kit league. `openChecks` writes the checks a planner returned (one SQL
 * call each; a dedupe key that exists opens nothing), `resolveCheck` confirms or rejects an open one. Server only.
 */
import 'server-only';

import { expireSeasonReads } from '@/lib/revalidation';
import { openFormatCheck, resolveFormatCheck } from '@/lib/supabase/queries/format-runtime';
import type { CheckPlan } from './checks';

export interface OpenedCheck {
  dedupe_key: string;
  id: string;
}

/**
 * Opens `checks`; returns the ones that did not exist before. Failures stop at the first and propagate. `revision` is the
 * `season_formats.revision` of the context the checks were planned from: a format replaced, switched, detached or amended
 * since raises `format_context_stale` (nothing opened, the dedupe key stays free), which the caller treats as retry-later.
 */
export async function openChecks(seasonId: string, checks: readonly CheckPlan[], revision: number): Promise<OpenedCheck[]> {
  const opened: OpenedCheck[] = [];
  for (const check of checks) {
    const id = await openFormatCheck({
      seasonId,
      source: check.source,
      ruleId: check.rule_id,
      dedupeKey: check.dedupe_key,
      subject: check.subject,
      revision,
    });
    if (id !== null) opened.push({ dedupe_key: check.dedupe_key, id });
  }
  return opened;
}

export interface ResolveCheckRequest {
  seasonId: string;
  checkId: string;
  status: 'confirmed' | 'rejected';
  adminId: string | null;
  note: string | null;
}

/** False when the check was not open (already resolved, not a check, or a check of another league). */
export async function resolveCheck(request: ResolveCheckRequest): Promise<boolean> {
  const resolved = await resolveFormatCheck({
    seasonId: request.seasonId,
    checkId: request.checkId,
    status: request.status,
    adminId: request.adminId,
    note: request.note,
  });
  if (resolved) expireSeasonReads(request.seasonId);
  return resolved;
}
