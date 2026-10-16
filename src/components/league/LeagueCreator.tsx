'use client';

import { useRouter } from 'next/navigation';
import LeagueForm from './LeagueForm';
import type { SeasonFormData } from '@/types/season';
import type { Season } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';
import type { ApiErrorLike } from '@/i18n/api-errors';

interface LeagueCreatorProps {
  rulesets: Ruleset[];
}

export default function LeagueCreator({ rulesets }: LeagueCreatorProps) {
  const router = useRouter();

  /** Returns the failed body so LeagueForm can show it by `code` in the viewer's language. */
  async function handleSubmit(data: SeasonFormData): Promise<ApiErrorLike | null> {
    const res = await fetch('/api/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result: ApiResult<Season> = await res.json();

    if (!result.success) {
      return result;
    }

    router.push(`/admin/leagues/${result.data.id}`);
    return null;
  }

  return <LeagueForm rulesets={rulesets} onSubmit={handleSubmit} />;
}
