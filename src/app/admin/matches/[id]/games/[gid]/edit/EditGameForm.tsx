'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import type { BattleStat } from '@/types/game';
import { useDataLocale, useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import GameChangeAlerts from '@/components/match/GameChangeAlerts';
import { gameEditRequest, sendGameChange } from '@/lib/match/game-change-outcome';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import type { Locale } from '@/i18n/config';

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setWarnings([]);

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
      });
      const result = await sendGameChange(request.url, request.init);

      if (result.ok) {
        setSuccess(true);
        setWarnings(result.warnings);
        // With a warning the admin stays here to read it and leaves by "Back to match".
        if (result.warnings.length === 0) {
          setTimeout(() => router.push(returnHref), 1500);
        }
      } else {
        setError({ api: result.error });
      }
    } catch {
      setError({ local: 'updateFailed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Winner Selection */}
      <div>
        <label className="block text-sm font-heading text-poke-text-muted mb-2">{t('editGame.winner')}</label>
        <div className="flex gap-3">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setWinnerId(p.id)}
              className={`px-4 py-2 rounded-poke-md text-sm border transition-colors font-heading font-semibold ${
                winnerId === p.id
                  ? 'bg-poke-accent text-poke-surface border-poke-accent shadow-poke-sm'
                  : 'bg-poke-surface text-poke-text-secondary border-poke-border hover:border-poke-blue'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Per-player Pokemon */}
      {players.map((player, pIdx) => (
        <Card key={player.id} variant="outlined" padding="md">
          <h3 className="text-sm font-heading font-semibold text-poke-text-secondary mb-3">
            {player.name}
          </h3>
          <div className="space-y-3">
            {playerPokemon[pIdx].map((poke, pokeIdx) => {
              const nameHint = speciesHint(poke.pokemon_name, dataLocale);
              const moveHint = movesHint(poke.moves_used, dataLocale);
              return (
              <div key={pokeIdx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <label className="text-[10px] text-poke-text-muted">{t('editGame.name')}</label>
                  <input
                    type="text"
                    value={poke.pokemon_name}
                    onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'pokemon_name', e.target.value)}
                    className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                    placeholder={t('editGame.namePlaceholder')}
                  />
                  {nameHint && (
                    <p className="mt-0.5 truncate text-[10px] text-poke-text-muted">
                      {t('editGame.shownAs', { name: nameHint })}
                    </p>
                  )}
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] text-poke-text-muted">{t('editGame.kos')}</label>
                  <input
                    type="number"
                    min={0}
                    value={poke.kos_dealt}
                    onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'kos_dealt', parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] text-poke-text-muted">{t('editGame.turns')}</label>
                  <input
                    type="number"
                    min={0}
                    value={poke.turns_active}
                    onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'turns_active', parseInt(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-[10px] text-poke-text-muted">{t('editGame.moves')}</label>
                  <input
                    type="text"
                    value={poke.moves_used}
                    onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'moves_used', e.target.value)}
                    className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                    placeholder={t('editGame.movesPlaceholder')}
                  />
                  {moveHint && (
                    <p className="mt-0.5 truncate text-[10px] text-poke-text-muted">
                      {t('editGame.shownAs', { name: moveHint })}
                    </p>
                  )}
                </div>
                <div className="col-span-3 flex gap-3 items-center pb-0.5">
                  <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                    <input
                      type="checkbox"
                      checked={poke.was_koed}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_koed', e.target.checked)}
                    />
                    {t('editGame.koed')}
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                    <input
                      type="checkbox"
                      checked={poke.was_lead}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_lead', e.target.checked)}
                    />
                    {t('editGame.lead')}
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                    <input
                      type="checkbox"
                      checked={poke.was_brought}
                      onChange={(e) => updatePokemonField(pIdx, pokeIdx, 'was_brought', e.target.checked)}
                    />
                    {t('editGame.brought')}
                  </label>
                </div>
                <div className="col-span-1 flex items-end pb-0.5">
                  {playerPokemon[pIdx].length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePokemon(pIdx, pokeIdx)}
                      className="text-poke-accent text-xs hover:underline"
                      aria-label={t('editGame.removePokemon')}
                    >
                      <span aria-hidden="true">&times;</span>
                    </button>
                  )}
                </div>
              </div>
              );
            })}
            <button
              type="button"
              onClick={() => addPokemon(pIdx)}
              className="text-xs text-poke-blue hover:underline font-heading"
            >
              {t('editGame.addPokemon')}
            </button>
          </div>
        </Card>
      ))}

      {error && 'local' in error && <Alert variant="error">{t(`editGame.${error.local}`)}</Alert>}
      {success && <Alert variant="success">{t('editGame.updated')}</Alert>}
      <GameChangeAlerts error={error && 'api' in error ? error.api : null} warnings={warnings} isSiteAdmin={isSiteAdmin} />

      <div className="flex gap-3">
        {/* A saved edit cannot be saved again from this page: its version is spent (the next save would answer 409). */}
        <Button type="submit" variant="primary" loading={loading} disabled={success}>
          {t('editGame.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(returnHref)}
          disabled={loading}
        >
          {success ? t('editGame.backToMatch') : t('editGame.cancel')}
        </Button>
      </div>
    </form>
  );
}
