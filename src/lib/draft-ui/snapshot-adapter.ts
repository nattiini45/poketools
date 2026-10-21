/**
 * Snapshot → view model (draft-frontend §5.2). The only module that reads
 * `DraftSnapshotDTO` field names; components read `DraftViewModel`.
 *
 * Pure and client-safe. The client never decides draftability (FR-3): line
 * and viewer verdicts come from the server (`viewer.line_status`,
 * `viewer.pick_block`) and are only mapped here. Unknown additive DTO fields
 * (`recent_events`, `published_now`, `pool.league_time_zone`) are ignored.
 */
import { RECENT_PICKS_COUNT } from './constants';
import type {
  DraftActiveSlot,
  DraftKind,
  DraftMode,
  DraftPhase,
  DraftSnapshotDTO,
  DraftSnapshotParticipant,
  DraftSnapshotPick,
  LineId,
  PauseReason,
  PoolStatus,
  QuietHours,
  ReasonCode,
  ReasonDTO,
  SlotKind,
} from './snapshot-types';

/** The catalog fields the adapter reads (DF1's `DraftLineCatalog` satisfies it). */
export interface CatalogOrderLike {
  readonly lines: readonly { readonly lineId: LineId }[];
}

export type ExtensionState = 'available' | 'used' | 'na';

/** One of the viewer's redraft slots (A/B/C), from `redraft.viewer_slots`. */
export interface RedraftSlotVM {
  redraftSlotId: string;
  label: string;
  droppedLineId: LineId;
  transferredRealKills: number;
  filledByPickId: string | null;
  /** Not yet filled by a pick. */
  open: boolean;
}

export type ParticipantVM = DraftSnapshotParticipant & { isViewer: boolean; rosterLineIds: LineId[] };
export type PickVM = DraftSnapshotPick & { playerName: string };
/** `quiet_hours` = the pool's window (`config.quiet_hours`), carried on the slot so every clock (`useClock`) sees it. */
export type ActiveSlotVM = DraftActiveSlot & { playerName: string; isViewer: boolean; quiet_hours: QuietHours | null };

export interface UpcomingVM {
  slotId: string;
  playerId: string;
  name: string;
  pickNumber: number;
  round: number;
  kind: SlotKind;
  isViewer: boolean;
  /** The round changes before this item (the strip draws a separator). */
  roundBreakBefore: boolean;
}

export interface DraftViewModel {
  version: number;
  /** `Date.parse(server_now)`. */
  serverNow: number;
  mode: DraftMode;
  kind: DraftKind;
  status: PoolStatus;
  phase: DraftPhase;
  paused: boolean;
  pauseReason: PauseReason | null;
  rosterSize: number;
  budget: number;
  activeSlot: ActiveSlotVM | null;
  /** = `upcoming[0]`. */
  nextPlayer: { playerId: string; name: string; isViewer: boolean } | null;
  upcoming: UpcomingVM[];
  viewerOnClock: boolean;
  viewerUpNext: boolean;
  participants: ParticipantVM[];
  /** Ascending by pick number. */
  picks: PickVM[];
  /** The last `RECENT_PICKS_COUNT` picks, newest first. */
  recentPicks: PickVM[];
  /** Season-wide owner of every taken line. `name` is '' when the owner is not a participant of this pool. */
  takenBy: Record<LineId, { playerId: string; name: string }>;
  viewer: {
    playerId: string | null;
    isParticipant: boolean;
    isPoolAdmin: boolean;
    /** null for spectators. */
    budgetRemaining: number | null;
    picksMade: number;
    slotsTotal: number;
    pickBlock: ReasonDTO | null;
    lineStatus: Record<LineId, ReasonDTO>;
    /** Admins only: the active player's verdicts (admin pick-on-behalf, §5.10). */
    activePlayerLineStatus: Record<LineId, ReasonDTO> | null;
    extensions: { plus120: ExtensionState; plus60: ExtensionState };
    redraftSlots: RedraftSlotVM[];
    restrictedLineIds: Set<LineId>;
  };
  redraft: DraftSnapshotDTO['redraft'];
  /** `config.slow_ladder_seconds`. */
  ladderSeconds: number[];
  /** `config.quiet_hours`: the daily window in which pick clocks are held (null = none). */
  quietHours: QuietHours | null;
}

