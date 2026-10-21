'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import PokemonAutocomplete from '@/components/shared/PokemonAutocomplete';
import { useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin, errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import type { ReplayPreviewResult, ParsedPokemonStat } from '@/types/game';

/** A form error: a client-side check (by key) or an API failure. Translated at render. */
type FormError =
  | { kind: 'enterReplayUrl' }
  | { kind: 'parseFailed' }
  | { kind: 'expectedTwo'; count: number }
  | { kind: 'selectWinner' }
  | { kind: 'needPokemon'; name: string }
  | { kind: 'importFailed' }
  | { kind: 'api'; error: ApiErrorLike };

interface PlayerInfo {
  id: string;
  name: string;
}

interface ReplayImportFormProps {
  matchId: string;
  players: [PlayerInfo, PlayerInfo];
  /** Pre-fill the replay URL (e.g. carried over from a failed normal submit). */
  initialReplayUrl?: string;
  /** Auto-parse on mount when an initial URL is supplied. */
  autoParse?: boolean;
  /** Format generation for autocomplete filtering. */
  generation?: number;
  /** URL to redirect to after a successful import. */
  redirectTo?: string;
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

function parsedToInput(p: ParsedPokemonStat): PokemonStatInput {
  return {
    pokemon_name: p.pokemon_name,
    kos_dealt: p.kos_dealt,
    was_koed: p.was_koed,
    was_lead: p.was_lead,
    was_brought: p.was_brought,
    moves_used: p.moves_used.join(', '),
    turns_active: p.turns_active,
  };
}

export default function ReplayImportForm({
  matchId,
  players,
  initialReplayUrl,
  autoParse,
  generation,
  redirectTo,
}: ReplayImportFormProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const apiErrorText = useApiErrorText(errorsAdmin, errorsMatches);

  const [replayUrl, setReplayUrl] = useState(initialReplayUrl ?? '');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<FormError | null>(null);

  // Parsed state (set once the replay is parsed)
  const [psUsernames, setPsUsernames] = useState<[string, string] | null>(null);
  const [sidePokemon, setSidePokemon] = useState<[PokemonStatInput[], PokemonStatInput[]] | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [winnerId, setWinnerId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FormError | null>(null);
  const [successKey, setSuccessKey] = useState<'importedComplete' | 'importedMore' | null>(null);

  const parseAbortRef = useRef<AbortController | null>(null);

  function clearParsedPreview() {
    setPsUsernames(null);
    setSidePokemon(null);
    setSwapped(false);
    setWinnerId('');
    setParseError(null);
    setSubmitError(null);
    setSuccessKey(null);
  }

  function errorMessage(e: FormError): string {
    switch (e.kind) {
      case 'enterReplayUrl':
        return t('common.enterReplayUrl');
      case 'parseFailed':
        return t('replayImport.parseFailed');
      case 'expectedTwo':
        return t('replayImport.expectedTwo', { count: e.count });
      case 'selectWinner':
        return t('common.selectWinner');
      case 'needPokemon':
        return t('common.needPokemon', { name: e.name });
      case 'importFailed':
        return t('replayImport.importFailed');
      case 'api':
        return apiErrorText(e.error);
    }
  }

  function handleReplayUrlChange(value: string) {
    parseAbortRef.current?.abort();
    parseAbortRef.current = null;
    setParsing(false);
    clearParsedPreview();
    setReplayUrl(value);
  }

  // Player assigned to a given parsed side, accounting for the swap.
  const assignedPlayer = (sideIdx: 0 | 1): PlayerInfo => players[swapped ? (1 - sideIdx) : sideIdx];

  async function handleParse(e?: React.FormEvent) {
    e?.preventDefault();
    setParseError(null);
    setSubmitError(null);
    setSuccessKey(null);

    const url = replayUrl.trim();
    if (!url) {
      setParseError({ kind: 'enterReplayUrl' });
      return;
    }

    setParsing(true);
    const controller = new AbortController();
    parseAbortRef.current = controller;

    try {
      const res = await fetch(`/api/admin/matches/${matchId}/replay-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replay_url: url }),
        signal: controller.signal,
      });
      const json: { success: boolean; data?: ReplayPreviewResult; error?: string } = await res.json();

      if (controller.signal.aborted) return;

      if (!json.success || !json.data) {
        const apiError = toApiErrorLike(json);
        setParseError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'parseFailed' });
        return;
      }

      const preview = json.data;
      const sides = preview.parsed.players;
      if (sides.length !== 2) {
        setParseError({ kind: 'expectedTwo', count: sides.length });
        return;
      }

      // Pre-fill assignment from best-effort suggestions.
      const sug = preview.suggestions;
      const initSwapped =
        sug[0]?.suggested_player_id === players[1].id ||
        sug[1]?.suggested_player_id === players[0].id;

      // Default winner: the registered player assigned to the winning side.
      const winningSideIdx = sides.findIndex((s) => s.ps_username === preview.winner_ps_username);
      const resolvedWinnerSide = (winningSideIdx === -1 ? 0 : winningSideIdx) as 0 | 1;
      const defaultWinner = players[initSwapped ? (1 - resolvedWinnerSide) : resolvedWinnerSide];

      setPsUsernames([sides[0].ps_username, sides[1].ps_username]);
      setSidePokemon([sides[0].pokemon.map(parsedToInput), sides[1].pokemon.map(parsedToInput)]);
      setSwapped(initSwapped);
      setWinnerId(defaultWinner.id);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setParseError({ kind: 'parseFailed' });
    } finally {
      if (parseAbortRef.current === controller) {
        parseAbortRef.current = null;
        setParsing(false);
      }
    }
  }

  useEffect(() => {
    return () => {
      parseAbortRef.current?.abort();
    };
  }, []);

  // Auto-parse once on mount when handed an initial URL (fallback flow).
  const autoParsedRef = useRef(false);
  useEffect(() => {
    if (autoParse && initialReplayUrl && !autoParsedRef.current) {
      autoParsedRef.current = true;
      void handleParse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoParse, initialReplayUrl]);

  function swapSides() {
    setSwapped((s) => !s);
    // Keep the winning side consistent: the win follows the side, not the player.
    setWinnerId((prev) =>
      prev === players[0].id ? players[1].id : prev === players[1].id ? players[0].id : prev
    );
  }

  function updatePokemon(
    sideIdx: 0 | 1,
    pokeIdx: number,
    field: keyof PokemonStatInput,
    value: string | number | boolean
  ) {
    setSidePokemon((prev) => {
      if (!prev) return prev;
      const updated = [prev[0], prev[1]] as [PokemonStatInput[], PokemonStatInput[]];
      updated[sideIdx] = [...updated[sideIdx]];
      updated[sideIdx][pokeIdx] = { ...updated[sideIdx][pokeIdx], [field]: value };
      return updated;
    });
  }

  function addPokemon(sideIdx: 0 | 1) {
    setSidePokemon((prev) => {
      if (!prev) return prev;
      const updated = [prev[0], prev[1]] as [PokemonStatInput[], PokemonStatInput[]];
      updated[sideIdx] = [
        ...updated[sideIdx],
        {
          pokemon_name: '',
          kos_dealt: 0,
          was_koed: false,
          was_lead: false,
          was_brought: true,
          moves_used: '',
          turns_active: 0,
        },
      ];
      return updated;
    });
  }

  function removePokemon(sideIdx: 0 | 1, pokeIdx: number) {
    setSidePokemon((prev) => {
      if (!prev) return prev;
      const updated = [prev[0], prev[1]] as [PokemonStatInput[], PokemonStatInput[]];
      updated[sideIdx] = updated[sideIdx].filter((_, i) => i !== pokeIdx);
      return updated;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessKey(null);

    if (!sidePokemon || !psUsernames) return;

    if (!winnerId) {
      setSubmitError({ kind: 'selectWinner' });
      return;
    }

    for (let sideIdx = 0; sideIdx < 2; sideIdx++) {
      const valid = sidePokemon[sideIdx].filter((p) => p.pokemon_name.trim());
      if (valid.length === 0) {
        setSubmitError({ kind: 'needPokemon', name: assignedPlayer(sideIdx as 0 | 1).name });
        return;
      }
    }

    setSubmitting(true);
    try {
      const pokemon_stats = ([0, 1] as const).map((sideIdx) => ({
        player_id: assignedPlayer(sideIdx).id,
        pokemon: sidePokemon[sideIdx]
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
            turns_active: p.turns_active,
          })),
      }));

      const res = await fetch(`/api/admin/matches/${matchId}/replay-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replay_url: replayUrl.trim(),
          winner_id: winnerId,
          pokemon_stats,
        }),
      });
      const json = await res.json();

      if (json.success) {
        setSuccessKey(json.data.bo_reached ? 'importedComplete' : 'importedMore');
        if (redirectTo) {
          setTimeout(() => router.push(redirectTo), 1500);
        } else {
          router.refresh();
        }
      } else {
        const apiError = toApiErrorLike(json);
        setSubmitError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'importFailed' });
      }
    } catch {
      setSubmitError({ kind: 'importFailed' });
    } finally {
      setSubmitting(false);
    }
  }

  const isParsed = Boolean(psUsernames && sidePokemon);

  return (
    <div className="space-y-5">
      {/* Step 1: Replay URL + parse */}
      <form onSubmit={handleParse} className="space-y-3">
        <Input
          label={t('replayImport.urlLabel')}
          type="text"
          value={replayUrl}
          onChange={(e) => handleReplayUrlChange(e.target.value)}
          placeholder="https://replay.pokemonshowdown.com/..."
          disabled={parsing || submitting}
          autoComplete="off"
        />
        {parseError && <Alert variant="error">{errorMessage(parseError)}</Alert>}
        <Button type="submit" variant="secondary" loading={parsing} disabled={submitting}>
          {isParsed ? t('replayImport.reparse') : t('replayImport.parse')}
        </Button>
      </form>

      {/* Step 2: Assign sides + edit + submit */}
      {isParsed && psUsernames && sidePokemon && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <Alert variant="info">
            {t('replayImport.skipNote')}
          </Alert>

          {/* Side → player assignment */}
          <Card variant="outlined" padding="md">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading font-semibold text-sm text-poke-text-primary">
                {t('replayImport.sideAssignment')}
              </h3>
              <Button type="button" variant="ghost" onClick={swapSides} disabled={submitting}>
                {t('replayImport.swapSides')}
              </Button>
            </div>
            <div className="space-y-2 text-sm">
              {([0, 1] as const).map((sideIdx) => (
                <div key={sideIdx} className="flex items-center gap-2">
                  <span className="font-mono text-poke-text-secondary">
                    {psUsernames[sideIdx] || t('replayImport.side', { n: sideIdx + 1 })}
                  </span>
                  <span className="text-poke-text-muted">→</span>
                  <span className="font-heading font-semibold text-poke-text-primary">
                    {assignedPlayer(sideIdx).name}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Winner */}
          <div>
            <label className="block text-sm font-heading font-semibold text-poke-text-primary mb-2">
              {t('common.winner')}
            </label>
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

          {/* Per-side editable stats */}
          {([0, 1] as const).map((sideIdx) => (
            <Card key={sideIdx} variant="outlined" padding="md">
              <h3 className="font-heading font-semibold text-sm text-poke-text-primary mb-3">
                {t('common.pokemonOf', { name: assignedPlayer(sideIdx).name })}{' '}
                <span className="font-mono font-normal text-xs text-poke-text-muted">
                  ({psUsernames[sideIdx]})
                </span>
              </h3>

              <div className="space-y-3">
                {sidePokemon[sideIdx].map((poke, pokeIdx) => (
                  <div key={pokeIdx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <label className="text-[10px] text-poke-text-muted">{t('replayImport.name')}</label>
                      <PokemonAutocomplete
                        value={poke.pokemon_name}
                        onChange={(name) => updatePokemon(sideIdx, pokeIdx, 'pokemon_name', name)}
                        generation={generation}
                        placeholder={t('common.pokemonName')}
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[10px] text-poke-text-muted">{t('common.kos')}</label>
                      <input
                        type="number"
                        min={0}
                        value={poke.kos_dealt}
                        onChange={(e) =>
                          updatePokemon(sideIdx, pokeIdx, 'kos_dealt', parseInt(e.target.value) || 0)
                        }
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="text-[10px] text-poke-text-muted">{t('common.turns')}</label>
                      <input
                        type="number"
                        min={0}
                        value={poke.turns_active}
                        onChange={(e) =>
                          updatePokemon(sideIdx, pokeIdx, 'turns_active', parseInt(e.target.value) || 0)
                        }
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="text-[10px] text-poke-text-muted">{t('replayImport.moves')}</label>
                      <input
                        type="text"
                        value={poke.moves_used}
                        onChange={(e) => updatePokemon(sideIdx, pokeIdx, 'moves_used', e.target.value)}
                        className="w-full px-2 py-1.5 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm"
                        placeholder={t('replayImport.movesPlaceholder')}
                      />
                    </div>
                    <div className="col-span-3 flex gap-3 items-center pb-1.5">
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={poke.was_koed}
                          onChange={(e) => updatePokemon(sideIdx, pokeIdx, 'was_koed', e.target.checked)}
                        />
                        {t('common.koed')}
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={poke.was_lead}
                          onChange={(e) => updatePokemon(sideIdx, pokeIdx, 'was_lead', e.target.checked)}
                        />
                        {t('common.lead')}
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-poke-text-muted">
                        <input
                          type="checkbox"
                          checked={poke.was_brought}
                          onChange={(e) =>
                            updatePokemon(sideIdx, pokeIdx, 'was_brought', e.target.checked)
                          }
                        />
                        {t('common.brought')}
                      </label>
                    </div>
                    <div className="col-span-1 flex items-end pb-1.5">
                      {sidePokemon[sideIdx].length > 1 && (
                        <button
                          type="button"
                          onClick={() => removePokemon(sideIdx, pokeIdx)}
                          className="text-poke-accent text-xs hover:underline"
                          title={t('common.remove')}
                        >
                          &times;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {sidePokemon[sideIdx].length < 6 && (
                <button
                  type="button"
                  onClick={() => addPokemon(sideIdx)}
                  className="mt-2 text-xs text-poke-blue hover:underline font-heading font-semibold"
                >
                  {t('common.addPokemon')}
                </button>
              )}
            </Card>
          ))}

          {submitError && <Alert variant="error">{errorMessage(submitError)}</Alert>}
          {successKey && <Alert variant="success">{t(`replayImport.${successKey}`)}</Alert>}

          <Button type="submit" variant="primary" loading={submitting}>
            {t('replayImport.importGame')}
          </Button>
        </form>
      )}
    </div>
  );
}
