'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Section from '@/components/ui/Section';
import SkewChip from '@/components/ui/SkewChip';
import { ArrowRight, Check } from 'lucide-react';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAdmin, errorsMatches, errorsStats } from '@/i18n/messages/errors';
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

const FLAG_ICON = 'inline-block size-4 text-fg';

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
  const apiErrorText = useApiErrorText(errorsAdmin, errorsMatches, errorsStats);

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
    <div className="flex flex-col gap-6">
      {/* Step 1: Replay URL + parse */}
      <form onSubmit={handleParse} className="flex flex-col items-start gap-3 rounded-poke-lg border border-hairline bg-surface p-5">
        <div className="w-full">
        <Input
          label={t('replayImport.urlLabel')}
          type="text"
          value={replayUrl}
          onChange={(e) => handleReplayUrlChange(e.target.value)}
          placeholder="https://replay.pokemonshowdown.com/..."
          disabled={parsing || submitting}
          autoComplete="off"
        />
        </div>
        {parseError && <Alert variant="error">{errorMessage(parseError)}</Alert>}
        <Button type="submit" variant={preview ? 'secondary' : 'primary'} loading={parsing} disabled={submitting} className="max-sm:min-h-11">
          {preview ? t('replayImport.reparse') : t('replayImport.parse')}
        </Button>
      </form>

      {/* Step 2: Assign sides, review the replay's result, import */}
      {preview && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <Alert variant="info">
            {t('replayImport.skipNote')}
          </Alert>

          {/* Side → player assignment */}
          <Section title={t('replayImport.sideAssignment')} icon="vs-seeker">
            <div className="flex flex-col items-start gap-2 text-body">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSwapped((s) => !s)} disabled={submitting || parsing} className="mb-1 max-sm:min-h-11">
                {t('replayImport.swapSides')}
              </Button>
              {([0, 1] as const).map((sideIdx) => (
                <div key={sideIdx} className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-fg-muted">
                    {preview.psUsernames[sideIdx] || t('replayImport.side', { n: sideIdx + 1 })}
                  </span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                  <span className="font-[550] text-fg">{assignedPlayer(sideIdx).name}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Winner: the replay's, following the side assignment */}
          {preview.winnerSide === null ? (
            <Alert variant="error">{t('replayImport.noWinner')}</Alert>
          ) : (
            <p className="self-start">
              <SkewChip tone="win" className="px-3 py-1 text-body">
                {t('replayImport.winnerFromReplay', { name: assignedPlayer(preview.winnerSide).name })}
              </SkewChip>
            </p>
          )}

          {/* Per-side stats, read-only */}
          {([0, 1] as const).map((sideIdx) => (
            <Section
              key={sideIdx}
              title={t('common.pokemonOf', { name: assignedPlayer(sideIdx).name })}
              subtitle={preview.psUsernames[sideIdx]}
              icon="poke-ball"
            >
              <div className="-mx-5 -my-5 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-body">
                  <thead>
                    <tr className="bg-elevated text-caption text-fg-muted">
                      <th scope="col" className="px-5 py-2 font-[550]">{t('common.pokemonName')}</th>
                      <th scope="col" className="px-2 py-2 text-right font-[550]">{t('common.kos')}</th>
                      <th scope="col" className="px-2 py-2 text-right font-[550]">{t('common.turns')}</th>
                      <th scope="col" className="px-2 py-2 font-[550]">{t('replayImport.moves')}</th>
                      <th scope="col" className="px-2 py-2 text-center font-[550]">{t('common.koed')}</th>
                      <th scope="col" className="px-2 py-2 text-center font-[550]">{t('common.lead')}</th>
                      <th scope="col" className="py-2 pl-2 pr-5 text-center font-[550]">{t('common.brought')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {preview.sidePokemon[sideIdx].map((poke) => (
                      <tr key={poke.pokemon_name} className="text-fg">
                        <td className="px-5 py-2 font-[550]">{localizeSpecies(poke.pokemon_name, dataLocale)}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{poke.kos_dealt}</td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">{poke.turns_active}</td>
                        <td className="px-2 py-2 text-fg-muted">
                          {poke.moves_used.map((m) => localizeMove(m, dataLocale)).join(', ')}
                        </td>
                        <td className="px-2 py-2 text-center">{poke.was_koed ? <Check aria-label={t('common.koed')} className={FLAG_ICON} /> : ''}</td>
                        <td className="px-2 py-2 text-center">{poke.was_lead ? <Check aria-label={t('common.lead')} className={FLAG_ICON} /> : ''}</td>
                        <td className="py-2 pl-2 pr-5 text-center">{poke.was_brought ? <Check aria-label={t('common.brought')} className={FLAG_ICON} /> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ))}

          {submitError && <Alert variant="error">{errorMessage(submitError)}</Alert>}
          {successKey && <Alert variant="success">{t(`replayImport.${successKey}`)}</Alert>}

          <Button type="submit" variant="primary" loading={submitting} disabled={preview.winnerSide === null || parsing} className="self-start max-sm:min-h-11">
            {t('replayImport.importGame')}
          </Button>
        </form>
      )}
    </div>
  );
}
