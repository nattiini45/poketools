import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatchById, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { listMatchProposals } from '@/lib/supabase/queries/match-proposals';
import { getBattleStatsByMatch, getGamesByMatch } from '@/lib/supabase/queries/games';
import { getMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { getTournamentWithDetails, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { isValidUuid } from '@/lib/utils/uuid';
import { resolveNextStageTarget } from '@/lib/draft/special-rules';
import { resolveSnapshotEntries } from '@/lib/match/snapshot-lines';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { resolveContentLocale } from '@/i18n/content-locale';
import type { Locale } from '@/i18n/config';
import { matchMessages } from '@/i18n/messages/match';
import type { MatchEvolutionSnapshot } from '@/types/evolution';
import type { PlayerStanding } from '@/types/tournament';
import { getLiveAccess, getSessionPlayer } from '@/lib/auth/helpers';
import { hasViewedEpbReplay } from '@/lib/supabase/queries/epb-animation-views';
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
import { getButtonClasses } from '@/components/ui/buttonStyles';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; mid: string }>;
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { id, mid } = await params;
  // A malformed id is a missing page, not a database error: Postgres rejects
  // a non-UUID `id` filter, which used to reach the error boundary.
  if (!isValidUuid(id) || !isValidUuid(mid)) notFound();
  const player = await getSessionPlayer();
  // A signed-in viewer may be a game editor: read the games' versions BEFORE
  // the match and its battle stats. The inline editor sends its game's
  // version back as `expected_updated_at`, so any change after this read
  // (even one landing between the reads below) makes its save answer 409
  // instead of overwriting that change with the older data shown. Anonymous
  // viewers never edit, and the versions reach editors only.
  const gamesAtLoad = player ? await getGamesByMatch(mid) : [];
  const match = await getMatchById(mid);
  // The match must belong to the tournament in the URL, or the page would
  // render under (and link back to) another tournament.
  if (!match || match.tournament_id !== id) notFound();

  const [
    battleStatsByGame,
    analysis,
    tournament,
    round,
    participants,
    matchRecords,
    player1Streaks,
    player2Streaks,
  ] = await Promise.all([
    getBattleStatsByMatch(match.id),
    getMatchAnalysis(match.id),
    getTournamentWithDetails(match.tournament_id),
    getRoundById(match.round_id),
    getParticipants(match.tournament_id),
    getCompletedMatchRecords(match.tournament_id),
    getPlayerStreaks(match.player_1_id),
    getPlayerStreaks(match.player_2_id),
  ]);

  // Compute tournament standings and extract each player's rank + W/L
  // (format-aware: EPB seasons use the evolution-points tiebreaker chain)
  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  for (const p of participants) participantNames[p.id] = p.name;
  const standings = await computeStandingsForSeason(
    tournament?.season_id ?? null, participantIds, participantNames, matchRecords
  );

  function extractStanding(playerId: string): PlayerStanding | null {
    const idx = standings.findIndex((s) => s.player_id === playerId);
    if (idx === -1) return null;
    const s = standings[idx];
    return { rank: idx + 1, wins: s.wins, losses: s.losses, draws: s.draws };
  }
  const player1Standing = extractStanding(match.player_1_id);
  const player2Standing = extractStanding(match.player_2_id);

  const isParticipant = player
    ? player.playerId === match.player_1_id || player.playerId === match.player_2_id
    : false;
  const canAct = match.status === 'scheduled' || match.status === 'in_progress';
  const canConfirm = match.status === 'pending_confirmation';
  const initialProposals = isParticipant ? await listMatchProposals(match.id) : [];

  // Edit access mirrors PATCH /api/admin/games/[id]: site admins + per-tournament
  // resource admins. Resolved server-side so the Edit button only renders for
  // viewers the backend will actually authorize.
  const canEditGames = player
    ? player.isAdmin ||
      (await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id))
    : false;
  const gameVersions: ReadonlyMap<string, string> = canEditGames
    ? new Map(gamesAtLoad.map((g) => [g.id, g.updated_at]))
    : new Map();

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

  // ── Evolution Point Buy data (conditional on format) ─────────────
  // season_format_type rides along on the tournament join — no extra
  // query for non-EPB matches
  const isEpb = isEvolutionPointBuy(tournament?.season_format_type ?? '');

  interface EpbRowViewModel {
    snapshot: MatchEvolutionSnapshot;
    nextStageRequirement: number | null;
    nextForm: string | null;
    price: number | null;
  }

  let epbSnapshots: MatchEvolutionSnapshot[] = [];
  const epbRowModels = new Map<string, EpbRowViewModel>();
  // Per-snapshot animation target for evolutions: the threshold of the
  // stage being crossed (stage_at_match is the pre-evolution stage)
  const epbReplayTargets: Record<string, number> = {};
  const epbNextStageTargets: Record<string, number> = {};
  // Form each evolving line evolved into, keyed by snapshot id
  const epbEvolvedInto: Record<string, string> = {};
  let epbReplayViewed = false;

  if (isEpb && tournament?.season_id) {
    const [snapshots, season] = await Promise.all([
      getMatchSnapshots(match.id),
      getSeasonById(tournament.season_id),
    ]);
    epbSnapshots = snapshots;

    const entries = season?.point_buy_list_id
      ? await getListEntries(season.point_buy_list_id)
      : [];
    // Keyed by line id, never by base: two lines can share a base.
    const entryBySnapshot = resolveSnapshotEntries(epbSnapshots, entries);

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

    if (player?.playerId) {
      epbReplayViewed = await hasViewedEpbReplay(player.playerId, match.id);
    }
  }

  // The admin notes (dispute log) are admin-only data: gate them on the live
  // role read (`getLiveAccess`, AGENTS.md D37), never on the session copy,
  // which can be up to 5 minutes stale. Read only when the match has notes
  // and the viewer is signed in, so an anonymous view or a match without
  // notes costs no extra query. A failed read rethrows (fail closed).
  const showAdminNotes =
    match.notes && player ? (await getLiveAccess())?.isSiteAdmin === true : false;

  // The league's content language (seasons.language, i18n-core §6.3/§6.4):
  // the language the stored AI analysis was written in and the one the social
  // image is captured in. One narrow read, only when something uses it (a
  // stored analysis, or the admin's social-image button); standalone
  // tournaments use the default without a read.
  const hasStoredAnalysis = analysis?.status === 'completed';
  const contentLocale: Locale | undefined =
    hasStoredAnalysis || player?.isAdmin
      ? await resolveContentLocale({ seasonId: tournament?.season_id })
      : undefined;
  const [t, viewerLocale, viewerDataLocale] = await Promise.all([
    getT(matchMessages),
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
    seasonName: tournament?.season_name ?? null,
    winnerId: match.winner_id,
    player1Id: match.player_1_id,
    player2Id: match.player_2_id,
    score1,
    score2,
    status: match.status,
    datePlayed: match.date_played,
    tournamentName: tournament?.name ?? '',
    formatName: tournament?.ruleset_name ?? '',
    roundName: round?.name ?? null,
    player1Team,
    player2Team,
    analysis,
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
    player?.isAdmin && contentLocale && (contentLocale !== viewerLocale || contentLocale !== viewerDataLocale) ? (
      <MatchHighlightCard {...highlightProps} idPrefix={socialCopyPrefix} forCapture />
    ) : undefined;

  return (
    <PageContainer
      title={t('detail.title')}
      maxWidth="md"
      action={
        <div className="flex items-center gap-2">
          {player?.isAdmin && (
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
      {/* Match Hero Card */}
      <MatchHighlightCard {...highlightProps} />

      <MatchSchedulingPanel
        matchId={match.id}
        status={match.status}
        currentPlayerId={player?.playerId ?? null}
        canManage={isParticipant}
        scheduledAt={match.scheduled_at}
        roundDeadline={round?.deadline ?? null}
        initialProposals={initialProposals}
      />

      {/* ── Evolution Point Buy match summary ─────────────────────── */}
      {isEpb && epbSnapshots.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-heading font-medium text-poke-text-secondary">
            {t('detail.evolutionSummary')}
          </h3>
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
            matchId={match.id}
            initialViewed={epbReplayViewed}
            isAuthenticated={Boolean(player?.playerId)}
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
                <h4 className="mb-2 text-sm font-heading font-semibold text-poke-text-primary">
                  {t('detail.evolutionProgress', { name: playerName })}
                </h4>
                <div className="divide-y divide-poke-border/50">
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
                    <summary className="cursor-pointer text-xs text-poke-text-muted hover:text-poke-text-secondary">
                      {t('detail.notBrought', { count: benchModels.length })}
                    </summary>
                    <div className="divide-y divide-poke-border/50 opacity-60">
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

      {/* Participant / Admin actions */}
      {(isParticipant || player?.isAdmin) && (canAct || canConfirm) && (
        <div className="flex gap-3">
          {canAct && (
            <>
              {isParticipant && (
                <Link
                  href={`/dashboard/match-prep/${mid}`}
                  className={getButtonClasses('ghost', 'md')}
                >
                  {t('detail.planTeam')}
                </Link>
              )}
              <Link
                href={`/dashboard/submit/${mid}`}
                className={getButtonClasses('secondary', 'md')}
              >
                {t('detail.submitResult')}
              </Link>
            </>
          )}
          {canConfirm && (
            <Link
              href={`/dashboard/confirm/${mid}`}
              className={getButtonClasses('success', 'md')}
            >
              {t('detail.confirmResult')}
            </Link>
          )}
        </div>
      )}

      {/* Games with full battle detail */}
      {match.games.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-sm font-heading font-medium text-poke-text-secondary">{t('detail.games')}</h3>
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
              editVersion={gameVersions.get(game.id)}
              isSiteAdmin={player?.isAdmin ?? false}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-poke-text-muted">{t('detail.noGames')}</p>
      )}

      {/* AI Analysis — show for completed/pending_confirmation matches */}
      {(match.status === 'completed' || match.status === 'pending_confirmation') && (
        <MatchAnalysisCard
          analysis={analysis}
          matchId={match.id}
          isAdmin={player?.isAdmin}
          contentLocale={hasStoredAnalysis ? contentLocale : undefined}
        />
      )}

      {/* Notes — admin/dispute data, visible to (live-checked) site admins only */}
      {showAdminNotes && (
        <div>
          <h3 className="text-sm font-heading font-medium text-poke-text-secondary mb-1">{t('detail.notes')}</h3>
          <Card variant="muted" padding="sm">
            <p className="text-sm text-poke-text-muted">{match.notes}</p>
          </Card>
        </div>
      )}

      <Link
        href={`/tournaments/${id}`}
        className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
      >
        &larr; {t('detail.backToTournament')}
      </Link>
    </PageContainer>
  );
}
