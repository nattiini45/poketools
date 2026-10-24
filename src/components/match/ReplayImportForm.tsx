'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin, errorsMatches } from '@/i18n/messages/errors';
import { matchFormsMessages } from '@/i18n/messages/match/forms';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import type { ReplayPreviewResult, ParsedPokemonStat } from '@/types/game';

/** A form error: a client-side check (by key) or an API failure. Translated at render. */
type FormError =
  | { kind: 'enterReplayUrl' }
  | { kind: 'parseFailed' }
  | { kind: 'expectedTwo'; count: number }
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
  /** URL to redirect to after a successful import. */
  redirectTo?: string;
}

/** The previewed replay: what the import records (winner and stats are not editable here). */
interface PreviewState {
  psUsernames: [string, string];
  sidePokemon: [ParsedPokemonStat[], ParsedPokemonStat[]];
  /** Index of the side the replay names as the winner, or null when it names none. */
  winnerSide: 0 | 1 | null;
  replayHash: string;
}

/**
 * Admin replay import with manual side assignment (the username gate is skipped).
 *
 * The organizer only assigns the two replay sides to the two match participants. The winner and
 * the stats are the replay's own: the route fetches the
 * replay again, refuses it when it no longer hashes like this preview, and records what it parsed.
 * Corrections afterwards go through the game editor.
 */
