'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ParticipantWithSeed } from '@/types/tournament';
import type { Round } from '@/types/round';
import type { ApiResult } from '@/types/api';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { commonMessages } from '@/i18n/messages/common';
import { errorsTournaments } from '@/i18n/messages/errors';
import { tournamentsAdminMessages } from '@/i18n/messages/tournaments/admin';
import { bestOfChoices } from '@/lib/tournament/best-of';
import { apiFailure, type UiError } from './ui-error';

type ManualRoundErrorKey = 'manualRound.loadFailed' | 'manualRound.createFailed';

interface ManualRoundFormProps {
  tournamentId: string;
  bestOfDefault: number;
  onRoundCreated: (round: Round) => void;
  onCancel: () => void;
}

interface MatchSlot {
  player_1_id: string;
  player_2_id: string;
}

export default function ManualRoundForm({
  tournamentId,
  bestOfDefault,
  onRoundCreated,
  onCancel,
}: ManualRoundFormProps) {
  const [participants, setParticipants] = useState<ParticipantWithSeed[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useT(tournamentsAdminMessages);
  const tCommon = useT(commonMessages);
  const errorText = useApiErrorText(errorsTournaments);
  const [error, setError] = useState<UiError<ManualRoundErrorKey> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [roundName, setRoundName] = useState('');
  const [bestOf, setBestOf] = useState(bestOfDefault);
  const [slots, setSlots] = useState<MatchSlot[]>([{ player_1_id: '', player_2_id: '' }]);

  useEffect(() => {
    fetch(`/api/tournaments/${tournamentId}/participants`)
      .then((r) => r.json())
      .then((result: ApiResult<ParticipantWithSeed[]>) => {
        if (result.success) {
          setParticipants(result.data);
          // Pre-fill match slots: pair participants in seed order
          const count = Math.floor(result.data.length / 2);
          if (count > 0) {
            const prefilled: MatchSlot[] = [];
            for (let i = 0; i < count; i++) {
              prefilled.push({
                player_1_id: result.data[i]?.id ?? '',
                player_2_id: result.data[result.data.length - 1 - i]?.id ?? '',
              });
            }
            setSlots(prefilled);
          }
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

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/rounds/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roundName.trim() || undefined,
          best_of: bestOf,
          pairings: slots.map((s) => ({
            player_1_id: s.player_1_id,
            player_2_id: s.player_2_id,
          })),
        }),
      });
      const result: ApiResult<Round> = await res.json();

      if (!result.success) {
        setError(apiFailure(result));
        return;
      }

      onRoundCreated(result.data);
    } catch {
      setError({ key: 'manualRound.createFailed' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-xs text-poke-text-muted">{t('manualRound.loading')}</p>;

  if (participants.length < 2) {
    return <p className="text-xs text-poke-text-muted">{t('manualRound.tooFew')}</p>;
  }

  return (
    <div className="border border-poke-border rounded-poke-md p-4 space-y-4 bg-poke-surface">
      {error && <Alert variant="error">{'api' in error ? errorText(error.api) : t(error.key)}</Alert>}

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="block text-xs text-poke-text-secondary mb-1">{t('manualRound.roundName')}</label>
          <input
            type="text"
            value={roundName}
            onChange={(e) => setRoundName(e.target.value)}
            placeholder={t('manualRound.roundNamePlaceholder')}
            className="w-full px-2 py-1.5 text-sm border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          />
        </div>
        <div>
          <label className="block text-xs text-poke-text-secondary mb-1">{t('manualRound.bestOf')}</label>
          <select
            value={bestOf}
            onChange={(e) => setBestOf(Number(e.target.value))}
            className="px-2 py-1.5 text-sm border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
          >
            {bestOfChoices(bestOfDefault).map((bo) => (
              <option key={bo} value={bo}>
                {tCommon('bestOf', { count: bo })}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-heading font-semibold text-poke-text-primary">
            {t('manualRound.matchups')}
          </h4>
          {unpairedCount > 1 && (
            <span className="text-xs text-poke-warning">
              {t('manualRound.unpaired', { count: unpairedCount })}
            </span>
          )}
          {unpairedCount === 1 && (
            <span className="text-xs text-poke-text-muted">
              {t('manualRound.bye')}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={slot.player_1_id}
                onChange={(e) => updateSlot(i, 'player_1_id', e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('manualRound.selectPlayer')}</option>
                {getAvailablePlayers(i, 'player_1_id').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.seed ? `[${p.seed}] ` : ''}{p.name}
                  </option>
                ))}
              </select>

              <span className="text-xs text-poke-text-muted font-medium">{t('manualRound.versus')}</span>

              <select
                value={slot.player_2_id}
                onChange={(e) => updateSlot(i, 'player_2_id', e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-poke-border rounded-poke-md bg-poke-surface text-poke-text-primary"
              >
                <option value="">{t('manualRound.selectPlayer')}</option>
                {getAvailablePlayers(i, 'player_2_id').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.seed ? `[${p.seed}] ` : ''}{p.name}
                  </option>
                ))}
              </select>

              {slots.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="text-xs text-poke-danger hover:underline shrink-0"
                >
                  {t('manualRound.remove')}
                </button>
              )}
            </div>
          ))}
        </div>

        {usedPlayerIds.size < participants.length - 1 && (
          <Button variant="ghost" size="sm" onClick={addSlot} className="mt-2">
            {t('manualRound.addMatch')}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-poke-border">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
        >
          {t('manualRound.create')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('manualRound.cancel')}
        </Button>
      </div>
    </div>
  );
}
