import Link from 'next/link';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { resolveNextStageTarget } from '@/lib/draft/special-rules';
import { resolveSnapshotEntries } from '@/lib/match/snapshot-lines';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import type { Locale } from '@/i18n/config';
import { matchMessages } from '@/i18n/messages/match';
import type { MatchEvolutionSnapshot } from '@/types/evolution';
import type { PlayerStanding } from '@/types/tournament';
import MatchHighlightCard from '@/components/match/MatchHighlightCard';
import ExportCardButton from '@/components/match/ExportCardButton';
import CreateSocialImageButton from '@/components/match/CreateSocialImageButton';
import MatchEvolutionSummary from '@/components/evolution/MatchEvolutionSummary';
import EpbPokemonRow from '@/components/evolution/EpbPokemonRow';
import MatchEvolutionReplay from '@/components/evolution/MatchEvolutionReplay';
import {
  aggregateTeamFromStats,
  computeQuickStats,
  computePokemonScore,
  computeMatchGamesWon,
} from '@/lib/match/aggregation';
import GameDetailCard from '@/components/match/GameDetailCard';
import MatchAnalysisCard from '@/components/match/MatchAnalysisCard';
import MatchSchedulingPanel from '@/components/match/MatchSchedulingPanel';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { enumLabel } from '@/i18n/content/enum-label';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { enumMessages } from '@/i18n/messages/enums';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import type { MatchStatus } from '@/types/match';
import type { PublicMatch } from '@/lib/match/public-match';
import type { BattleStat, MatchAnalysis } from '@/types/game';
import type { MatchProposalWithPlayers } from '@/types/match-proposal';
import type { PlayerStreaks } from '@/types/streak';
import type { Standing } from '@/lib/tournament/types';
import type { PointBuyListEntry } from '@/types/point-buy';


const STATUS_TONE: Record<MatchStatus, SkewChipTone> = {
  scheduled: 'accent',
  in_progress: 'live',
  pending_confirmation: 'accent',
  completed: 'neutral',
  disputed: 'loss',
};

/** A page section's heading: an item icon and the title in the display role (the frozen card needs no heading). */
function SectionHeading({ icon, children }: { icon: ItemIconId; children: string }) {
  return (
    <div className="flex items-center gap-3">
      <ItemIcon item={icon} size={24} />
      <h2 className="min-w-0 font-heading text-title text-fg">{children}</h2>
    </div>
  );
}


interface MatchDetailProps {
  match: Omit<PublicMatch, 'tournament_id'>;
  competition: { name: string; season_name: string | null; ruleset_name: string; season_format_type?: string | null } | null;
  round: { name: string; best_of: number; deadline: string | null } | null;
  battleStatsByGame: Record<string, BattleStat[]>;
  analysis: MatchAnalysis | null;
  standings: Standing[];
  player1Streaks: PlayerStreaks | null;
  player2Streaks: PlayerStreaks | null;
  back: { href: string; kind: 'tournament' | 'phase' };
  viewerId?: string;
  notes?: string;
  contentLocale?: Locale;
  epb?: { snapshots: MatchEvolutionSnapshot[]; entries: PointBuyListEntry[]; replayViewed: boolean; viewedEndpoint?: string };
  proposals: MatchProposalWithPlayers[];
  nativeConfirmHref?: string;
  nativeSubmitHref?: string;
  nativePrepHref?: string;
  legacyActions?: {
    isSiteAdmin?: boolean;
    canEditGames: boolean;
    gameVersions: ReadonlyMap<string, string>;
  };
}