export default function ReplayImportForm({
  matchId,
  players,
  initialReplayUrl,
  autoParse,
  redirectTo,
}: ReplayImportFormProps) {
  const router = useRouter();
  const t = useT(matchFormsMessages);
  const dataLocale = useDataLocale();
  const apiErrorText = useApiErrorText(errorsAdmin, errorsMatches);

  const [replayUrl, setReplayUrl] = useState(initialReplayUrl ?? '');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<FormError | null>(null);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [swapped, setSwapped] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<FormError | null>(null);
  const [successKey, setSuccessKey] = useState<'importedComplete' | 'importedMore' | null>(null);

  const parseAbortRef = useRef<AbortController | null>(null);
  // The latest parse request: an older response, or one arriving once an import started, is
  // dropped so the shown side mapping and winner are always the ones the import sends.
  const parseSeqRef = useRef(0);
  const submittingRef = useRef(false);

  function clearParsedPreview() {
    setPreview(null);
    setSwapped(false);
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
    if (submittingRef.current) return;
    setParseError(null);
    setSubmitError(null);
    setSuccessKey(null);

    const url = replayUrl.trim();
    if (!url) {
      setParseError({ kind: 'enterReplayUrl' });
      return;
    }

    setParsing(true);
    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;
    const seq = ++parseSeqRef.current;
    const isStale = () => controller.signal.aborted || seq !== parseSeqRef.current || submittingRef.current;

    try {
      const res = await fetch(`/api/admin/matches/${matchId}/replay-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replay_url: url }),
        signal: controller.signal,
      });
      const json: { success: boolean; data?: ReplayPreviewResult; error?: string } = await res.json();

      if (isStale()) return;

      if (!json.success || !json.data) {
        const apiError = toApiErrorLike(json);
        setParseError(apiError.error || apiError.code ? { kind: 'api', error: apiError } : { kind: 'parseFailed' });
        return;
      }

      const data = json.data;
      const sides = data.parsed.players;
      if (sides.length !== 2) {
        setParseError({ kind: 'expectedTwo', count: sides.length });
        return;
      }

      // Pre-fill the assignment from the best-effort suggestions.
      const sug = data.suggestions;
      const initSwapped =
        sug[0]?.suggested_player_id === players[1].id ||
        sug[1]?.suggested_player_id === players[0].id;

      const winningSideIdx = sides.findIndex((s) => s.ps_username === data.winner_ps_username);

      setPreview({
        psUsernames: [sides[0].ps_username, sides[1].ps_username],
        sidePokemon: [sides[0].pokemon, sides[1].pokemon],
        winnerSide: winningSideIdx === 0 || winningSideIdx === 1 ? winningSideIdx : null,
        replayHash: data.replay_hash,
      });
      setSwapped(initSwapped);
    } catch (err) {
      if (isStale() || (err instanceof DOMException && err.name === 'AbortError')) return;
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSuccessKey(null);

    // Never import while a (re-)parse is in flight: the preview on screen may be about to change.
    if (!preview || preview.winnerSide === null || parseAbortRef.current || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/replay-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          replay_url: replayUrl.trim(),
          replay_hash: preview.replayHash,
          side_player_ids: [assignedPlayer(0).id, assignedPlayer(1).id],
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
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

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
          {preview ? t('replayImport.reparse') : t('replayImport.parse')}
        </Button>
      </form>

      {/* Step 2: Assign sides, review the replay's result, import */}
      {preview && (
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
              <Button type="button" variant="ghost" onClick={() => setSwapped((s) => !s)} disabled={submitting || parsing}>
                {t('replayImport.swapSides')}
              </Button>
            </div>
            <div className="space-y-2 text-sm">
              {([0, 1] as const).map((sideIdx) => (
                <div key={sideIdx} className="flex items-center gap-2">
                  <span className="font-mono text-poke-text-secondary">
                    {preview.psUsernames[sideIdx] || t('replayImport.side', { n: sideIdx + 1 })}
                  </span>
                  <span className="text-poke-text-muted">→</span>
                  <span className="font-heading font-semibold text-poke-text-primary">
                    {assignedPlayer(sideIdx).name}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Winner: the replay's, following the side assignment */}
          {preview.winnerSide === null ? (
            <Alert variant="error">{t('replayImport.noWinner')}</Alert>
          ) : (
            <p className="text-sm font-heading font-semibold text-poke-text-primary">
              {t('replayImport.winnerFromReplay', { name: assignedPlayer(preview.winnerSide).name })}
            </p>
          )}

          {/* Per-side stats, read-only */}
          {([0, 1] as const).map((sideIdx) => (
            <Card key={sideIdx} variant="outlined" padding="md">
              <h3 className="font-heading font-semibold text-sm text-poke-text-primary mb-3">
                {t('common.pokemonOf', { name: assignedPlayer(sideIdx).name })}{' '}
                <span className="font-mono font-normal text-xs text-poke-text-muted">
                  ({preview.psUsernames[sideIdx]})
                </span>
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] text-poke-text-muted">
                      <th className="py-1 pr-2 font-normal">{t('common.pokemonName')}</th>
                      <th className="py-1 pr-2 font-normal">{t('common.kos')}</th>
                      <th className="py-1 pr-2 font-normal">{t('common.turns')}</th>
                      <th className="py-1 pr-2 font-normal">{t('replayImport.moves')}</th>
                      <th className="py-1 pr-2 font-normal">{t('common.koed')}</th>
                      <th className="py-1 pr-2 font-normal">{t('common.lead')}</th>
                      <th className="py-1 font-normal">{t('common.brought')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sidePokemon[sideIdx].map((poke) => (
                      <tr key={poke.pokemon_name} className="border-t border-poke-border text-poke-text-primary">
                        <td className="py-1 pr-2">{localizeSpecies(poke.pokemon_name, dataLocale)}</td>
                        <td className="py-1 pr-2">{poke.kos_dealt}</td>
                        <td className="py-1 pr-2">{poke.turns_active}</td>
                        <td className="py-1 pr-2 text-poke-text-secondary">
                          {poke.moves_used.map((m) => localizeMove(m, dataLocale)).join(', ')}
                        </td>
                        <td className="py-1 pr-2">{poke.was_koed ? '✓' : ''}</td>
                        <td className="py-1 pr-2">{poke.was_lead ? '✓' : ''}</td>
                        <td className="py-1">{poke.was_brought ? '✓' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {submitError && <Alert variant="error">{errorMessage(submitError)}</Alert>}
          {successKey && <Alert variant="success">{t(`replayImport.${successKey}`)}</Alert>}

          <Button type="submit" variant="primary" loading={submitting} disabled={preview.winnerSide === null || parsing}>
            {t('replayImport.importGame')}
          </Button>
        </form>
      )}
    </div>
  );
}
