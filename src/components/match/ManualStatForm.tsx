'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewPlate from '@/components/ui/SkewPlate';
import PlateButton from '@/components/match/PlateButton';
import StickyActionBar from '@/components/match/StickyActionBar';
import { X } from 'lucide-react';
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

/**
 * The request: `done` once a game was recorded and the page is about to redirect, so the same game cannot be sent
 * twice (a manual game has no content dedupe). Without a redirect the form stays usable for the next game.
 */
type SubmitPhase = 'idle' | 'submitting' | 'done';

interface PlayerInfo {
  id: string;
  name: string;
}

interface ManualStatFormProps {
  matchId: string;
  players: [PlayerInfo, PlayerInfo];
  onSuccess?: () => void;
  /**
   * Pre-loaded teams from match prep (player1, player2), already filtered by
   * spec §7 on the server (`selectVisibleMatchPrepRosters`): a side the viewer
   * may not see arrives as `[]` and starts as one empty row.
   */
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
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [error, setError] = useState<FormError | null>(null);
  const [successKey, setSuccessKey] = useState<'resultRecorded' | 'gameRecorded' | null>(null);
  const summaryId = useId();

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
    if (phase !== 'idle') return;
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

    setPhase('submitting');
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
          setPhase('done');
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
      setPhase((current) => (current === 'submitting' ? 'idle' : current));
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

  // The summary under the form: what this submission records, read from the fields as they stand.
  const winner = players.find((p) => p.id === winnerId) ?? null;
  const sideSummary = players.map((player, idx) => {
    const named = playerPokemon[idx].filter((p) => p.pokemon_name.trim());
    return { id: player.id, name: player.name, count: named.length, kos: named.reduce((sum, p) => sum + p.kos_dealt, 0) };
  });
  const CHECK = 'flex min-h-11 items-center gap-2 text-body text-fg sm:min-h-0';
  const BOX = 'size-4 shrink-0 cursor-pointer accent-accent-fill';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Winner Selection */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-caption font-[550] text-fg">{t('common.winner')}</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-2 px-1">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={winnerId === p.id}
              onClick={() => setWinnerId(p.id)}
              className="inline-flex min-h-11 items-stretch text-body transition-[filter] duration-80 ease-out hover:brightness-95 motion-reduce:transition-none"
            >
              {winnerId === p.id ? (
                <SkewPlate variant="rank" tier={1} className="px-5 py-2">
                  {p.name}
                </SkewPlate>
              ) : (
                <SkewPlate variant="button" tone="secondary" className="px-5 py-2">
                  {p.name}
                </SkewPlate>
              )}
            </button>
          ))}
        </div>
        <p className="text-caption text-fg-muted">{t('manual.winnerHint')}</p>
      </fieldset>

      {/* Per-Player Pokémon Stats */}
      {players.map((player, playerIdx) => (
        <section key={player.id} className="flex flex-col gap-3 border-t border-hairline pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-subtitle font-[550] text-fg">{t('common.pokemonOf', { name: player.name })}</h3>
            <span className="text-caption tabular-nums text-fg-muted">{t('manual.rosterCount', { count: playerPokemon[playerIdx].length })}</span>
          </div>

          <ul className="flex flex-col gap-2">
            {playerPokemon[playerIdx].map((poke, pokeIdx) => (
              <li
                key={pokeIdx}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-poke-md border border-hairline bg-elevated p-2 md:grid-cols-[minmax(0,1.3fr)_7rem_auto_auto_minmax(0,1.2fr)_auto]"
              >
                <PokemonAutocomplete
                  value={poke.pokemon_name}
                  onChange={(name) =>
                    updatePokemon(playerIdx as 0 | 1, pokeIdx, 'pokemon_name', name)
                  }
                  generation={generation}
                  placeholder={t('common.pokemonName')}
                  className="[&_input]:h-9 [&_input]:px-3"
                />
                <button
                  type="button"
                  onClick={() => removePokemon(playerIdx as 0 | 1, pokeIdx)}
                  className="grid size-11 place-items-center rounded-poke-md text-fg-muted transition-colors duration-80 hover:bg-hover hover:text-loss md:order-last md:size-9"
                  aria-label={t('manual.removeAria', { n: pokeIdx + 1 })}
                  title={t('common.remove')}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
                <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
                  {/* stats: the KO count, then the two flags (they wrap as a pair on a narrow phone) */}
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-caption text-fg-muted md:hidden">{t('manual.kosLabel')}</span>
                    <Input
                      type="number"
                      min={0}
                      aria-label={t('manual.kosAria', { n: pokeIdx + 1 })}
                      value={poke.kos_dealt}
                      onChange={(e) =>
                        updatePokemon(
                          playerIdx as 0 | 1,
                          pokeIdx,
                          'kos_dealt',
                          parseInt(e.target.value) || 0
                        )
                      }
                      className="w-24 tabular-nums md:w-full"
                    />
                  </div>
                  <div className="flex items-center gap-4 md:contents">
                  <label className={CHECK}>
                    <input
                      type="checkbox"
                      checked={poke.was_koed}
                      onChange={(e) =>
                        updatePokemon(playerIdx as 0 | 1, pokeIdx, 'was_koed', e.target.checked)
                      }
                      className={BOX}
                    />
                    {t('common.koed')}
                  </label>
                  <label className={CHECK}>
                    <input
                      type="checkbox"
                      checked={poke.was_lead}
                      onChange={(e) =>
                        updatePokemon(playerIdx as 0 | 1, pokeIdx, 'was_lead', e.target.checked)
                      }
                      className={BOX}
                    />
                    {t('common.lead')}
                  </label>
                  </div>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <Input
                    type="text"
                    aria-label={t('manual.movesAria', { n: pokeIdx + 1 })}
                    placeholder={t('manual.moves')}
                    value={poke.moves_used}
                    onChange={(e) =>
                      updatePokemon(playerIdx as 0 | 1, pokeIdx, 'moves_used', e.target.value)
                    }
                  />
                </div>
              </li>
            ))}
          </ul>

          {playerPokemon[playerIdx].length < 6 && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 self-start sm:min-h-0" onClick={() => addPokemon(playerIdx as 0 | 1)}>
              {t('common.addPokemon')}
            </Button>
          )}
        </section>
      ))}

      {/* What this submission records, to check before sending it */}
      <section aria-labelledby={summaryId} className="flex flex-col gap-2 rounded-poke-md border border-hairline bg-elevated p-3">
        <h3 id={summaryId} className="flex items-center gap-2 text-caption font-[550] text-fg-muted">
          <ItemIcon item="rare-candy" />
          {t('manual.summaryTitle')}
        </h3>
        <p className={winner ? 'font-heading text-title text-win' : 'text-body text-fg-muted'}>
          {winner ? t('manual.summaryWinner', { name: winner.name }) : t('manual.summaryNoWinner')}
        </p>
        <ul className="flex flex-col gap-0.5 text-body tabular-nums text-fg-muted">
          {sideSummary.map((side) => (
            <li key={side.id}>{t('manual.summarySide', { name: side.name, count: side.count, kos: side.kos })}</li>
          ))}
        </ul>
      </section>

      {error && <Alert variant="error">{errorMessage(error)}</Alert>}
      {successKey && <Alert variant="success">{t(`manual.${successKey}`)}</Alert>}

      <StickyActionBar>
        <PlateButton type="submit" loading={phase === 'submitting'} disabled={phase === 'done'} className="flex-1 sm:flex-none">
          {t('common.submitResult')}
        </PlateButton>
      </StickyActionBar>
    </form>
  );
}
