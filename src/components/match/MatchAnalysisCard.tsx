'use client';

import { useState } from 'react';
import Image from 'next/image';
import PokemonSprite from '@/components/shared/PokemonSprite';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import TypeBadge from '@/components/shared/TypeBadge';
import { ENABLE_AGENT_POST_MATCH } from '@/lib/feature-flags';
import { useDataLocale, useRequestTime, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAi, errorsMatches } from '@/i18n/messages/errors';
import { matchAiMessages } from '@/i18n/messages/match/ai';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchAnalysis } from '@/types/game';

const PROF_IMAGE = '/characters/professor-linden.png';
const PROF_SIZE = 56;
const STALE_AFTER_MS = 3 * 60 * 1000;

interface MatchAnalysisCardProps {
  analysis: MatchAnalysis | null;
  matchId: string;
  isAdmin?: boolean;
  player1Name?: string;
  player2Name?: string;
  player1GymType?: string | null;
  player2GymType?: string | null;
  /**
   * Language of the stored analysis (the league's content language,
   * i18n-core §6.4). The AI body is shown as written, marked with `lang`;
   * only the card's chrome follows the viewer.
   */
  contentLocale?: Locale;
}

/** A generation error: a client-side state (by key) or the stream's failure frame. Translated at render. */
type GenerateError =
  | { kind: 'failed' }
  | { kind: 'timedOut' }
  | { kind: 'connectFailed' }
  | { kind: 'api'; error: ApiErrorLike };

function ProfPortrait({ alt }: { alt: string }) {
  return (
    <Image
      src={PROF_IMAGE}
      alt={alt}
      width={PROF_SIZE}
      height={PROF_SIZE}
      className="rounded-full shrink-0"
      unoptimized
    />
  );
}

