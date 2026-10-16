'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import PokemonAutocomplete from '@/components/shared/PokemonAutocomplete';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import type { PokemonSet } from '@/types/team';

/** A form error: a client-side check (by key) or an API failure. Translated at render. */
type FormError =
  | { kind: 'selectWinner' }
  | { kind: 'needPokemon'; name: string }
  | { kind: 'submitFailed' }
  | { kind: 'api'; error: ApiErrorLike };

interface PlayerInfo {
  id: string;
  name: string;
}

interface ManualStatFormProps {
  matchId: string;
  players: [PlayerInfo, PlayerInfo];
  onSuccess?: () => void;
  /** Pre-loaded teams from match prep (player1, player2) */
  initialTeams?: { player1: PokemonSet[]; player2: PokemonSet[] };
  /** Format generation for autocomplete filtering */
  generation?: number;
  /** URL to redirect to after successful submission */
  redirectTo?: string;
}

interface PokemonStatInput {
  pokemon_name: string;
  kos_dealt: number;
  was_koed: boolean;
  was_lead: boolean;
  was_brought: boolean;
  moves_used: string;
}

const EMPTY_POKEMON: PokemonStatInput = {
  pokemon_name: '',
  kos_dealt: 0,
  was_koed: false,
  was_lead: false,
  was_brought: true,
  moves_used: '',
};

function pokemonSetToInput(set: PokemonSet): PokemonStatInput {
  return {
    pokemon_name: set.species,
    kos_dealt: 0,
    was_koed: false,
    was_lead: false,
    was_brought: true,
    moves_used: set.moves.join(', '),
  };
}

function buildInitialPokemon(
  initialTeams?: { player1: PokemonSet[]; player2: PokemonSet[] }
): [PokemonStatInput[], PokemonStatInput[]] {
  if (!initialTeams) return [[{ ...EMPTY_POKEMON }], [{ ...EMPTY_POKEMON }]];
  const p1 =
    initialTeams.player1.length > 0
      ? initialTeams.player1.map(pokemonSetToInput)
      : [{ ...EMPTY_POKEMON }];
  const p2 =
    initialTeams.player2.length > 0
      ? initialTeams.player2.map(pokemonSetToInput)
      : [{ ...EMPTY_POKEMON }];
  return [p1, p2];
}