export type CardState = 'available' | 'drafted' | 'blocked' | 'mine';

/**
 * Line-specific reasons: only these grey a roster card (FR-10). Viewer-level
 * reasons (not your turn, paused, roster full …) appear beside the DRAFT
 * button only.
 */
export const LINE_LEVEL_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'LINE_TAKEN',
  'INSUFFICIENT_BUDGET',
  'BUDGET_INFEASIBLE',
  'NOT_ENOUGH_LINES',
  'POOL_NOT_COMPLETABLE',
  'POOL_CHECK_LIMIT',
  'LINE_RESTRICTED',
  'OWN_REDRAFT_DROP',
  'COSMOG_REDRAFT_LOCKED',
  'NOT_IN_LIST',
]);

function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function extensionState(used: boolean, available: boolean): ExtensionState {
  if (!available) return 'na';
  return used ? 'used' : 'available';
}

function rosterOrder(
  lineIds: LineId[],
  pickOrder: ReadonlyMap<LineId, number>,
  catalogOrder: ReadonlyMap<LineId, number>,
): LineId[] {
  const rank = (id: LineId): [number, number] => [
    pickOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
    catalogOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
  ];
  return [...lineIds].sort((a, b) => {
    const [pa, ca] = rank(a);
    const [pb, cb] = rank(b);
    return pa - pb || ca - cb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/**
 * Builds the view model. `catalog` (optional) only orders roster lines that
 * have no pick in this pool (redraft: kept lines) in list order.
 */
export function toDraftViewModel(dto: DraftSnapshotDTO, catalog?: CatalogOrderLike): DraftViewModel {
  const viewerId = dto.viewer.player_id;
  const nameOf = new Map<string, string>(dto.participants.map((p) => [p.player_id, p.name]));
  const name = (playerId: string): string => nameOf.get(playerId) ?? '';
  const isViewer = (playerId: string): boolean => viewerId !== null && playerId === viewerId;

  const picks: PickVM[] = [...dto.picks]
    .sort((a, b) => a.pick_number - b.pick_number || parseInstant(a.made_at) - parseInstant(b.made_at))
    .map((p) => ({ ...p, playerName: name(p.player_id) }));
  const recentPicks = picks.slice(-RECENT_PICKS_COUNT).reverse();

  const takenBy: Record<LineId, { playerId: string; name: string }> = {};
  const ownedBy = new Map<string, LineId[]>();
  for (const [lineId, playerId] of Object.entries(dto.taken)) {
    takenBy[lineId] = { playerId, name: name(playerId) };
    const owned = ownedBy.get(playerId);
    if (owned) owned.push(lineId);
    else ownedBy.set(playerId, [lineId]);
  }

  const pickOrder = new Map<LineId, number>(picks.map((p, i) => [p.line_id, i]));
  const catalogOrder = new Map<LineId, number>((catalog?.lines ?? []).map((l, i) => [l.lineId, i]));
  const participants: ParticipantVM[] = dto.participants.map((p) => ({
    ...p,
    isViewer: isViewer(p.player_id),
    rosterLineIds: rosterOrder(ownedBy.get(p.player_id) ?? [], pickOrder, catalogOrder),
  }));

  const slot = dto.active_slot;
  const activeSlot: ActiveSlotVM | null = slot
    ? {
        ...slot,
        playerName: name(slot.player_id),
        isViewer: isViewer(slot.player_id),
        quiet_hours: dto.config.quiet_hours,
      }
    : null;

  const upcoming: UpcomingVM[] = dto.upcoming.map((u, i) => {
    const previousRound = i === 0 ? (slot?.round ?? null) : dto.upcoming[i - 1].round;
    return {
      slotId: u.slot_id,
      playerId: u.player_id,
      name: name(u.player_id),
      pickNumber: u.pick_number,
      round: u.round,
      kind: u.kind,
      isViewer: isViewer(u.player_id),
      roundBreakBefore: previousRound !== null && previousRound !== u.round,
    };
  });
  const first = upcoming[0];
  const nextPlayer = first ? { playerId: first.playerId, name: first.name, isViewer: first.isViewer } : null;

  const live = dto.pool.status === 'in_progress';
  const viewerOnClock = live && activeSlot !== null && activeSlot.isViewer;
  const viewerUpNext = live && !viewerOnClock && nextPlayer !== null && nextPlayer.isViewer;

  const me = viewerId === null ? undefined : dto.participants.find((p) => p.player_id === viewerId);
  const extensionsOffered = dto.pool.mode === 'live' && dto.config.extension_seconds !== null && me !== undefined;

  const redraftSlots: RedraftSlotVM[] = (dto.redraft?.viewer_slots ?? []).map((s) => ({
    redraftSlotId: s.redraft_slot_id,
    label: s.label,
    droppedLineId: s.dropped_line_id,
    transferredRealKills: s.transferred_real_kills,
    filledByPickId: s.filled_by_pick_id,
    open: s.filled_by_pick_id === null,
  }));

  return {
    version: dto.state_version,
    serverNow: parseInstant(dto.server_now),
    mode: dto.pool.mode,
    kind: dto.pool.kind,
    status: dto.pool.status,
    phase: dto.pool.phase,
    paused: dto.pool.paused,
    pauseReason: dto.pool.pause_reason,
    rosterSize: dto.pool.roster_size,
    budget: dto.pool.budget,
    activeSlot,
    nextPlayer,
    upcoming,
    viewerOnClock,
    viewerUpNext,
    participants,
    picks,
    recentPicks,
    takenBy,
    viewer: {
      playerId: viewerId,
      isParticipant: dto.viewer.is_participant,
      isPoolAdmin: dto.viewer.is_pool_admin,
      budgetRemaining: me ? me.budget_remaining : null,
      picksMade: me ? me.picks_made : 0,
      slotsTotal: me ? me.slots_total : 0,
      pickBlock: dto.viewer.pick_block,
      lineStatus: dto.viewer.line_status,
      activePlayerLineStatus: dto.viewer.active_player_line_status ?? null,
      extensions: {
        plus120: extensionState(me?.extensions.plus120_used ?? false, extensionsOffered),
        plus60: extensionState(me?.extensions.plus60_used ?? false, extensionsOffered),
      },
      redraftSlots,
      restrictedLineIds: new Set(dto.viewer.restricted_line_ids),
    },
    redraft: dto.redraft,
    ladderSeconds: [...dto.config.slow_ladder_seconds],
    quietHours: dto.config.quiet_hours,
  };
}

/**
 * The card state of a line (draft-frontend §5.2). `lineStatus` defaults to
 * the viewer's verdicts; admin pick-on-behalf passes
 * `vm.viewer.activePlayerLineStatus`.
 */
export function cardStateOf(
  vm: DraftViewModel,
  lineId: LineId,
  lineStatus: Record<LineId, ReasonDTO> = vm.viewer.lineStatus,
): CardState {
  const owner = vm.takenBy[lineId];
  if (owner) return vm.viewer.playerId !== null && owner.playerId === vm.viewer.playerId ? 'mine' : 'drafted';
  const reason = lineStatus[lineId];
  if (reason && LINE_LEVEL_REASONS.has(reason.code)) return 'blocked';
  return 'available';
}

/** Budget after picking a line at `price`; null for spectators. May be negative. */
export function remainingAfterPick(vm: DraftViewModel, price: number): number | null {
  return vm.viewer.budgetRemaining === null ? null : vm.viewer.budgetRemaining - price;
}
