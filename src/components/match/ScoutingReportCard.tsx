'use client';

import { useId, useState, type ReactNode } from 'react';
import Image from 'next/image';
import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
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
  /** The opponent the report is about, for the card's title. */
  opponentName?: string;
  /** Types of the Pokémon the report names, by English species name (resolved on the server; none: no badges). */
  speciesTypes?: Record<string, string[]>;
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
      className="shrink-0 rounded-full bg-elevated"
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
  opponentName,
  speciesTypes,
}: ScoutingReportCardProps) {
  const titleId = useId();
  const detailsId = useId();
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

  const SHELL = 'rounded-poke-lg border border-hairline bg-surface';
  const SUBHEAD = 'text-caption font-[550] text-fg-muted';
  const spinner = <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-accent-ink motion-reduce:hidden" />;
  const identity = (line: ReactNode) => (
    <div className="flex min-w-0 items-center gap-3">
      <ProfPortrait alt={profName} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-subtitle font-[550] text-fg">{profName}</span>
          <Badge variant="purple" size="sm">{t('aiBadge')}</Badge>
        </span>
        <span className="flex items-center gap-2 text-body text-fg-muted">{line}</span>
      </div>
    </div>
  );

  // ─── No analysis: Show "Scout the Opponent" button ─────────────────
  if (!analysis) {
    return (
      <div className={cn(SHELL, 'flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5')}>
        {identity(errorText || t('scouting.askPrompt'))}
        <Button variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => handleGenerate()} disabled={generating}>
          {generating ? t('scouting.scouting') : error ? t('tryAgain') : t('scouting.scoutOpponent')}
        </Button>
      </div>
    );
  }

  // ─── Pending ───────────────────────────────────────────────────────
  // Staleness is judged against the request time (stable across the server
  // render and hydration); a finished report reloads the page anyway.
  if (analysis.status === 'pending') {
    const createdAt = new Date(analysis.created_at).getTime();
    const isStale = requestTime - createdAt > STALE_AFTER_MS;

    return (
      <div className={cn(SHELL, 'flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5')}>
        {identity(
          !isStale ? (
            <>
              {spinner}
              {t('scouting.inProgress')}
            </>
          ) : (
            t('takingWhile')
          ),
        )}
        {isStale && (
          <Button variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => handleGenerate(true)} disabled={generating}>
            {generating ? t('scouting.scouting') : t('tryAgain')}
          </Button>
        )}
      </div>
    );
  }

  // ─── Failed ────────────────────────────────────────────────────────
  if (analysis.status === 'failed') {
    return (
      <div className={cn(SHELL, 'flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5')}>
        {identity(errorText || t('unavailable'))}
        <Button variant="secondary" className="min-h-11 sm:min-h-0" onClick={() => handleGenerate(true)} disabled={generating}>
          {generating ? t('scouting.scouting') : t('tryAgain')}
        </Button>
      </div>
    );
  }

  // ─── Regenerating spinner ──────────────────────────────────────────
  if (generating && collapsed) {
    return (
      <div className={cn(SHELL, 'p-4 sm:p-5')}>
        {identity(
          errorText ? (
            errorText
          ) : (
            <>
              {spinner}
              {t('scouting.rescoutingNote')}
            </>
          ),
        )}
      </div>
    );
  }

  // ─── Completed: Full scouting report ───────────────────────────────
  const content = analysis.analysis;
  const signature = content.signature_pokemon ?? [];
  const typesOf = (name: string) => speciesTypes?.[name] ?? [];
  const typeBadges = (name: string) =>
    typesOf(name).length > 0 && (
      <span className="flex flex-wrap gap-1">
        {typesOf(name).map((type) => (
          <TypeBadge key={type} type={type} />
        ))}
      </span>
    );
  /** One labelled line of the report: the label in the viewer's language, the AI text as written. */
  const fact = (label: string, text: string, tone = 'text-fg') => (
    <div className="flex flex-col gap-0.5">
      <dt className={cn('text-caption font-[550]', tone)}>{label}</dt>
      <dd lang={contentLocale} className="text-body text-fg-muted">{text}</dd>
    </div>
  );

  return (
    <section className={SHELL} aria-labelledby={titleId}>
      {/* Header: who scouted whom */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <ProfPortrait alt={profName} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id={titleId} className="font-heading text-title text-fg">
              {opponentName ? t('scouting.titleFor', { name: opponentName }) : t('scouting.title')}
            </h2>
            <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
              {profName}
              <Badge variant="purple" size="sm">{t('aiBadge')}</Badge>
            </span>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11 sm:min-h-0"
          aria-expanded={!collapsed}
          aria-controls={detailsId}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {collapsed ? t('scouting.showDetails') : t('scouting.hideDetails')}
          <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform duration-80 motion-reduce:transition-none', !collapsed && 'rotate-180')} />
        </Button>
      </div>

      {/* The card's face: the opponent's likely picks, always in view */}
      {signature.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-hairline p-4 sm:p-5">
          <h3 className={SUBHEAD}>{t('scouting.likelyPicks')}</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {signature.map((sp) => (
              <li key={sp.pokemon} className="flex items-start gap-3 rounded-poke-md border border-hairline bg-elevated p-3">
                <PokemonSprite name={sp.pokemon} size={56} animated />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="text-subtitle font-[550] text-fg">{species(sp.pokemon)}</span>
                  {typeBadges(sp.pokemon)}
                  {!collapsed && (
                    <p lang={contentLocale} className="text-body text-fg-muted">
                      {sp.usage_note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Expanded content (AI body: shown as written, in the league's language) */}
      {!collapsed && (
        <div id={detailsId} className="flex flex-col gap-5 border-t border-hairline p-4 sm:p-5">
          {/* Opponent Profile */}
          <p lang={contentLocale} className="max-w-[75ch] text-body text-fg">
            {content.opponent_profile}
          </p>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Tendencies */}
            {content.tendencies && (
              <div className="flex flex-col gap-2">
                <h3 className={SUBHEAD}>{t('scouting.tendencies')}</h3>
                <dl className="flex flex-col gap-2">
                  {content.tendencies.lead_patterns && fact(t('scouting.leads'), content.tendencies.lead_patterns)}
                  {content.tendencies.play_style && fact(t('scouting.playStyle'), content.tendencies.play_style)}
                  {content.tendencies.favorite_moves && fact(t('scouting.notableMoves'), content.tendencies.favorite_moves)}
                </dl>
              </div>
            )}

            {/* Matchup Analysis (conditional — only when user team was included) */}
            {content.matchup_analysis && (
              <div className="flex flex-col gap-2">
                <h3 className={SUBHEAD}>{t('scouting.matchupAnalysis')}</h3>
                <dl className="flex flex-col gap-2">
                  {content.matchup_analysis.your_advantages && fact(t('scouting.yourAdvantages'), content.matchup_analysis.your_advantages, 'text-win')}
                  {content.matchup_analysis.their_advantages && fact(t('scouting.theirAdvantages'), content.matchup_analysis.their_advantages, 'text-loss')}
                  {content.matchup_analysis.neutral_ground && fact(t('scouting.neutralGround'), content.matchup_analysis.neutral_ground)}
                </dl>
              </div>
            )}
          </div>

          {/* Meta Positioning */}
          {content.meta_positioning && (
            <div className="flex flex-col gap-1">
              <h3 className={SUBHEAD}>{t('scouting.metaPositioning')}</h3>
              <p lang={contentLocale} className="max-w-[75ch] text-body text-fg-muted">
                {content.meta_positioning}
              </p>
            </div>
          )}

          {/* Suggested Picks (conditional — only when no user team was provided) */}
          {content.suggested_picks && content.suggested_picks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className={SUBHEAD}>{t('scouting.suggestedPicks')}</h3>
              <ul className="grid gap-2 lg:grid-cols-2">
                {content.suggested_picks.map((pick) => (
                  <li key={pick.pokemon} className="flex items-start gap-3 rounded-poke-md border border-hairline bg-elevated p-3">
                    <PokemonSprite name={pick.pokemon} size={56} animated />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-subtitle font-[550] text-fg">{species(pick.pokemon)}</span>
                        <Badge variant="green" size="sm">{pick.role}</Badge>
                      </span>
                      {typeBadges(pick.pokemon)}
                      <p className="font-mono text-caption text-fg [overflow-wrap:anywhere]">{pick.set_summary}</p>
                      <p lang={contentLocale} className="text-body text-fg-muted">
                        {pick.reasoning}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {content.recommendations && (
            <div className="flex flex-col gap-3">
              <h3 className={SUBHEAD}>{t('scouting.recommendations')}</h3>

              {/* Threats */}
              {content.recommendations.threats_to_watch?.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-caption font-[550] text-loss">{t('scouting.threats')}</span>
                  <ul className="flex flex-wrap gap-2">
                    {content.recommendations.threats_to_watch.map((threat) => (
                      <li key={threat} className="flex items-center gap-2 rounded-poke-md border border-hairline bg-elevated py-1 pl-1.5 pr-3">
                        <PokemonSprite name={threat} size={32} />
                        <span className="text-body font-[550] text-fg">{species(threat)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <dl className="grid gap-3 lg:grid-cols-2">
                {content.recommendations.suggested_leads && fact(t('scouting.suggestedLeads'), content.recommendations.suggested_leads)}
                {content.recommendations.coverage_gaps && fact(t('scouting.coverageGaps'), content.recommendations.coverage_gaps)}
              </dl>

              {content.recommendations.key_advice && (
                <p lang={contentLocale} className="max-w-[75ch] rounded-poke-md bg-accent-subtle px-3 py-2 text-body font-[550] text-fg">
                  {content.recommendations.key_advice}
                </p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3">
            <span className="text-micro text-fg-muted">
              {t('scouting.disclaimer')}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {showRescout && !analysis.has_user_team && (
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => handleGenerate(true)} disabled={generating}>
                  {generating ? t('scouting.rescouting') : t('scouting.rescoutWithTeam')}
                </Button>
              )}
              {isAdmin && (
                <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-0" onClick={() => handleGenerate(true)} disabled={generating}>
                  {generating ? t('scouting.scouting') : t('scouting.repeat')}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
