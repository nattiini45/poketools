'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import LeagueForm from './LeagueForm';
import CloneSourcePicker from './CloneSourcePicker';
import {
  buildCreateRequest,
  createFormInitialData,
  type CloneSourceOption,
  type LeagueFormIdentity,
} from '@/lib/league-admin/clone-source';
import type { SeasonFormData } from '@/types/season';
import type { Season } from '@/types/season';
import type { Ruleset } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { leagueCreatedHref } from '@/lib/league-admin/tabs';

interface LeagueCreatorProps {
  rulesets: Ruleset[];
  /** Leagues the viewer may start from; empty = the plain create form. */
  sources: CloneSourceOption[];
  /** Only site admins may copy the league admins. */
  isSiteAdmin: boolean;
}

export default function LeagueCreator({ rulesets, sources, isSiteAdmin }: LeagueCreatorProps) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [copyRoster, setCopyRoster] = useState(false);
  const [copyAdmins, setCopyAdmins] = useState(false);
  // Name and dates are the new league's own: they survive the remount a newly picked source causes.
  const [identity, setIdentity] = useState<LeagueFormIdentity>({ name: '', start_date: '', end_date: '' });

  const source = useMemo(() => sources.find((s) => s.id === sourceId) ?? null, [sources, sourceId]);

  /** A new source starts with both options off. */
  function handleSourceChange(next: string | null) {
    setSourceId(next);
    setCopyRoster(false);
    setCopyAdmins(false);
  }

  /** Returns the failed body so LeagueForm can show it by `code` in the viewer's language. */
  async function handleSubmit(data: SeasonFormData): Promise<ApiErrorLike | null> {
    const body = buildCreateRequest(
      data,
      source ? { sourceId: source.id, copyRoster, copyAdmins } : null,
      isSiteAdmin,
    );
    const res = await fetch('/api/seasons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result: ApiResult<Season> = await res.json();

    if (!result.success) {
      return result;
    }

    router.push(leagueCreatedHref(result.data.id, data.format_type));
    return null;
  }

  return (
    <>
      <CloneSourcePicker
        sources={sources}
        isSiteAdmin={isSiteAdmin}
        sourceId={source?.id ?? null}
        copyRoster={copyRoster}
        copyAdmins={copyAdmins}
        onSourceChange={handleSourceChange}
        onCopyRosterChange={setCopyRoster}
        onCopyAdminsChange={setCopyAdmins}
      />
      {/* The key remounts the form, so a newly picked source's values apply; `identity` carries what was typed over. */}
      <LeagueForm
        key={source?.id ?? 'blank'}
        rulesets={rulesets}
        onSubmit={handleSubmit}
        initialData={createFormInitialData(source, identity)}
        onIdentityChange={setIdentity}
      />
    </>
  );
}
