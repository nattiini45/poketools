/**
 * Browser event that tells the rest of a tournament page its roster changed.
 *
 * `ParticipantManager` announces the roster after it loads and after every
 * change (including the league-phase sync on mount), and the round manager
 * listens, so the start-up checklist never works from a stale count. Every
 * function is a no-op without `window`.
 */

export const PARTICIPANTS_CHANGED_EVENT = 'tournament:participants-changed';

export interface ParticipantsSummary {
  count: number;
  seededCount: number;
  playerIds: string[];
}

interface ParticipantsChangedDetail {
  tournamentId: string;
  summary: ParticipantsSummary;
}

/** Reduces a roster to what the checklist needs: how many, how many seeded, and who. */
export function summarizeParticipants(
  rows: readonly { id: string; seed: number | null }[]
): ParticipantsSummary {
  return {
    count: rows.length,
    seededCount: rows.filter((row) => row.seed !== null).length,
    playerIds: rows.map((row) => row.id),
  };
}

export function announceParticipantsChanged(tournamentId: string, summary: ParticipantsSummary): void {
  if (typeof window === 'undefined') return;
  const detail: ParticipantsChangedDetail = { tournamentId, summary };
  window.dispatchEvent(new CustomEvent<ParticipantsChangedDetail>(PARTICIPANTS_CHANGED_EVENT, { detail }));
}

/** Listens for roster changes of one tournament. Returns the function that removes the listener. */
export function subscribeParticipantsChanged(
  tournamentId: string,
  listener: (summary: ParticipantsSummary) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ParticipantsChangedDetail>).detail;
    if (detail?.tournamentId === tournamentId) listener(detail.summary);
  };
  window.addEventListener(PARTICIPANTS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PARTICIPANTS_CHANGED_EVENT, handler);
}
