import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { isSuperadminNow } from '@/lib/auth/helpers';
import { requireLiveIdentityOrSignIn, redirectUnregisteredPlayerToDashboard } from '@/lib/auth/redirect-to-sign-in';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { getMatchPrepAnalysis } from '@/lib/supabase/queries/match-prep-analyses';
import { resolveIdOnlyMatchRoute } from '@/lib/league-phase/match-route-owner';
import { getPhaseById, isPlayerPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPlayerPhaseMatchPrep } from '@/lib/supabase/queries/phase-teams';
import { getPhaseMatchPrepAnalysis } from '@/lib/supabase/queries/phase-ai-artifacts';
import { AI_ANALYSIS_STALE_MS } from '@/lib/ai/constants';
import { isValidUuid } from '@/lib/utils/uuid';
import MatchPrepClient from '@/components/match/MatchPrepClient';
import MatchPageBackLink from '@/components/match/MatchPageBackLink';
import MatchVersusHeader from '@/components/match/MatchVersusHeader';
import { getSpeciesNatDex } from '@/lib/pkmn/dex';
import { getT } from '@/i18n/server';
import { resolveContentLocale } from '@/i18n/content-locale';
import { matchAiMessages } from '@/i18n/messages/match/ai';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ mid: string }>;
}

export default async function MatchPrepPage({ params }: PageProps) {
  const { mid } = await params;
  const { player } = await requireLiveIdentityOrSignIn();
  if (!player) redirectUnregisteredPlayerToDashboard();

  // A malformed id is a missing page, not a database error (22P02).
  if (!isValidUuid(mid)) notFound();

  const owner = await resolveIdOnlyMatchRoute(mid.toLowerCase());
  if (!owner) notFound();
  const legacy = owner.kind === 'legacy' ? await getMatchById(mid) : null;
  const native = owner.kind === 'phase' ? await getPhaseMatchById(mid.toLowerCase()) : null;
  if (owner.kind === 'phase' && (native?.id !== mid.toLowerCase() || native.phase_id !== owner.phase_id)) notFound();
  const match = native ?? legacy;
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  if (!isParticipant && !(await isSuperadminNow())) {
    redirect('/dashboard');
  }

  let showScouting = owner.kind === 'legacy';
  let seasonId: string | null | undefined;
  let ruleset: Awaited<ReturnType<typeof getRulesetById>>;
  let prepTeam: Awaited<ReturnType<typeof getMatchPrepTeam>> | Awaited<ReturnType<typeof getPlayerPhaseMatchPrep>>;
  let scoutingAnalysis: Awaited<ReturnType<typeof getMatchPrepAnalysis>>;
  if (owner.kind === 'phase') {
    if (!player.isAdmin && (player.status === 'banned' || player.status === 'suspended')) redirect('/dashboard');
    const isEnrolled = isParticipant && await isPlayerPhaseParticipant(player.playerId, owner.phase_id);
    if (!player.isAdmin && !isEnrolled) redirect('/dashboard');
    showScouting = match.status === 'scheduled' && isEnrolled;
    const phase = await getPhaseById(owner.phase_id);
    if (!phase || phase.id !== owner.phase_id || phase.season_id !== owner.season_id) notFound();
    seasonId = owner.season_id;
    ruleset = await getRulesetById(phase.ruleset_id);
    if (!ruleset || ruleset.id !== phase.ruleset_id) notFound();
    [prepTeam, scoutingAnalysis] = await Promise.all([
      isParticipant ? getPlayerPhaseMatchPrep(match.id, player.playerId) : null,
      showScouting ? getPhaseMatchPrepAnalysis(phase.id, match.id, player.playerId) : null,
    ]);
  } else {
    if (!legacy) notFound();
    const [tournament, storedPrep, storedScouting] = await Promise.all([
      getTournamentById(legacy.tournament_id),
      getMatchPrepTeam(mid, player.playerId),
      match.status === 'scheduled' ? getMatchPrepAnalysis(mid, player.playerId) : null,
    ]);
    seasonId = tournament?.season_id;
    ruleset = tournament ? await getRulesetById(tournament.ruleset_id) : null;
    prepTeam = storedPrep;
    scoutingAnalysis = storedScouting;
  }


  const isP1 = player.playerId === match.player_1_id;
  const opponentName = isP1 ? match.player_2_name : match.player_1_name;

  // The stored scouting report is written in the league's language (i18n-core §6.4).
  const contentLocale =
    match.status === 'scheduled' && scoutingAnalysis
      ? await resolveContentLocale({ seasonId })
      : undefined;

  // The types of the Pokémon the report names, for the type badges on the scouting card: a dex lookup, no read.
  const scouted = match.status === 'scheduled' && scoutingAnalysis?.status === 'completed' ? scoutingAnalysis.analysis : null;
  const scoutedSpecies = scouted
    ? [
        ...(scouted.signature_pokemon ?? []).map((entry) => entry.pokemon),
        ...(scouted.suggested_picks ?? []).map((entry) => entry.pokemon),
      ]
    : [];
  const speciesTypes = Object.fromEntries(
    scoutedSpecies.map((name) => [name, [...(getSpeciesNatDex(name)?.entity.types ?? [])]]),
  );

  const [tAi, tForms] = await Promise.all([getT(matchAiMessages), getT(matchFormsMessages)]);

  return (
    <AuthGuard>
      <div className="flex flex-col gap-6">
        <MatchVersusHeader
          title={tAi('prep.title')}
          status={match.status}
          players={[
            { name: match.player_1_name, avatarUrl: match.player_1_avatar_url },
            { name: match.player_2_name, avatarUrl: match.player_2_avatar_url },
          ]}
          viewerSide={isParticipant ? (isP1 ? 0 : 1) : null}
          meta={
            ruleset?.name ? (
              <span>
                {tAi('prep.format')} <span className="font-[550] text-fg">{ruleset.name}</span>
              </span>
            ) : undefined
          }
          labels={{ versus: tForms('versus.vs'), you: tForms('versus.you'), winner: tForms('versus.winner') }}
        />
        <MatchPrepClient
          matchId={native?.id ?? mid}
          tournamentId={legacy?.tournament_id}
          phaseId={native?.phase_id}
          seasonId={seasonId}
          rulesetId={ruleset?.id}
          rulesetName={ruleset?.name}
          baseFormat={ruleset?.base_format}
          gen={ruleset?.gen}
          opponentName={opponentName}
          initialPokemon={prepTeam?.pokemon}
          scoutingAnalysis={match.status === 'scheduled' ? scoutingAnalysis : null}
          showScouting={showScouting}
          scoutingStaleAfterMs={native ? AI_ANALYSIS_STALE_MS : undefined}
          locked={Boolean(native && (!isParticipant || match.status === 'completed'))}
          hasExistingPrepTeam={!!prepTeam?.pokemon?.length}
          isAdmin={player.isAdmin}
          contentLocale={contentLocale}
          speciesTypes={speciesTypes}
        />

        <MatchPageBackLink label={tForms('common.backToDashboard')} />
      </div>
    </AuthGuard>
  );
}
