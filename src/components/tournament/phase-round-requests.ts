import type { PublicPhaseMatch } from '@/lib/cache/phase-public-reads';
import type { LeaguePhaseAddress } from '@/lib/league-phase/paths';
import type { ManualRoundInput } from '@/lib/validation/schemas';
import type { ApiResult } from '@/types/api';
import type { ResetRoundResult } from '@/types/game';
import type { PhaseRound } from '@/types/league-phase';

export type PhaseRoundDetail = PhaseRound & { matches: PublicPhaseMatch[] };
export type PhaseRoundEdit = { best_of: number } | { deadline: string | null } | { status: 'active' | 'completed' };

export function phaseRoundRequests({ season_id, phase_id }: LeaguePhaseAddress) {
  const phase = `/api/seasons/${encodeURIComponent(season_id)}/phases/${encodeURIComponent(phase_id)}`;
  const rounds = `${phase}/rounds`;
  const detail = (id: string) => `${rounds}/${encodeURIComponent(id)}`;
  const json = async <T>(path: string, init: RequestInit): Promise<ApiResult<T>> => {
    const response = await fetch(path, init);
    const result: ApiResult<T> = await response.json();
    if (!response.ok && result.success) throw new Error('Unexpected HTTP response');
    return result;
  };
  const write = (method: 'POST' | 'PATCH' | 'DELETE', body: object): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    read: (id: string, signal: AbortSignal) => json<PhaseRoundDetail>(detail(id), { cache: 'no-store', signal }),
    generate: () => json<PhaseRound>(`${rounds}/generate`, { method: 'POST' }),
    generateAll: () => json<PhaseRound[]>(`${rounds}/generate-all`, { method: 'POST' }),
    generateBracket: () => json<{ rounds_created: number; matches_materialized: number }>(`${phase}/generate-bracket`, { method: 'POST' }),
    repairBracket: () => json<{ slots_materialized: number; slots_updated: number }>(`${phase}/repair-bracket`, { method: 'POST' }),
    regenerateBracket: (cascade: boolean) => json<{ format_revert_failed?: boolean }>(`${phase}/regenerate-bracket`, write('POST', { cascade })),
    createManual: (input: ManualRoundInput, force: boolean) => json<PhaseRound>(
      `${rounds}/manual${force ? '?force=true' : ''}`, write('POST', input),
    ),
    update: (id: string, edit: PhaseRoundEdit) => json<PhaseRound>(detail(id), write('PATCH', edit)),
    remove: (id: string) => json<{ deleted: true }>(detail(id), write('DELETE', { confirm: true })),
    reset: (id: string, cascade: boolean) => json<ResetRoundResult>(`${detail(id)}/reset`, write('POST', { cascade })),
  };
}