export default function ManualStatForm({ matchId, players, onSuccess, initialTeams, generation, redirectTo }: ManualStatFormProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const apiErrorText = useApiErrorText(errorsMatches);
  const [winnerId, setWinnerId] = useState('');
  const [playerPokemon, setPlayerPokemon] = useState<[PokemonStatInput[], PokemonStatInput[]]>(
    () => buildInitialPokemon(initialTeams)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [successKey, setSuccessKey] = useState<'resultRecorded' | 'gameRecorded' | null>(null);

  function updatePokemon(
    playerIdx: 0 | 1,
    pokeIdx: number,
    field: keyof PokemonStatInput,
    value: string | number | boolean
  ) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = [...updated[playerIdx]];
      updated[playerIdx][pokeIdx] = { ...updated[playerIdx][pokeIdx], [field]: value };
      return updated;
    });
  }

  function addPokemon(playerIdx: 0 | 1) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = [...updated[playerIdx], { ...EMPTY_POKEMON }];
      return updated;
    });
  }

  function removePokemon(playerIdx: 0 | 1, pokeIdx: number) {
    setPlayerPokemon((prev) => {
      const updated = [...prev] as [PokemonStatInput[], PokemonStatInput[]];
      updated[playerIdx] = updated[playerIdx].filter((_, i) => i !== pokeIdx);
      return updated;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessKey(null);

    if (!winnerId) {
      setError({ kind: 'selectWinner' });
      return;
    }

    for (let i = 0; i < 2; i++) {
      const validPokemon = playerPokemon[i].filter((p) => p.pokemon_name.trim());
      if (validPokemon.length === 0) {
        setError({ kind: 'needPokemon', name: players[i].name });
        return;
      }
    }

    setLoading(true);
    try {
      const pokemon_stats = players.map((player, idx) => ({
        player_id: player.id,
        pokemon: playerPokemon[idx]
          .filter((p) => p.pokemon_name.trim())
          .map((p) => ({
            pokemon_name: p.pokemon_name.trim(),
            kos_dealt: p.kos_dealt,
            was_koed: p.was_koed,
            was_lead: p.was_lead,
            was_brought: p.was_brought,
            moves_used: p.moves_used
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean),
          })),
      }));

      const res = await fetch('/api/manual-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          winner_id: winnerId,
          pokemon_stats,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setSuccessKey(json.data.bo_reached ? 'resultRecorded' : 'gameRecorded');
        onSuccess?.();
        if (redirectTo) {
          setTimeout(() => router.push(redirectTo), 1500);
        } else {
          router.refresh();
        }
      } else {
        setError({ kind: 'api', error: toApiErrorLike(json) });
      }
    } catch {
      setError({ kind: 'submitFailed' });
    } finally {
      setLoading(false);
    }
  }

  function errorMessage(e: FormError): string {
    switch (e.kind) {
      case 'selectWinner':
        return t('common.selectWinner');
      case 'needPokemon':
        return t('common.needPokemon', { name: e.name });
      case 'submitFailed':
        return t('manual.submitFailed');
      case 'api':
        return apiErrorText(e.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Winner Selection */}
      <div>
        <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-2">{t('common.winner')}</label>
        <div className="flex gap-3">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setWinnerId(p.id)}
              className={`px-4 py-2 rounded-poke-md text-sm border transition-colors font-heading font-semibold ${
                winnerId === p.id
                  ? 'bg-poke-blue text-poke-on-blue border-poke-blue shadow-poke-sm'
                  : 'bg-poke-surface text-poke-text-secondary border-poke-border hover:border-poke-blue'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Per-Player Pokémon Stats */}
      {players.map((player, playerIdx) => (
        <Card key={player.id} variant="outlined" padding="md">
          <h3 className="font-heading font-semibold text-sm text-poke-text-primary mb-3">{t('common.pokemonOf', { name: player.name })}</h3>

          <div className="space-y-3">
            {playerPokemon[playerIdx].map((poke, pokeIdx) => (
              <div key={pokeIdx} className="grid grid-cols-12 gap-2 items-center">
                <PokemonAutocomplete
                  value={poke.pokemon_name}
                  onChange={(name) =>
                    updatePokemon(playerIdx as 0 | 1, pokeIdx, 'pokemon_name', name)
                  }
                  generation={generation}
                  placeholder={t('common.pokemonName')}
                  className="col-span-3"
                />
                <div className="col-span-2 flex items-center gap-1">
                  <label className="text-xs text-poke-text-muted">{t('manual.kosLabel')}</label>
                  <input
                    type="number"
                    min={0}
                    value={poke.kos_dealt}
                    onChange={(e) =>
                      updatePokemon(
                        playerIdx as 0 | 1,
                        pokeIdx,
                        'kos_dealt',
                        parseInt(e.target.value) || 0
                      )
                    }
                    className="w-12 px-1 py-1 border border-poke-border rounded-poke-md text-sm text-center bg-poke-surface text-poke-text-primary focus:outline-none focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20"
                  />
                </div>
                <label className="col-span-2 flex items-center gap-1 text-xs text-poke-text-secondary">
                  <input
                    type="checkbox"
                    checked={poke.was_koed}
                    onChange={(e) =>
                      updatePokemon(playerIdx as 0 | 1, pokeIdx, 'was_koed', e.target.checked)
                    }
                    className="accent-poke-accent"
                  />
                  {t('common.koed')}
                </label>
                <label className="col-span-2 flex items-center gap-1 text-xs text-poke-text-secondary">
                  <input
                    type="checkbox"
                    checked={poke.was_lead}
                    onChange={(e) =>
                      updatePokemon(playerIdx as 0 | 1, pokeIdx, 'was_lead', e.target.checked)
                    }
                    className="accent-poke-blue"
                  />
                  {t('common.lead')}
                </label>
                <input
                  type="text"
                  placeholder={t('manual.moves')}
                  value={poke.moves_used}
                  onChange={(e) =>
                    updatePokemon(playerIdx as 0 | 1, pokeIdx, 'moves_used', e.target.value)
                  }
                  className="col-span-2 px-2 py-1 border border-poke-border rounded-poke-md text-sm bg-poke-surface text-poke-text-primary placeholder:text-poke-text-muted focus:outline-none focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20"
                />
                <button
                  type="button"
                  onClick={() => removePokemon(playerIdx as 0 | 1, pokeIdx)}
                  className="col-span-1 text-poke-danger hover:text-poke-danger/70 text-sm transition-colors"
                  title={t('common.remove')}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {playerPokemon[playerIdx].length < 6 && (
            <button
              type="button"
              onClick={() => addPokemon(playerIdx as 0 | 1)}
              className="mt-2 text-xs text-poke-blue hover:text-poke-blue-hover font-heading font-semibold"
            >
              {t('common.addPokemon')}
            </button>
          )}
        </Card>
      ))}

      {error && <Alert variant="error">{errorMessage(error)}</Alert>}
      {successKey && <Alert variant="success">{t(`manual.${successKey}`)}</Alert>}

      <Button type="submit" variant="primary" loading={loading}>
        {t('common.submitResult')}
      </Button>
    </form>
  );
}