export default async function MatchDetail({
  match, competition, round, battleStatsByGame, analysis, standings, player1Streaks, player2Streaks,
  back, viewerId, notes, contentLocale, epb, proposals, nativeConfirmHref, nativeSubmitHref, nativePrepHref, legacyActions,
}: MatchDetailProps) {
  function extractStanding(playerId: string): PlayerStanding | null {
    const idx = standings.findIndex((s) => s.player_id === playerId);
    if (idx === -1) return null;
    const s = standings[idx];
    return { rank: idx + 1, wins: s.wins, losses: s.losses, draws: s.draws };
  }
  const player1Standing = extractStanding(match.player_1_id);
  const player2Standing = extractStanding(match.player_2_id);


  const isParticipant = viewerId === match.player_1_id || viewerId === match.player_2_id;
  const canAct = match.status === 'scheduled' || match.status === 'in_progress';
  const canConfirm = match.status === 'pending_confirmation';
  const canEditGames = legacyActions?.canEditGames ?? false;
  const isSiteAdmin = legacyActions?.isSiteAdmin;
  const mid = match.id;
  const canUseLegacyActions = legacyActions !== undefined && (isParticipant || isSiteAdmin);
  const confirmHref = canConfirm ? (canUseLegacyActions ? `/dashboard/confirm/${mid}` : nativeConfirmHref) : undefined;
  const submitHref = canAct ? (canUseLegacyActions ? `/dashboard/submit/${mid}` : nativeSubmitHref) : undefined;
  const prepHref = canAct && isParticipant ? (canUseLegacyActions ? `/dashboard/match-prep/${mid}` : nativePrepHref) : undefined;

  // Pokémon score: sum of surviving (brought but not KO'd) mons across all games
  const { p1Score: score1, p2Score: score2 } = Object.keys(battleStatsByGame).length > 0
    ? computePokemonScore(battleStatsByGame, match.player_1_id, match.player_2_id)
    : { p1Score: 0, p2Score: 0 };
  const player1Team = match.games.length > 0
    ? aggregateTeamFromStats(battleStatsByGame, match.player_1_id, match.winner_id === match.player_1_id)
    : [];
  const player2Team = match.games.length > 0
    ? aggregateTeamFromStats(battleStatsByGame, match.player_2_id, match.winner_id === match.player_2_id)
    : [];
  const quickStats = match.games.length > 0
    ? computeQuickStats(battleStatsByGame, match.player_1_id, match.player_2_id)
    : null;
  const matchGamesWon = computeMatchGamesWon(
    match.games,
    match.player_1_id,
    match.player_2_id,
  );

  const isEpb = isEvolutionPointBuy(competition?.season_format_type ?? '');

  interface EpbRowViewModel {
    snapshot: MatchEvolutionSnapshot;
    nextStageRequirement: number | null;
    nextForm: string | null;
    price: number | null;
  }

  const epbSnapshots = epb?.snapshots ?? [];
  const epbRowModels = new Map<string, EpbRowViewModel>();
  // Per-snapshot animation target for evolutions: the threshold of the
  // stage being crossed (stage_at_match is the pre-evolution stage)
  const epbReplayTargets: Record<string, number> = {};
  const epbNextStageTargets: Record<string, number> = {};
  // Form each evolving line evolved into, keyed by snapshot id
  const epbEvolvedInto: Record<string, string> = {};
  if (epb) {
    // Keyed by line id, never by base: two lines can share a base.
    const entryBySnapshot = resolveSnapshotEntries(epbSnapshots, epb.entries);

    for (const snapshot of epbSnapshots) {
      const entry = entryBySnapshot.get(snapshot.id);
      const target = entry
        ? resolveNextStageTarget(entry, snapshot.stage_at_match)
        : null;
      epbRowModels.set(snapshot.id, {
        snapshot,
        nextStageRequirement: target?.requirement ?? null,
        nextForm: target?.nextForm ?? null,
        price: entry?.price ?? null,
      });
      if (snapshot.evolution_triggered && target) {
        epbReplayTargets[snapshot.id] = target.requirement;
        epbEvolvedInto[snapshot.id] = target.nextForm;
        const postEvolutionTarget = resolveNextStageTarget(entry!, snapshot.stage_at_match + 1);
        if (postEvolutionTarget) {
          epbNextStageTargets[snapshot.id] = postEvolutionTarget.requirement;
        }
      }
    }
  }

  const hasStoredAnalysis = analysis?.status === 'completed';
  const displayAnalysis = analysis ? {
    analysis: analysis.analysis, status: analysis.status, created_at: analysis.created_at,
  } : null;
  const [t, tEnum, viewerLocale, viewerDataLocale] = await Promise.all([
    getT(matchMessages),
    getT(enumMessages),
    getLocale(),
    getDataLocale(),
  ]);

  const highlightProps = {
    player1Name: match.player_1_name,
    player2Name: match.player_2_name,
    player1AvatarUrl: match.player_1_avatar_url,
    player2AvatarUrl: match.player_2_avatar_url,
    player1Standing,
    player2Standing,
    player1Streaks,
    player2Streaks,
    seasonName: competition?.season_name ?? null,
    winnerId: match.winner_id,
    player1Id: match.player_1_id,
    player2Id: match.player_2_id,
    score1,
    score2,
    status: match.status,
    datePlayed: match.date_played,
    tournamentName: competition?.name ?? '',
    formatName: competition?.ruleset_name ?? '',
    roundName: round?.name ?? null,
    player1Team,
    player2Team,
    analysis: displayAnalysis,
    quickStats,
    bestOf: round?.best_of ?? 1,
    games: match.games,
    battleStatsByGame,
    matchGamesWon,
    isEpb,
    aiLang: hasStoredAnalysis ? contentLocale : undefined,
  };
  // The social image is served to every viewer, so it is captured in the
  // league's language: when the admin reads another language, or keeps
  // Pokémon names in another language, the button captures this off-screen
  // copy instead (sent only in that case).
  const socialCopyPrefix = 'match-social';
  const socialCopy =
    isSiteAdmin && contentLocale && (contentLocale !== viewerLocale || contentLocale !== viewerDataLocale) ? (
      <MatchHighlightCard {...highlightProps} idPrefix={socialCopyPrefix} forCapture />
    ) : undefined;

  return (
    <PageContainer
      title={t('detail.heading', { player1: match.player_1_name, player2: match.player_2_name })}
      icon="vs-seeker"
      subtitle={[competition?.season_name, competition?.name, round ? translateEngineLabel('round', round.name, viewerLocale) : null]
        .filter(Boolean)
        .join(' · ')}
      maxWidth="md"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {isSiteAdmin && (
            <CreateSocialImageButton
              targetId="match-highlight-card"
              matchId={mid}
              existingUrl={match.social_image_url}
              contentLocale={contentLocale}
              contentCard={socialCopy}
              contentTargetId={socialCopy ? `${socialCopyPrefix}-highlight-card` : undefined}
            />
          )}
          <ExportCardButton
            targetId="match-highlight-card"
            filename={`match-${match.player_1_name}-vs-${match.player_2_name}.png`.replace(/\s+/g, '-').toLowerCase()}
          />
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SkewChip tone={STATUS_TONE[match.status]} className="text-body">
            {enumLabel(tEnum, 'matchStatus', match.status)}
          </SkewChip>
          <Link
            href={back.href}
            className="inline-flex min-h-6 items-center gap-1 rounded-[3px] text-body font-[550] text-fg-muted hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus max-sm:min-h-11"
          >
            <span aria-hidden="true">←</span> {t(back.kind === 'phase' ? 'detail.backToPhase' : 'detail.backToTournament')}
          </Link>
        </div>
        {/* Participant / Admin actions */}
        {(prepHref || submitHref || confirmHref) && (
          <div className="flex flex-wrap gap-x-4 gap-y-3">
            {prepHref && (
              <Link href={prepHref} className="inline-flex rounded-[3px] text-body">
                <SkewPlate variant="button" tone="secondary">
                  {t('detail.planTeam')}
                </SkewPlate>
              </Link>
            )}
            {submitHref && (
              <Link href={submitHref} className="inline-flex rounded-[3px] text-body">
                <SkewPlate variant="button" tone="primary">
                  {t('detail.submitResult')}
                </SkewPlate>
              </Link>
            )}
            {confirmHref && (
              <Link href={confirmHref} className="inline-flex rounded-[3px] text-body">
                <SkewPlate variant="button" tone="primary">
                  {t('detail.confirmResult')}
                </SkewPlate>
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Match Hero Card */}
      <MatchHighlightCard {...highlightProps} />

      <MatchSchedulingPanel
        matchId={legacyActions ? mid : undefined}
        status={match.status}
        currentPlayerId={legacyActions ? viewerId ?? null : null}
        canManage={!!legacyActions && isParticipant}
        scheduledAt={match.scheduled_at}
        roundDeadline={round?.deadline ?? null}
        initialProposals={proposals}
      />

      {/* ── Evolution Point Buy match summary ─────────────────────── */}
      {isEpb && epbSnapshots.length > 0 && (
        <div className="space-y-3">
          <SectionHeading icon="rare-candy">{t('detail.evolutionSummary')}</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* evolutionPointEarned: some(evolution_triggered) is exact — the
                award in finalize uses the same matchday events, max 1/matchday */}
            <MatchEvolutionSummary
              playerName={match.player_1_name}
              snapshots={epbSnapshots.filter((s) => s.player_id === match.player_1_id)}
              evolutionPointEarned={
                epbSnapshots.some((s) => s.player_id === match.player_1_id && s.evolution_triggered)
              }
              isWinner={match.winner_id === match.player_1_id}
              evolvedInto={epbEvolvedInto}
            />
            <MatchEvolutionSummary
              playerName={match.player_2_name}
              snapshots={epbSnapshots.filter((s) => s.player_id === match.player_2_id)}
              evolutionPointEarned={
                epbSnapshots.some((s) => s.player_id === match.player_2_id && s.evolution_triggered)
              }
              isWinner={match.winner_id === match.player_2_id}
              evolvedInto={epbEvolvedInto}
            />
          </div>

          {/* Crystal XP animation replay — driven by stored snapshots;
              targets resolved server-side per evolution (stage crossed) */}
          <MatchEvolutionReplay
            viewedEndpoint={epb?.viewedEndpoint ?? (legacyActions ? `/api/matches/${mid}/epb-replay-viewed` : undefined)}
            initialViewed={epb?.replayViewed ?? false}
            isAuthenticated={Boolean(viewerId)}
            evolutionSnapshots={epbSnapshots.filter((s) => s.evolution_triggered)}
            targets={epbReplayTargets}
            evolvedInto={epbEvolvedInto}
            nextStageTargets={epbNextStageTargets}
          />

          {/* Per-player evolution rows: brought lines first, bench collapsed */}
          {([match.player_1_id, match.player_2_id] as const).map((pid) => {
            const playerName = pid === match.player_1_id ? match.player_1_name : match.player_2_name;
            const playerModels = epbSnapshots
              .filter((s) => s.player_id === pid)
              .map((s) => epbRowModels.get(s.id))
              .filter((m): m is NonNullable<typeof m> => m !== undefined);
            if (playerModels.length === 0) return null;
            const broughtModels = playerModels.filter((m) => m.snapshot.brought);
            const benchModels = playerModels.filter((m) => !m.snapshot.brought);
            return (
              <Card key={pid} padding="md">
                <h3 className="mb-2 font-heading text-title text-fg">
                  {t('detail.evolutionProgress', { name: playerName })}
                </h3>
                <div className="divide-y">
                  {broughtModels.map((m) => (
                    <EpbPokemonRow
                      key={m.snapshot.id}
                      snapshot={m.snapshot}
                      nextStageRequirement={m.nextStageRequirement}
                      nextForm={m.nextForm}
                      price={m.price}
                    />
                  ))}
                </div>
                {benchModels.length > 0 && (
                  <details className="mt-2">
                    <summary className="flex min-h-6 cursor-pointer items-center text-caption text-fg-muted hover:text-fg max-sm:min-h-11">
                      {t('detail.notBrought', { count: benchModels.length })}
                    </summary>
                    <div className="divide-y opacity-60">
                      {benchModels.map((m) => (
                        <EpbPokemonRow
                          key={m.snapshot.id}
                          snapshot={m.snapshot}
                          nextStageRequirement={m.nextStageRequirement}
                          nextForm={m.nextForm}
                          price={m.price}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Games with full battle detail */}
      {match.games.length > 0 ? (
        <div className="space-y-3">
          <SectionHeading icon="dubious-disc">{t('detail.games')}</SectionHeading>
          {match.games.map((game) => (
            <GameDetailCard
              key={game.id}
              game={game}
              stats={battleStatsByGame[game.id] ?? []}
              player1Id={match.player_1_id}
              player2Id={match.player_2_id}
              player1Name={match.player_1_name}
              player2Name={match.player_2_name}
              defaultCollapsed
              canEdit={canEditGames}
              editVersion={legacyActions?.gameVersions.get(game.id)}
              isSiteAdmin={isSiteAdmin ?? false}
            />
          ))}
        </div>
      ) : (
        <p className="text-body text-fg-muted">{t('detail.noGames')}</p>
      )}

      {/* AI Analysis — show for completed/pending_confirmation matches */}
      {(match.status === 'completed' || match.status === 'pending_confirmation') && (
        <MatchAnalysisCard
          analysis={displayAnalysis}
          matchId={legacyActions ? mid : undefined}
          isAdmin={isSiteAdmin}
          contentLocale={hasStoredAnalysis ? contentLocale : undefined}
        />
      )}

      {/* Notes — admin/dispute data, visible to (live-checked) site admins only */}
      {notes && (
        <div>
          <h2 className="mb-2 font-heading text-title text-fg">{t('detail.notes')}</h2>
          <Card variant="muted" padding="sm">
            <p className="whitespace-pre-wrap text-body text-fg-muted">{notes}</p>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
