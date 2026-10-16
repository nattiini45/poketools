/**
 * The public shape of a draft pick, shared by every route that shows picks to
 * all viewers. Admin correction data (override/void reasons, voider, actor,
 * made_by, client_request_id) and queue bookkeeping (slot ids) stay
 * server-side; the DA-guarded audit route keeps the full `DraftPick`.
 *
 * Used by GET /api/drafts/[id]/picks and the legacy branch of GET /api/drafts/[id]/state.
 */
import type { DraftPickWithPlayer } from '@/types/draft';

export interface PublicDraftPick {
  id: string;
  player_id: string;
  player_name: string;
  pokemon_name: string;
  line_id: string | null;
  pick_number: number;
  round: number;
  points_spent: number | null;
  timestamp: string;
}

/** Allowlist mapping: only the public fields leave the server. */
export function toPublicPick(pick: DraftPickWithPlayer): PublicDraftPick {
  return {
    id: pick.id,
    player_id: pick.player_id,
    player_name: pick.player_name,
    pokemon_name: pick.pokemon_name,
    line_id: pick.line_id,
    pick_number: pick.pick_number,
    round: pick.round,
    points_spent: pick.points_spent,
    timestamp: pick.timestamp,
  };
}

/** The standing picks (voided ones dropped) in their public shape. */
export function toPublicPicks(picks: readonly DraftPickWithPlayer[]): PublicDraftPick[] {
  return picks.filter((p) => !p.voided_at).map(toPublicPick);
}