export default function MatchAnalysisCard({
  analysis,
  matchId,
  isAdmin,
  player1Name,
  player2Name,
  player1GymType,
  player2GymType,
  contentLocale,
}: MatchAnalysisCardProps) {
  const t = useT(matchAiMessages);
  const dataLocale = useDataLocale();
  const requestTime = useRequestTime();
  const apiErrorText = useApiErrorText(errorsAi, errorsMatches);
  const [collapsed, setCollapsed] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<GenerateError | null>(null);

  const errorText = error
    ? error.kind === 'api'
      ? apiErrorText(error.error)
      : error.kind === 'connectFailed'
        ? t('connectFailed')
        : t(`analysis.${error.kind}`)
    : null;
  const profName = t('profName');

  async function handleGenerate(id: string, force = false) {
    setGenerating(true);
    setError(null);
    // Collapse to pending state so old analysis disappears immediately
    if (force) setCollapsed(true);

    // Both routes emit the same SSE status protocol and persist the structured
    // analysis, so the reload-on-done flow is identical — only the endpoint and
    // body differ. The agent route is gated behind ENABLE_AGENT_POST_MATCH.
    const endpoint = ENABLE_AGENT_POST_MATCH
      ? '/api/ai/agent/analyze-match'
      : '/api/ai/match-analysis';
    const body = ENABLE_AGENT_POST_MATCH
      ? { match_id: id, analysis_type: 'post_match', force }
      : { match_id: id, force };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error('Request failed');
      }

      // Read the SSE stream to detect done vs failed
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let lastStatus = '';
      let lastError = '';
      let lastCode = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.status) lastStatus = parsed.status;
              if (parsed.error) lastError = parsed.error;
              if (typeof parsed.code === 'string') lastCode = parsed.code;
            } catch { /* ignore malformed SSE lines */ }
          }
        }
      }

      if (lastStatus === 'done') {
        window.location.reload();
      } else if (lastStatus === 'failed') {
        setError(
          lastError || lastCode
            ? { kind: 'api', error: { error: lastError || null, code: lastCode || null } }
            : { kind: 'failed' },
        );
        setGenerating(false);
        if (force) setCollapsed(false);
      } else {
        // Stream ended without a terminal status — likely a timeout
        setError({ kind: 'timedOut' });
        setGenerating(false);
        if (force) setCollapsed(false);
      }
    } catch (err) {
      console.error('[MatchAnalysisCard] generate analysis failed:', err);
      setError({ kind: 'connectFailed' });
      setGenerating(false);
      if (force) setCollapsed(false);
    }
  }

  // No analysis yet — show "Ask the Prof" button
  if (!analysis) {
    return (
      <Card variant="outlined" padding="md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProfPortrait alt={profName} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-heading font-semibold text-poke-text-secondary">
                  {profName}
                </span>
                <Badge variant="purple" size="sm">{t('aiBadge')}</Badge>
              </div>
              <p className="text-xs text-poke-text-muted mt-0.5">
                {errorText || t('analysis.askPrompt')}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleGenerate(matchId)}
            disabled={generating}
            className={getButtonClasses('ghost', 'md')}
          >
            {generating ? t('analysis.consulting') : error ? t('tryAgain') : t('analysis.askProf')}
          </button>
        </div>
      </Card>
    );
  }

  // Pending state — show spinner with retry option for admins or after staleness.
  // Staleness is judged against the request time (stable across the server
  // render and hydration); a finished analysis reloads the page anyway.
  if (analysis.status === 'pending') {
    const createdAt = new Date(analysis.created_at).getTime();
    const isStale = requestTime - createdAt > STALE_AFTER_MS;

    return (
      <Card variant="outlined" padding="md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProfPortrait alt={profName} />
            <div>
              <span className="text-sm font-heading font-semibold text-poke-text-secondary">
                {profName}
              </span>
              <div className="flex items-center gap-2 mt-1">
                {!isStale ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
                    <span className="text-xs text-poke-text-muted">
                      {t('analysis.reviewing')}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-poke-text-muted">
                    {t('takingWhile')}
                  </span>
                )}
              </div>
            </div>
          </div>
          {(isAdmin || isStale) && (
            <button
              onClick={() => handleGenerate(analysis.match_id, true)}
              disabled={generating}
              className={getButtonClasses('ghost', 'md')}
            >
              {generating ? t('analysis.consulting') : t('analysis.askAgain')}
            </button>
          )}
        </div>
      </Card>
    );
  }

  // Failed state — anyone can retry
  if (analysis.status === 'failed') {
    return (
      <Card variant="outlined" padding="md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProfPortrait alt={profName} />
            <div>
              <span className="text-sm text-poke-text-muted">
                {errorText || t('unavailable')}
              </span>
            </div>
          </div>
          <button
            onClick={() => handleGenerate(analysis.match_id, true)}
            disabled={generating}
            className={getButtonClasses('ghost', 'md')}
          >
            {generating ? t('analysis.consulting') : t('analysis.askAgain')}
          </button>
        </div>
      </Card>
    );
  }

  // Regenerating — show pending spinner instead of stale content
  if (generating && collapsed) {
    return (
      <Card variant="outlined" padding="md">
        <div className="flex items-center gap-3">
          <ProfPortrait alt={profName} />
          <div>
            <span className="text-sm font-heading font-semibold text-poke-text-secondary">
              {profName}
            </span>
            <div className="flex items-center gap-2 mt-1">
              {errorText ? (
                <span className="text-xs text-poke-text-muted">{errorText}</span>
              ) : (
                <>
                  <div className="w-3 h-3 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
                  <span className="text-xs text-poke-text-muted">
                    {t('analysis.reviewing')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  const content = analysis.analysis;

  return (
    <Card variant="outlined" padding="md" className="space-y-0">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-3">
          <ProfPortrait alt={profName} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-heading font-semibold text-poke-text-secondary">
                {profName}
              </span>
              <Badge variant="purple" size="sm">{t('aiBadge')}</Badge>
            </div>
            <p className="text-xs text-poke-text-muted mt-0.5">
              {t('analysis.title')}
            </p>
          </div>
        </div>
        <span
          className="text-poke-text-muted text-sm transition-transform duration-200"
          style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)' }}
        >
          ▾
        </span>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="mt-4 space-y-4">
          {/* Summary (AI body: shown as written, in the league's language) */}
          <p lang={contentLocale} className="text-sm text-poke-text-primary leading-relaxed">
            {content.summary}
          </p>

          {/* Gym Type Context Strip */}
          {(player1GymType || player2GymType) && (
            <div className="flex items-center gap-3 flex-wrap">
              {player1GymType && player1Name && (
                <span className="inline-flex items-center gap-1.5 text-xs text-poke-text-secondary">
                  <span className="font-semibold">{player1Name}</span>
                  <TypeBadge type={player1GymType} />
                </span>
              )}
              {player2GymType && player2Name && (
                <span className="inline-flex items-center gap-1.5 text-xs text-poke-text-secondary">
                  <span className="font-semibold">{player2Name}</span>
                  <TypeBadge type={player2GymType} />
                </span>
              )}
            </div>
          )}

          {/* MVP Card */}
          {content.mvp?.pokemon && (
            <div className="flex items-start gap-3 bg-poke-muted rounded-poke-md p-3">
              <PokemonSprite name={content.mvp.pokemon} size={48} animated />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="yellow" size="sm">{t('analysis.mvp')}</Badge>
                  <span className="text-sm font-heading font-semibold text-poke-text-primary">
                    {localizeSpecies(content.mvp.pokemon, dataLocale)}
                  </span>
                  {content.mvp.player && (
                    <span className="text-xs text-poke-text-muted">
                      ({content.mvp.player})
                    </span>
                  )}
                </div>
                <p lang={contentLocale} className="text-xs text-poke-text-muted mt-1 leading-relaxed">
                  {content.mvp.reasoning}
                </p>
              </div>
            </div>
          )}

          {/* Turning Point */}
          {content.turning_point && (
            <div>
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
                {t('analysis.turningPoint')}
              </h4>
              <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed">
                {content.turning_point}
              </p>
            </div>
          )}

          {/* Game Breakdowns */}
          {content.game_breakdowns?.length > 0 && (
            <div className="space-y-3">
              {content.game_breakdowns.map((gb) => (
                <div key={gb.game_number} className="border-t border-poke-border pt-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-heading font-semibold text-poke-text-secondary">
                      {t('analysis.game', { n: gb.game_number })}
                    </span>
                    {gb.winner && (
                      <span className="text-xs text-poke-green font-medium">
                        {t('analysis.winner', { name: gb.winner })}
                      </span>
                    )}
                  </div>
                  <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed">
                    {gb.narrative}
                  </p>
                  {gb.key_plays?.length > 0 && (
                    <ul lang={contentLocale} className="mt-1.5 space-y-0.5">
                      {gb.key_plays.map((play, i) => (
                        <li key={i} className="text-xs text-poke-text-muted flex gap-1.5">
                          <span className="text-poke-blue shrink-0">•</span>
                          <span>{play}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Meta Observations */}
          {content.meta_observations && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
                {t('analysis.metaObservations')}
              </h4>
              <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed">
                {content.meta_observations}
              </p>
            </div>
          )}

          {/* League / Type Constraint Matchup (gym typing or assigned core) */}
          {(content.league_constraint_analysis ?? content.gym_type_analysis) && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
                {t('analysis.leagueMatchup')}
              </h4>
              <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed">
                {content.league_constraint_analysis ?? content.gym_type_analysis}
              </p>
            </div>
          )}

          {/* What If — Professor's Hindsight */}
          {content.what_if && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
                {t('analysis.hindsight')}
              </h4>
              <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed italic">
                {content.what_if}
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-poke-border pt-2">
            <span className="text-[10px] text-poke-text-muted italic">
              {t('analysis.disclaimer')}
            </span>
            {isAdmin && (
              <button
                onClick={() => handleGenerate(analysis.match_id, true)}
                disabled={generating}
                className="text-[10px] text-poke-text-muted hover:text-poke-blue transition-colors"
              >
                {generating ? t('analysis.consulting') : t('analysis.askAgain')}
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
