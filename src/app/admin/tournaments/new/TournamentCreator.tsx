'use client';

import { useRouter } from 'next/navigation';
import TournamentForm from '@/components/tournament/TournamentForm';
import type { TournamentFormData } from '@/types/tournament';
import type { Ruleset } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';
import type { Tournament } from '@/types/tournament';

interface TournamentCreatorProps {
  rulesets: Ruleset[];
}

export default function TournamentCreator({ rulesets }: TournamentCreatorProps) {
  const router = useRouter();

  async function handleSubmit(data: TournamentFormData) {
    const res = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result: ApiResult<Tournament> = await res.json();

    if (!result.success) {
      // The form renders it through useApiErrorText: keep the code and params
      // next to the English message (toApiErrorLike reads `error`/`code`/`params`).
      throw Object.assign(new Error(result.error), {
        error: result.error,
        code: result.code,
        params: result.params,
      });
    }

    // Navigate to round management page for the new tournament
    router.push(`/admin/tournaments/${result.data.id}/rounds`);
  }

  return <TournamentForm rulesets={rulesets} onSubmit={handleSubmit} />;
}
