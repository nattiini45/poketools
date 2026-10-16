'use client';

import { useState } from 'react';
import Image from 'next/image';
import PokemonSprite from '@/components/shared/PokemonSprite';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { ENABLE_AGENT_MATCH_ANALYSIS } from '@/lib/feature-flags';
import { useDataLocale, useRequestTime, useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsAi, errorsMatches } from '@/i18n/messages/errors';
import { matchAiMessages } from '@/i18n/messages/match/ai';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { MatchPrepAnalysis } from '@/types/game';

const PROF_IMAGE = '/characters/professor-linden.png';
const PROF_SIZE = 56;
const STALE_AFTER_MS = 3 * 60 * 1000;

interface ScoutingReportCardProps {
  analysis: MatchPrepAnalysis | null;
  matchId: string;
  /** True when the user has saved a prep team but the current report was generated without it */
  showRescout?: boolean;
  /** Only admins can repeat scouting (to prevent token waste) */
  isAdmin?: boolean;
  /**
   * Language of the stored report (the league's content language,
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

export default function ScoutingReportCard({
  analysis,
  matchId,
  showRescout,
  isAdmin,
  contentLocale,
}: ScoutingReportCardProps) {
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
        : t(`scouting.${error.kind}`)
    : null;
  const profName = t('profName');
  const species = (name: string) => localizeSpecies(name, dataLocale);

  async function handleGenerate(force = false) {
    setGenerating(true);
    setError(null);
    if (force) setCollapsed(true);

    // Both paths persist a structured report and stream SSE status; the agent
    // path differs only in endpoint + body. On "done" we reload and the server
    // re-reads the persisted `match_prep_analyses` row into the structured card.
    const endpoint = ENABLE_AGENT_MATCH_ANALYSIS
      ? '/api/ai/agent/analyze-match'
      : '/api/ai/match-prep-analysis';
    const body = ENABLE_AGENT_MATCH_ANALYSIS
      ? { match_id: matchId, analysis_type: 'opponent_scout', force }
      : { match_id: matchId, force };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        throw new Error('Request failed');
      }

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
        setError({ kind: 'timedOut' });
        setGenerating(false);
        if (force) setCollapsed(false);
      }
    } catch (err) {
      console.error('[ScoutingReportCard] generate scouting report failed:', err);
      setError({ kind: 'connectFailed' });
      setGenerating(false);
      if (force) setCollapsed(false);
    }
  }

  // ─── No analysis: Show "Scout the Opponent" button ─────────────────
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
                {errorText || t('scouting.askPrompt')}
              </p>
            </div>
          </div>
          <button
            onClick={() => handleGenerate()}
            disabled={generating}
            className={getButtonClasses('ghost', 'md')}
          >
            {generating ? t('scouting.scouting') : error ? t('tryAgain') : t('scouting.scoutOpponent')}
          </button>
        </div>
      </Card>
    );
  }

  // ─── Pending ───────────────────────────────────────────────────────
  // Staleness is judged against the request time (stable across the server
  // render and hydration); a finished report reloads the page anyway.
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
                      {t('scouting.inProgress')}
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
          {isStale && (
            <button
              onClick={() => handleGenerate(true)}
              disabled={generating}
              className={getButtonClasses('ghost', 'md')}
            >
              {generating ? t('scouting.scouting') : t('tryAgain')}
            </button>
          )}
        </div>
      </Card>
    );
  }

  // ─── Failed ────────────────────────────────────────────────────────
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
            onClick={() => handleGenerate(true)}
            disabled={generating}
            className={getButtonClasses('ghost', 'md')}
          >
            {generating ? t('scouting.scouting') : t('tryAgain')}
          </button>
        </div>
      </Card>
    );
  }

  // ─── Regenerating spinner ──────────────────────────────────────────
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
                    {t('scouting.rescoutingNote')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ─── Completed: Full scouting report ───────────────────────────────
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
              {t('scouting.title')}
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

      {/* Expanded content (AI body: shown as written, in the league's language) */}
      {!collapsed && (
        <div className="mt-4 space-y-4">
          {/* Opponent Profile */}
          <p lang={contentLocale} className="text-sm text-poke-text-primary leading-relaxed">
            {content.opponent_profile}
          </p>

          {/* Signature Pokemon */}
          {content.signature_pokemon?.length > 0 && (
            <div>
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
                {t('scouting.signaturePokemon')}
              </h4>
              <div className="space-y-2">
                {content.signature_pokemon.map((sp) => (
                  <div key={sp.pokemon} className="flex items-center gap-3 bg-poke-muted rounded-poke-md p-2">
                    <PokemonSprite name={sp.pokemon} size={40} animated />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-heading font-semibold text-poke-text-primary">
                        {species(sp.pokemon)}
                      </span>
                      <p lang={contentLocale} className="text-xs text-poke-text-muted leading-relaxed">
                        {sp.usage_note}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tendencies */}
          {content.tendencies && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
                {t('scouting.tendencies')}
              </h4>
              <div className="space-y-2">
                {content.tendencies.lead_patterns && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.leads')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.tendencies.lead_patterns}</span>
                  </div>
                )}
                {content.tendencies.play_style && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.playStyle')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.tendencies.play_style}</span>
                  </div>
                )}
                {content.tendencies.favorite_moves && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.notableMoves')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.tendencies.favorite_moves}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meta Positioning */}
          {content.meta_positioning && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
                {t('scouting.metaPositioning')}
              </h4>
              <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed">
                {content.meta_positioning}
              </p>
            </div>
          )}

          {/* Suggested Picks (conditional — only when no user team was provided) */}
          {content.suggested_picks && content.suggested_picks.length > 0 && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
                {t('scouting.suggestedPicks')}
              </h4>
              <div className="space-y-2">
                {content.suggested_picks.map((pick) => (
                  <div key={pick.pokemon} className="flex items-start gap-3 bg-poke-muted rounded-poke-md p-2">
                    <PokemonSprite name={pick.pokemon} size={40} animated />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-heading font-semibold text-poke-text-primary">
                          {species(pick.pokemon)}
                        </span>
                        <Badge variant="green" size="sm">{pick.role}</Badge>
                      </div>
                      <p className="text-xs text-poke-text-secondary mt-0.5 font-mono">
                        {pick.set_summary}
                      </p>
                      <p lang={contentLocale} className="text-xs text-poke-text-muted mt-0.5 leading-relaxed">
                        {pick.reasoning}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matchup Analysis (conditional — only when user team was included) */}
          {content.matchup_analysis && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
                {t('scouting.matchupAnalysis')}
              </h4>
              <div className="space-y-2">
                {content.matchup_analysis.your_advantages && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-green">{t('scouting.yourAdvantages')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.matchup_analysis.your_advantages}</span>
                  </div>
                )}
                {content.matchup_analysis.their_advantages && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-accent">{t('scouting.theirAdvantages')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.matchup_analysis.their_advantages}</span>
                  </div>
                )}
                {content.matchup_analysis.neutral_ground && (
                  <div>
                    <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.neutralGround')} </span>
                    <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.matchup_analysis.neutral_ground}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {content.recommendations && (
            <div className="border-t border-poke-border pt-3">
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
                {t('scouting.recommendations')}
              </h4>

              {/* Threats */}
              {content.recommendations.threats_to_watch?.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-heading font-semibold text-poke-accent">{t('scouting.threats')}</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {content.recommendations.threats_to_watch.map((threat) => (
                      <div key={threat} className="flex items-center gap-1.5 bg-poke-muted rounded-full px-2 py-0.5">
                        <PokemonSprite name={threat} size={20} />
                        <span className="text-xs text-poke-text-secondary">{species(threat)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {content.recommendations.suggested_leads && (
                <div className="mb-2">
                  <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.suggestedLeads')} </span>
                  <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.recommendations.suggested_leads}</span>
                </div>
              )}

              {content.recommendations.coverage_gaps && (
                <div className="mb-2">
                  <span className="text-xs font-heading font-semibold text-poke-text-secondary">{t('scouting.coverageGaps')} </span>
                  <span lang={contentLocale} className="text-xs text-poke-text-muted">{content.recommendations.coverage_gaps}</span>
                </div>
              )}

              {content.recommendations.key_advice && (
                <p lang={contentLocale} className="text-sm text-poke-text-muted leading-relaxed italic mt-2">
                  {content.recommendations.key_advice}
                </p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-poke-border pt-2">
            <span className="text-[10px] text-poke-text-muted italic">
              {t('scouting.disclaimer')}
            </span>
            <div className="flex items-center gap-3">
              {showRescout && !analysis.has_user_team && (
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={generating}
                  className="text-[10px] text-poke-blue hover:underline transition-colors"
                >
                  {generating ? t('scouting.rescouting') : t('scouting.rescoutWithTeam')}
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => handleGenerate(true)}
                  disabled={generating}
                  className="text-[10px] text-poke-text-muted hover:text-poke-blue transition-colors"
                >
                  {generating ? t('scouting.scouting') : t('scouting.repeat')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
