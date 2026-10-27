'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { defaultPickSeconds } from '@/components/draft-admin/admin-view';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { toApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import { postDraftCreate, type DraftCreateError, type DraftCreateOutcome } from '@/lib/draft-ui/create-pool';
import type { DraftMode } from '@/types/draft-queue';

interface EpbDraftRoomCreateProps {
  seasonId: string;
  /** Format rules `draft_budget`, else the format pack default (`epb.defaults.draftBudget`). */
  budget: number;
  /** Format rules `draft_picks`, else the format pack default (`epb.defaults.draftPicks`). */
  rosterSize: number;
  /** The season has a format rules row: the budget and roster size come from it, not from the fallbacks. */
  fromFormatRules: boolean;
  /**
   * League groups: the group this draft is for (its members are the seats). Omitted in a league without groups,
   * whose request body stays `{ season_id, kind }`.
   */
  seasonGroupId?: string;
  /** League groups: the seats line names the group's members instead of every participant. */
  seatsLabel?: string;
}

const SUMMARY_ROWS = ['order', 'seats', 'prices', 'budget', 'roster', 'mode'] as const;

/**
 * Creates the Initial draft of an EPB season. The admin chooses live or slow here (live by default), and the
 * body carries `config: { mode, pick_seconds }` with that mode's default pick time. Everything else
 * `draft_create_pool` fills in, as the summary shows: one seat per participant, the opening order drawn at
 * random and then snaked, prices from the bound point-buy list, budget and roster size from the format rules
 * (or its fallbacks). The draft control panel (`InstanceConfigForm`) edits all of it until the draft starts.
 */
export default function EpbDraftRoomCreate({
  seasonId,
  budget,
  rosterSize,
  fromFormatRules,
  seasonGroupId,
  seatsLabel,
}: EpbDraftRoomCreateProps) {
  const t = useT(leagueAdminSeasonPageMessages);
  const tGlossary = useT(glossaryMessages);
  const modeId = useId();
  const apiErrorText = useApiErrorText(errorsDraft);
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DraftCreateError | null>(null);
  const [mode, setMode] = useState<DraftMode>('live');
  const pickSeconds = defaultPickSeconds(mode);

  const values: Record<(typeof SUMMARY_ROWS)[number], string> = {
    order: t('draftRoom.epbCreate.order'),
    seats: seatsLabel ?? t('draftRoom.epbCreate.seats'),
    prices: t('draftRoom.epbCreate.prices'),
    budget: fromFormatRules
      ? t('draftRoom.epbCreate.budget', { budget })
      : t('draftRoom.epbCreate.budgetDefault', { budget }),
    roster: fromFormatRules
      ? t('draftRoom.epbCreate.roster', { count: rosterSize })
      : t('draftRoom.epbCreate.rosterDefault', { count: rosterSize }),
    mode:
      mode === 'slow'
        ? t('draftRoom.epbCreate.modeSlow', { count: Math.round(pickSeconds / 3600) })
        : t('draftRoom.epbCreate.mode', { count: Math.round(pickSeconds / 60) }),
  };

  async function handleCreate() {
    setLoading(true);
    setError(null);
    let outcome: DraftCreateOutcome;
    try {
      const config = { mode, pick_seconds: pickSeconds };
      outcome = await postDraftCreate(
        seasonGroupId
          ? { season_id: seasonId, kind: 'initial', season_group_id: seasonGroupId, config }
          : { season_id: seasonId, kind: 'initial', config },
      );
    } catch (err) {
      setError({ kind: 'api', error: toApiErrorLike(err) });
      return;
    } finally {
      // Re-enable the button whatever happens, without leaning on the helper's never-throws contract.
      setLoading(false);
    }
    if (!outcome.created) {
      setError(outcome.error);
      return;
    }
    // The draft exists from here on; the server re-render replaces this summary with it.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-poke-text-muted">{t('draftRoom.epbCreate.intro')}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {SUMMARY_ROWS.map((row) => (
          <div key={row} className="contents">
            <dt className="font-heading font-semibold text-poke-text-primary">
              {t(`draftRoom.epbCreate.${row}Label`)}
            </dt>
            <dd className="text-poke-text-secondary mb-1 sm:mb-0">{values[row]}</dd>
          </div>
        ))}
      </dl>
      <div className="max-w-xs">
        <Select
          id={modeId}
          label={t('draftRoom.epbCreate.modeChoiceLabel')}
          value={mode}
          onChange={(e) => setMode(e.target.value === 'slow' ? 'slow' : 'live')}
          options={[
            { value: 'live', label: tGlossary('draft.liveDraft') },
            { value: 'slow', label: tGlossary('draft.slowDraft') },
          ]}
        />
      </div>
      <p className="text-xs text-poke-text-muted">{t('draftRoom.epbCreate.editHint')}</p>
      {error && (
        <p role="alert" className="text-sm text-poke-danger">
          {error.kind === 'api' ? apiErrorText(error.error) : t('draftRoom.epbCreate.createFailed')}
        </p>
      )}
      <Button variant="primary" onClick={handleCreate} loading={loading}>
        {t('draftRoom.epbCreate.create')}
      </Button>
    </div>
  );
}
