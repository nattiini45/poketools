/**
 * The DRAFT button's state for the pinned line (draft-frontend §5.2, §5.5,
 * §5.10). Pure. The client never decides draftability (FR-3): it only reads
 * the server's verdicts (`viewer.pick_block`, `viewer.line_status`, for an
 * admin override `active_player_line_status`) and the taken map. The only
 * synthesized reasons mirror state the snapshot already shows (a taken line,
 * a paused draft, not the viewer's turn), so the button never offers a pick
 * the server is certain to refuse.
 */
import { cardStateOf, remainingAfterPick, LINE_LEVEL_REASONS, type CardState, type DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId, ReasonDTO } from '@/lib/draft-ui/snapshot-types';

export type CtaBlock =
  /** No line pinned. */
  | { kind: 'select' }
  /** Admin override without an active slot. */
  | { kind: 'noActive' }
  | { kind: 'reason'; reason: ReasonDTO };

export interface CtaState {
  variant: 'player' | 'admin';
  enabled: boolean;
  /** Why the button is disabled (null when enabled). */
  block: CtaBlock | null;
  /** The line-level verdict to show beside the cost when the button reason is a different, viewer-level one. */
  lineReason: ReasonDTO | null;
  /** Budget after the pick for the picking player (viewer, or the active player for an admin); null for spectators. */
  remainingAfter: number | null;
  cardState: CardState | null;
  /** The player the admin picks for. */
  target: { playerId: string; name: string } | null;
}

function lineReasonOf(vm: DraftViewModel, lineId: LineId, status: Record<LineId, ReasonDTO>): ReasonDTO | null {
  const owner = vm.takenBy[lineId];
  const stated = status[lineId];
  if (owner) return stated?.code === 'LINE_TAKEN' ? stated : { code: 'LINE_TAKEN', params: { player_id: owner.playerId } };
  return stated && LINE_LEVEL_REASONS.has(stated.code) ? stated : null;
}

function viewerBlock(vm: DraftViewModel): ReasonDTO | null {
  if (vm.viewer.pickBlock) return vm.viewer.pickBlock;
  if (vm.status === 'pending') return { code: 'DRAFT_NOT_STARTED' };
  if (vm.status === 'complete') return { code: 'DRAFT_COMPLETE' };
  if (vm.paused) return { code: 'DRAFT_PAUSED' };
  if (!vm.viewerOnClock) return { code: 'NOT_YOUR_TURN' };
  return null;
}

export function ctaStateOf(vm: DraftViewModel, pinned: { lineId: LineId; price: number } | null, adminOverride: boolean): CtaState {
  const slot = vm.activeSlot;
  const admin = adminOverride && vm.viewer.isPoolAdmin && slot !== null && !slot.isViewer;
  const variant: CtaState['variant'] = admin ? 'admin' : 'player';
  const target = admin && slot ? { playerId: slot.player_id, name: slot.playerName } : null;

  if (!pinned) {
    return { variant, enabled: false, block: { kind: 'select' }, lineReason: null, remainingAfter: null, cardState: null, target };
  }

  if (admin && slot) {
    const status = vm.viewer.activePlayerLineStatus ?? {};
    const active = vm.participants.find((p) => p.player_id === slot.player_id);
    const remainingAfter = active ? active.budget_remaining - pinned.price : null;
    const cardState = cardStateOf(vm, pinned.lineId, status);
    const lineReason = lineReasonOf(vm, pinned.lineId, status);
    let block: ReasonDTO | null = null;
    if (vm.status !== 'in_progress') block = { code: vm.status === 'complete' ? 'DRAFT_COMPLETE' : 'DRAFT_NOT_STARTED' };
    else if (vm.paused) block = { code: 'DRAFT_PAUSED' };
    if (block) return { variant, enabled: false, block: { kind: 'reason', reason: block }, lineReason, remainingAfter, cardState, target };
    if (lineReason) {
      return { variant, enabled: false, block: { kind: 'reason', reason: lineReason }, lineReason: null, remainingAfter, cardState, target };
    }
    return { variant, enabled: true, block: null, lineReason: null, remainingAfter, cardState, target };
  }

  if (adminOverride && vm.viewer.isPoolAdmin && slot === null) {
    return { variant: 'admin', enabled: false, block: { kind: 'noActive' }, lineReason: null, remainingAfter: null, cardState: null, target: null };
  }

  const cardState = cardStateOf(vm, pinned.lineId);
  const remainingAfter = remainingAfterPick(vm, pinned.price);
  const lineReason = lineReasonOf(vm, pinned.lineId, vm.viewer.lineStatus);
  const viewer = viewerBlock(vm);
  if (viewer) return { variant, enabled: false, block: { kind: 'reason', reason: viewer }, lineReason, remainingAfter, cardState, target };
  if (lineReason) {
    return { variant, enabled: false, block: { kind: 'reason', reason: lineReason }, lineReason: null, remainingAfter, cardState, target };
  }
  return { variant, enabled: true, block: null, lineReason: null, remainingAfter, cardState, target };
}
