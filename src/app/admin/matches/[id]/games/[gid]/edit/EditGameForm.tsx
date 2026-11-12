'use client';

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Alert from '@/components/ui/Alert';
import type { BattleStat } from '@/types/game';
import { useDataLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import GameChangeAlerts from '@/components/match/GameChangeAlerts';
import DownstreamApprovalDialog from '@/components/match/DownstreamApprovalDialog';
import {
  approvedMatchIds,
  downstreamApproval,
  downstreamResetCount,
  gameEditRequest,
  sendGameChange,
  type DownstreamApproval,
} from '@/lib/match/game-change-outcome';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import type { Locale } from '@/i18n/config';
import { CHOICE, CHOICE_OFF, CHOICE_ON, FIELD_LABEL, FOCUS, INSET_ROW, NATIVE_SECONDARY } from '@/components/admin/match-styles';
import { cn } from '@/lib/utils/cn';

/** A flag of one Pokémon (KO'd, lead, brought): a 44 px row on a phone. */
const FLAG_LABEL = 'inline-flex min-h-11 items-center gap-2 text-caption text-fg sm:min-h-8';
const FLAG_BOX = 'size-4 shrink-0 accent-[var(--accent-fill)]';

interface PlayerInfo {
  id: string;
  name: string;
}

interface EditGameFormProps {
  gameId: string;
  matchId: string;
  /**
   * The game's `updated_at` as this page loaded it. Sent as
   * `expected_updated_at` so the save is refused (409
   * `admin_game_edit_stale`, nothing written) when the game changed since.
   */
  gameUpdatedAt: string;
  currentWinnerId: string | null;
  player1: PlayerInfo;
  player2: PlayerInfo;
  battleStats: BattleStat[];
  /** The viewer is a site admin (the admin data tools are site-admin only). */
  isSiteAdmin: boolean;
  /** Where Back and a finished save go (default: the match page); the match page's `?back=` rides along. */
  returnHref?: string;
}

interface PokemonStatInput {
  pokemon_name: string;
  kos_dealt: number;
  was_koed: boolean;
  was_lead: boolean;
  was_brought: boolean;
  moves_used: string;
  turns_active: number;
}

const EMPTY_POKEMON: PokemonStatInput = {
  pokemon_name: '',
  kos_dealt: 0,
  was_koed: false,
  was_lead: false,
  was_brought: true,
  moves_used: '',
  turns_active: 0,
};

/** An API failure (translated by its code) or a local message key; never translated text. */
type FormError = { api: ApiErrorLike } | { local: 'selectWinner' | 'updateFailed' };

/**
 * The display name of a typed English species, when it differs (German data
 * locale). The input itself stays the stored English @pkmn name.
 */
function speciesHint(name: string, dl: Locale): string | null {
  const trimmed = name.trim();
  if (dl === 'en' || !trimmed) return null;
  const shown = localizeSpecies(trimmed, dl);
  return shown !== trimmed ? shown : null;
}

/** As `speciesHint`, for the comma-separated move list. */
function movesHint(moves: string, dl: Locale): string | null {
  if (dl === 'en') return null;
  const names = moves.split(',').map((m) => m.trim()).filter(Boolean);
  const shown = names.map((m) => localizeMove(m, dl));
  return shown.some((m, i) => m !== names[i]) ? shown.join(', ') : null;
}

function statToInput(stat: BattleStat): PokemonStatInput {
  return {
    pokemon_name: stat.pokemon_name,
    kos_dealt: stat.kos_dealt,
    was_koed: stat.was_koed,
    was_lead: stat.was_lead,
    was_brought: stat.was_brought,
    moves_used: stat.moves_used.join(', '),
    turns_active: stat.turns_active,
  };
}

export default function EditGameForm({
  gameId,
  matchId,
  gameUpdatedAt,
  currentWinnerId,
  player1,
  player2,
  battleStats,
  isSiteAdmin,
  returnHref = `/admin/matches/${matchId}`,
}: EditGameFormProps) {
  const router = useRouter();
  const t = useT(adminCoreMessages);
  const dataLocale = useDataLocale();
  const winnerLabelId = useId();
  const players = [player1, player2];

  // Split existing stats by player
  const p1Stats = battleStats.filter((s) => s.player_id === player1.id).map(statToInput);
  const p2Stats = battleStats.filter((s) => s.player_id === player2.id).map(statToInput);

  const [winnerId, setWinnerId] = useState(currentWinnerId ?? '');
  const [playerPokemon, setPlayerPokemon] = useState<[PokemonStatInput[], PokemonStatInput[]]>([
    p1Stats.length > 0 ? p1Stats : [{ ...EMPTY_POKEMON }],
    p2Stats.length > 0 ? p2Stats : [{ ...EMPTY_POKEMON }],
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [success, setSuccess] = useState(false);
  /** Warnings of a saved edit (e.g. the EPB recheck failed): shown instead of the auto-return. */
  const [warnings, setWarnings] = useState<ApiErrorLike[]>([]);
  /** The played later bracket matches the API says this edit would reset (409, nothing written): the admin approves or cancels. */
  const [approval, setApproval] = useState<DownstreamApproval | null>(null);
  /** How many later bracket matches the saved edit reset after the admin approved it. */
  const [resetCount, setResetCount] = useState(0);

  function updatePokemonField<K extends keyof PokemonStatInput>(
    playerIdx: number,
    pokeIdx: number,
    field: K,
    value: PokemonStatInput[K]
  ) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = [...updated[playerIdx]];
      updated[playerIdx][pokeIdx] = { ...updated[playerIdx][pokeIdx], [field]: value };
      return updated;
    });
  }

  function addPokemon(playerIdx: number) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = [...updated[playerIdx], { ...EMPTY_POKEMON }];
      return updated;
    });
  }

  function removePokemon(playerIdx: number, pokeIdx: number) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = updated[playerIdx].filter((_, i) => i !== pokeIdx);
      return updated;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void save();
  }

  /** `confirmDownstream`: the later bracket matches the admin approved resetting (the last refusal listed them). */
  async function save(confirmDownstream?: readonly string[]) {
    setError(null);
    setSuccess(false);
    setWarnings([]);
    setResetCount(0);

    if (!winnerId) {
      setError({ local: 'selectWinner' });
      return;
    }

    setLoading(true);
    try {
      const battle_stats = players.flatMap((player, idx) =>
        playerPokemon[idx]
          .filter((p) => p.pokemon_name.trim())
          .map((p) => ({
            player_id: player.id,
            pokemon_name: p.pokemon_name.trim(),
            kos_dealt: p.kos_dealt,
            was_koed: p.was_koed,
            was_lead: p.was_lead,
            was_brought: p.was_brought,
            moves_used: p.moves_used
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean),
            turns_active: p.turns_active,
          }))
      );

      const request = gameEditRequest(gameId, {
        winnerId,
        battleStats: battle_stats,
        expectedUpdatedAt: gameUpdatedAt,
        confirmDownstream,
      });
      const result = await sendGameChange(request.url, request.init);

      if (!result.ok) {
        const needed = downstreamApproval(result.error);
        if (needed) {
          // Nothing was written: ask first, then send the same edit again with the approval.
          setApproval(needed);
          return;
        }
      }
      setApproval(null);
      if (result.ok) {
        setSuccess(true);
        setResetCount(downstreamResetCount(result.data));
        setWarnings(result.warnings);
        // With a warning the admin stays here to read it and leaves by "Back to match".
        if (result.warnings.length === 0) {
          setTimeout(() => router.push(returnHref), 1500);
        }
      } else {
        setError({ api: result.error });
      }
    } catch {
      setApproval(null);
      setError({ local: 'updateFailed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Winner Selection */}
      <div role="group" aria-labelledby={winnerLabelId}>
        <p id={winnerLabelId} className={FIELD_LABEL}>
          {t('editGame.winner')}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={winnerId === p.id}
              onClick={() => setWinnerId(p.id)}
              className={cn(CHOICE, 'min-w-28', winnerId === p.id ? CHOICE_ON : CHOICE_OFF)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Per-player Pokemon */}
      {players.map((player, pIdx) => (
        <Section key={player.id} title={player.name} icon="poke-ball">
          <div className="flex flex-col gap-3">
            {playerPokemon[pIdx].map((poke, pokeIdx) => {
              const nameHint = speciesHint(poke.pokemon_name, dataLocale);
              const moveHint = movesHint(poke.moves_used, dataLocale);
              return (
                <div key={pokeIdx} className={cn(INSET_ROW, 'grid grid-cols-2 gap-x-3 gap-y-3 py-3 sm:grid-cols-12')}>
                  <div className="col-span-2 sm:col-span-4">
                    <Input
                      label={t('editGame.name')}
                      type="text"
                      value={poke.pokemon_name}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'pokemon_name', e.target.value)}
                      placeholder={t('editGame.namePlaceholder')}
                      hint={nameHint ? t('editGame.shownAs', { name: nameHint }) : undefined}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label={t('editGame.kos')}
                      type="number"
                      min={0}
                      value={poke.kos_dealt}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'kos_dealt', parseInt(e.target.value) || 0)}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      label={t('editGame.turns')}
                      type="number"
                      min={0}
                      value={poke.turns_active}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'turns_active', parseInt(e.target.value) || 0)}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <Input
                      label={t('editGame.moves')}
                      type="text"
                      value={poke.moves_used}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'moves_used', e.target.value)}
                      placeholder={t('editGame.movesPlaceholder')}
                      hint={moveHint ? t('editGame.shownAs', { name: moveHint }) : undefined}
                    />
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 sm:col-span-12">
                    <div className="flex flex-wrap items-center gap-x-4">
                      <label className={FLAG_LABEL}>
                        <input
                          type="checkbox"
                          className={FLAG_BOX}
                          checked={poke.was_koed}
                          onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_koed', e.target.checked)}
                        />
                        {t('editGame.koed')}
                      </label>
                      <label className={FLAG_LABEL}>
                        <input
                          type="checkbox"
                          className={FLAG_BOX}
                          checked={poke.was_lead}
                          onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_lead', e.target.checked)}
                        />
                        {t('editGame.lead')}
                      </label>
                      <label className={FLAG_LABEL}>
                        <input
                          type="checkbox"
                          className={FLAG_BOX}
                          checked={poke.was_brought}
                          onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_brought', e.target.checked)}
                        />
                        {t('editGame.brought')}
                      </label>
                    </div>
                    {playerPokemon[pIdx].length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePokemon(pIdx, pokeIdx)}
                        className={cn('inline-flex size-11 items-center justify-center rounded-poke-md text-fg-muted hover:bg-hover hover:text-loss sm:size-8', FOCUS)}
                        aria-label={t('editGame.removePokemon')}
                      >
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => addPokemon(pIdx)}
              className={cn(NATIVE_SECONDARY, 'min-h-11 self-start sm:min-h-8')}
            >
              {t('editGame.addPokemon')}
            </button>
          </div>
        </Section>
      ))}

      {error && 'local' in error && <Alert variant="error">{t(`editGame.${error.local}`)}</Alert>}
      {success && (
        <Alert variant="success">
          <p>{t('editGame.updated')}</p>
          {resetCount > 0 && <p>{t('gameChange.downstream.done', { count: resetCount })}</p>}
        </Alert>
      )}
      <GameChangeAlerts error={error && 'api' in error ? error.api : null} warnings={warnings} isSiteAdmin={isSiteAdmin} />

      <div className="flex flex-wrap gap-2">
        {/* A saved edit cannot be saved again from this page: its version is spent (the next save would answer 409). */}
        <Button type="submit" variant="primary" loading={loading} disabled={success} className="max-sm:min-h-11">
          {t('editGame.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(returnHref)}
          disabled={loading}
          className="max-sm:min-h-11"
        >
          {success ? t('editGame.backToMatch') : t('editGame.cancel')}
        </Button>
      </div>

      <DownstreamApprovalDialog
        approval={approval}
        onApprove={() => void save(approval ? approvedMatchIds(approval) : undefined)}
        onCancel={() => setApproval(null)}
        loading={loading}
      />
    </form>
  );
}
