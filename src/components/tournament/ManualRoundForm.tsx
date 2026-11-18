'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import type { LeaguePhaseAddress } from '@/lib/league-phase/paths';
import type { PhaseRound } from '@/types/league-phase';
import type { Round } from '@/types/round';
import type { ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { bestOfChoices } from '@/lib/tournament/best-of';
import { apiFailure, type UiError } from './ui-error';
import { formatNotReadyReasons, type FormatNotReadyReason } from './force-start';
import { phaseRoundRequests } from './phase-round-requests';

type ManualRoundErrorKey = 'manualRound.loadFailed' | 'manualRound.createFailed';

/**
 * The URL of the manual-round call. `force` adds `?force=true`, the league admin's audited override of the first-round
 * guard (`wantsForcedStart` in src/lib/format-engine/route-guards.ts): the route reads it from the query.
 */
export function manualRoundEndpoint(tournamentId: string, force = false): string {
  const base = `/api/tournaments/${tournamentId}/rounds/manual`;
  return force ? `${base}?force=true` : base;
}

type ManualRoundParticipant = { id: string; name: string; seed: number | null };

type ManualRoundFormProps = {
  bestOfDefault: number;
  onCancel: () => void;
} & (
  | { tournamentId: string; onRoundCreated: (round: Round) => void }
  | { phase: LeaguePhaseAddress; participants: ManualRoundParticipant[]; onRoundCreated: (round: PhaseRound) => void }
);

interface MatchSlot {
  player_1_id: string;
  player_2_id: string;
}

function seedSlots(participants: ManualRoundParticipant[]): MatchSlot[] {
  const count = Math.floor(participants.length / 2);
  return count > 0 ? Array.from({ length: count }, (_, i) => ({
    player_1_id: participants[i].id,
    player_2_id: participants[participants.length - 1 - i].id,
  })) : [{ player_1_id: '', player_2_id: '' }];
}

export default function ManualRoundForm(props: ManualRoundFormProps) {
  const { bestOfDefault, onCancel } = props;
  const tournamentId = 'tournamentId' in props ? props.tournamentId : null;
  const [participants, setParticipants] = useState<ManualRoundParticipant[]>('phase' in props ? props.participants : []);
  const [loading, setLoading] = useState(tournamentId !== null);
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  // errorsSeasons: the manual route of a grouped league's phase refuses with league-group codes (PHASE_PLAYER_WITHOUT_LEAGUE_GROUP,
  // PHASE_GROUPS_STALE), the same set RoundManager resolves.
  const errorText = useApiErrorText(errorsTournaments, errorsSeasons);
  const [error, setError] = useState<UiError<ManualRoundErrorKey> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const roundNameField = useRef<HTMLInputElement>(null);
  // Set when the server refused the first round with 409 `format_not_ready`: the dialog offers the audited force start.
  const [forceStart, setForceStart] = useState<FormatNotReadyReason[] | null>(null);

  const [roundName, setRoundName] = useState('');
  const [bestOf, setBestOf] = useState(bestOfDefault);
  const [slots, setSlots] = useState(() => seedSlots(participants));

  useEffect(() => {
    if (tournamentId === null) {
      roundNameField.current?.focus();
      return;
    }
    fetch(`/api/tournaments/${tournamentId}/participants`)
      .then((r) => r.json())
      .then((result: ApiResult<ManualRoundParticipant[]>) => {
        if (result.success) {
          setParticipants(result.data);
          setSlots(seedSlots(result.data));
        }
      })
      .catch(() => setError({ key: 'manualRound.loadFailed' }))
      .finally(() => setLoading(false));
  }, [tournamentId]);

  // Track which players are already assigned to a slot
  const usedPlayerIds = useMemo(() => {
    const used = new Set<string>();
    for (const slot of slots) {
      if (slot.player_1_id) used.add(slot.player_1_id);
      if (slot.player_2_id) used.add(slot.player_2_id);
    }
    return used;
  }, [slots]);

  function getAvailablePlayers(currentSlotIndex: number, side: 'player_1_id' | 'player_2_id') {
    const currentValue = slots[currentSlotIndex][side];
    return participants.filter((p) => {
      // Always include the currently selected player for this dropdown
      if (p.id === currentValue) return true;
      // Exclude players used in other slots
      return !usedPlayerIds.has(p.id);
    });
  }

  function updateSlot(index: number, field: 'player_1_id' | 'player_2_id', value: string) {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }

  function addSlot() {
    setSlots((prev) => [...prev, { player_1_id: '', player_2_id: '' }]);
  }

  function removeSlot(index: number) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }

  const unpairedCount = participants.length - usedPlayerIds.size;
  const allSlotsValid = slots.every((s) => s.player_1_id && s.player_2_id);
  const canSubmit = slots.length > 0 && allSlotsValid && unpairedCount <= 1;

  /** `force`: start anyway after the admin confirmed a 409 `format_not_ready` (audited by the server). */
  async function handleSubmit(force = false) {
    if (!canSubmit || submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const input = { name: roundName.trim() || undefined, best_of: bestOf, pairings: slots };
      const handleFailure = (result: Extract<ApiResult<unknown>, { success: false }>) => {
        const reasons = formatNotReadyReasons(result);
        if (reasons !== null && !force) setForceStart(reasons);
        setError(apiFailure(result));
      };
      if ('phase' in props) {
        const result = await phaseRoundRequests(props.phase).createManual(input, force);
        if (result.success) props.onRoundCreated(result.data);
        else handleFailure(result);
      } else {
        const res = await fetch(manualRoundEndpoint(props.tournamentId, force), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        const result: ApiResult<Round> = await res.json();
        if (result.success) props.onRoundCreated(result.data);
        else handleFailure(result);
      }
    } catch {
      setError({ key: 'manualRound.createFailed' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-caption text-fg-muted">{t('manualRound.loading')}</p>;

  if (participants.length < 2) {
    return <p className="text-caption text-fg-muted">{t('manualRound.tooFew')}</p>;
  }

  return (
    <form method="post" aria-label={t('rounds.createManual')} onSubmit={(event) => {
      event.preventDefault();
      void handleSubmit();
    }} className="flex flex-col gap-4 rounded-poke-lg border border-hairline-strong bg-surface p-4">
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-48 flex-1">
          <Input
            ref={roundNameField}
            label={t('manualRound.roundName')}
            type="text"
            name="name"
            maxLength={100}
            value={roundName}
            onChange={(e) => setRoundName(e.target.value)}
            placeholder={t('manualRound.roundNamePlaceholder')}
          />
        </div>
        <div className="w-36 shrink-0">
          <Select label={t('manualRound.bestOf')} name="best_of" value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
            {bestOfChoices(bestOfDefault).map((bo) => (
              <option key={bo} value={bo}>
                {tCommon('bestOf', { count: bo })}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-subtitle font-[550] text-fg">
            {t('manualRound.matchups')}
          </h4>
          {unpairedCount > 1 && (
            <span className="text-caption text-accent-ink">
              {t('manualRound.unpaired', { count: unpairedCount })}
            </span>
          )}
          {unpairedCount === 1 && (
            <span className="text-caption text-fg-muted">
              {t('manualRound.bye')}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {slots.map((slot, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <div className="min-w-40 flex-1">
              <Select
                name={`pairings[${i}].player_1_id`}
                aria-label={t('manualRound.playerOne', { count: i + 1 })}
                value={slot.player_1_id}
                onChange={(e) => updateSlot(i, 'player_1_id', e.target.value)}
                className="h-11 py-1.5 sm:h-10"
              >
                <option value="">{t('manualRound.selectPlayer')}</option>
                {getAvailablePlayers(i, 'player_1_id').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.seed ? `[${p.seed}] ` : ''}{p.name}
                  </option>
                ))}
              </Select>
              </div>

              <span className="text-caption font-medium text-fg-muted">{t('manualRound.versus')}</span>

              <div className="min-w-40 flex-1">
              <Select
                name={`pairings[${i}].player_2_id`}
                aria-label={t('manualRound.playerTwo', { count: i + 1 })}
                value={slot.player_2_id}
                onChange={(e) => updateSlot(i, 'player_2_id', e.target.value)}
                className="h-11 py-1.5 sm:h-10"
              >
                <option value="">{t('manualRound.selectPlayer')}</option>
                {getAvailablePlayers(i, 'player_2_id').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.seed ? `[${p.seed}] ` : ''}{p.name}
                  </option>
                ))}
              </Select>
              </div>

              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-poke-sm px-1 text-caption font-[550] text-loss hover:underline sm:min-h-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
                >
                  {t('manualRound.remove')}
                </button>
              )}
            </div>
          ))}
        </div>

        {usedPlayerIds.size < participants.length - 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={addSlot} className="mt-2">
            {t('manualRound.addMatch')}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-hairline pt-4">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!canSubmit}
          loading={submitting}
        >
          {t('manualRound.create')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
          {t('manualRound.cancel')}
        </Button>
      </div>

      <ConfirmDialog
        open={forceStart !== null}
        onClose={() => setForceStart(null)}
        onConfirm={() => {
          setForceStart(null);
          void handleSubmit(true);
        }}
        title={t('rounds.forceStart.title')}
        message={t('rounds.forceStart.message', {
          reasons: (forceStart ?? [])
            .map((reason) => (reason === 'relation_undrawn' ? t('rounds.forceStart.relationUndrawn') : t('rounds.forceStart.actionIncomplete')))
            .join(' '),
        })}
        confirmLabel={t('rounds.forceStart.confirm')}
        confirmVariant="primary"
      />
    </form>
  );
}
