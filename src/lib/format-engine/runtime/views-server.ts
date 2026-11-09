/**
 * The loaders behind the live-format surfaces: they read what the pure mappers of `views.ts` need and hand it over. The
 * player's view (`GET .../format/me`, the play page) reloads the context fresh; the admin panel loads the `KitContext`
 * once per request (`loadKitContext`) and passes it into every admin loader, so a page costs one context load. Server
 * only.
 *
 * Names: a player view names only the league's CURRENT participants (a former player is `name: null`). The admin pages
 * also name the admins who wrote a row (an admin need not play), through the narrow id-to-name read.
 */
import 'server-only';

import { listFormatChallenges } from '@/lib/supabase/queries/format-challenges';
import { listFiredFormatEvents, listFormatAdjustments, listFormatChecks, type FormatCheckListStatus } from '@/lib/supabase/queries/format-runtime-reads';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import { getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { challengeOf, challengeTargets, type ChallengeRecord } from '../challenge';
import type { PageRequest } from './client-api-admin';
import { loadFreshKitContext, loadMaskContext, phaseById, rosterOf, type KitContext } from './load';
import { loadStageTable } from './stage-table';
import {
  allowedAdjustments,
  buildAdjustmentTargets,
  buildAdminOverview,
  buildPlayerView,
  buildUnmasked,
  giverHiddenActions,
  NOT_RUNNING_OVERVIEW,
  ruleLabelsOf,
  toAdjustmentView,
  adjustmentMaskOf,
  toCheckView,
  type LadderInput,
  type NameMap,
} from './views';
import type { AdjustmentsPage, AdminOverview, AdminUnmasked, ChecksPage, PlayerFormatView } from './view-types';

/**
 * The public names of the league's current participants: the season roster, plus (with `ctx`) the players enrolled in a
 * phase who are not on it. A reserve a phase-scope substitution enrolled, or a player added straight to a phase, plays and is
 * accepted by the action and cron checks (`rosterOf`), so the views must count them as participants too.
 */
export async function loadParticipantNames(seasonId: string, ctx?: Pick<KitContext, 'phases'>): Promise<NameMap> {
  const participants = await getPublicSeasonParticipants(seasonId);
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const missing = ctx === undefined ? [] : rosterOf(ctx).filter((id) => !names.has(id));
  if (missing.length > 0) {
    for (const [id, name] of Object.entries(await resolvePlayerNames(missing))) names.set(id, name);
  }
  return names;
}

/** Participant names plus the names of `extraIds` (admins who wrote a row) that are not participants. */
async function loadNamesWith(seasonId: string, extraIds: readonly (string | null)[]): Promise<NameMap> {
  const names = new Map(await loadParticipantNames(seasonId));
  const missing = [...new Set(extraIds.filter((id): id is string => id !== null && !names.has(id)))];
  if (missing.length > 0) {
    for (const [id, name] of Object.entries(await resolvePlayerNames(missing))) names.set(id, name);
  }
  return names;
}

/** The highest round of a phase that is not completed (the TS twin of `format__open_round`), or null. */
function openRoundNumber(rounds: readonly { round_number: number; status: string }[]): number | null {
  let open: number | null = null;
  for (const round of rounds) if (round.status !== 'completed' && (open === null || round.round_number > open)) open = round.round_number;
  return open;
}

/**
 * The live view of `playerId` in a league: `{ running: false }` when it does not run a kit format. One context load,
 * then per challenge phase the stage table, the viewer's own challenges and the rounds.
 */
export async function loadPlayerView(seasonId: string, playerId: string, now: Date = new Date()): Promise<PlayerFormatView> {
  const ctx = await loadFreshKitContext(seasonId);
  if (ctx === null) return { running: false };
  const ladderPhases = ctx.phases.flatMap((phase) => {
    const config = challengeOf(phase.stage.pairing);
    return config === null ? [] : [{ phase, config }];
  });
  const [names, ladders] = await Promise.all([
    loadParticipantNames(seasonId, ctx),
    Promise.all(
      ladderPhases.map(async ({ phase, config }): Promise<LadderInput> => {
        // The viewer's own challenges are all the history the targets need (cap, open pair and cooldown are theirs).
        const [table, challenges, rounds] = await Promise.all([
          loadStageTable(ctx, phase.id),
          listFormatChallenges(seasonId, { phaseId: phase.id, playerId }),
          getRoundsByTournament(phase.id),
        ]);
        const round = openRoundNumber(rounds);
        const rows = (table ?? []).map((row) => ({ player_id: row.player_id, rank: row.rank }));
        const targets =
          round === null
            ? []
            : challengeTargets(config, rows, playerId, round, challenges as unknown as ChallengeRecord[], now).map((row) => row.player_id);
        return { phaseId: phase.id, table: rows, round, targets, challenges };
      }),
    ),
  ]);
  return buildPlayerView(ctx, playerId, names, ladders, now);
}

/**
 * Open challenges that are still live (not past their accept window and with both players still enrolled in the phase),
 * counted for the overview. A removed or swapped player's challenge stays `open` in the table until the next create or
 * respond cancels it, so it is not counted here.
 */
async function countOpenChallenges(ctx: KitContext, now: Date): Promise<number> {
  const open = await listFormatChallenges(ctx.seasonId, { status: 'open' });
  return open.filter((row) => {
    if (new Date(row.expires_at).getTime() <= now.getTime()) return false;
    const members = phaseById(ctx, row.phase_id)?.members ?? [];
    return members.includes(row.challenger_id) && members.includes(row.defender_id);
  }).length;
}

/**
 * The admin overview (relations masked, late joiners listed from the event log); a league that does not run a kit format
 * is the "not running" overview.
 */
export async function loadAdminOverview(ctx: KitContext | null, adminId: string, now: Date = new Date()): Promise<AdminOverview> {
  if (ctx === null) return NOT_RUNNING_OVERVIEW;
  const [names, openChallenges, events] = await Promise.all([
    loadParticipantNames(ctx.seasonId, ctx),
    countOpenChallenges(ctx, now),
    listFiredFormatEvents(ctx.seasonId),
  ]);
  return buildAdminOverview(ctx, adminId, names, { openChallenges, events });
}

/** The explicit, audited read: relations with their hidden sides and the submission states and targets per action. */
export async function loadUnmasked(ctx: KitContext, adminId: string): Promise<AdminUnmasked> {
  return buildUnmasked(ctx, adminId, await loadParticipantNames(ctx.seasonId, ctx));
}

/**
 * The allowed kinds, the form targets and a page of the adjustment history (without a kit context only the history).
 * `viewerId` is the admin who reads it: one who plays does not get the holdings of other players on a resource that is
 * not visible to all (`adjustmentMaskOf`), because the history would otherwise tell a recipient what an opponent was granted.
 */
export async function loadAdjustmentsPage(seasonId: string, ctx: KitContext | null, page: PageRequest, viewerId: string): Promise<AdjustmentsPage> {
  const { rows, total } = await listFormatAdjustments(seasonId, page);
  const names = await loadNamesWith(seasonId, rows.map((row) => row.admin_id));
  // Without a kit context (another engine) the format's own masks still apply to rows a kit run wrote.
  const mask = adjustmentMaskOf(ctx ?? (await loadMaskContext(seasonId)), viewerId);
  return {
    allowed: ctx === null ? [] : allowedAdjustments(ctx.def),
    targets: ctx === null ? { stages: [], players: [], resources: [], relations: [], actions: [] } : buildAdjustmentTargets(ctx, names),
    history: rows.map((row) => toAdjustmentView(row, names, mask)),
    total,
  };
}

/**
 * A page of the check history; rule labels come from the format when the league runs one. `viewerId` is the admin who
 * reads it: an admin who plays does not get the waiting giver of a hidden relation (see `giverHiddenActions`), and an admin
 * who is not a site admin (`siteAdmin`, false unless said) does not get the planned team behind a `team_audit` check.
 */
export async function loadChecksPage(
  seasonId: string,
  ctx: KitContext | null,
  status: FormatCheckListStatus,
  page: PageRequest,
  viewerId: string,
  siteAdmin = false,
): Promise<ChecksPage> {
  const { rows, total } = await listFormatChecks(seasonId, { status, ...page });
  const names = await loadNamesWith(seasonId, rows.map((row) => row.resolved_by));
  const labels = ctx === null ? new Map() : ruleLabelsOf(ctx.def);
  const maskContext = ctx ?? (await loadMaskContext(seasonId));
  const hidden = maskContext === null ? undefined : giverHiddenActions(maskContext, viewerId);
  return { checks: rows.map((row) => toCheckView(row, labels, names, hidden, { id: viewerId, siteAdmin })), total };
}
