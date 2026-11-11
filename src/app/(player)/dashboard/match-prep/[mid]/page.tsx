import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { isSuperadminNow } from '@/lib/auth/helpers';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { getMatchPrepAnalysis } from '@/lib/supabase/queries/match-prep-analyses';
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
  if (!player) redirect('/');

  // A malformed id is a missing page, not a database error (22P02).
  if (!isValidUuid(mid)) notFound();

  const match = await getMatchById(mid);
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  // Only match participants and the superadmin can view prep — regular admins cannot
  if (!isParticipant && !(await isSuperadminNow())) {
    redirect('/dashboard');
  }

  // Every read here fails loudly (AGENTS.md rule 5): a failed prep-team, season or ruleset
  // read reaches the error boundary instead of rendering an empty prep form or no ruleset.
  const [tournament, prepTeam, scoutingAnalysis] = await Promise.all([
    getTournamentById(match.tournament_id),
    getMatchPrepTeam(mid, player.playerId),
    // Only fetch scouting for scheduled matches
    match.status === 'scheduled'
      ? getMatchPrepAnalysis(mid, player.playerId)
      : Promise.resolve(null),
  ]);

  // The phase's own pin (an immutable ruleset version): the displayed format and the ruleset id forwarded to the
  // agent are the real league rules.
  const ruleset = tournament ? await getRulesetById(tournament.ruleset_id) : null;

  const isP1 = player.playerId === match.player_1_id;
  const opponentName = isP1 ? match.player_2_name : match.player_1_name;

  // The stored scouting report is written in the league's language (i18n-core §6.4).
  const contentLocale =
    match.status === 'scheduled' && scoutingAnalysis
      ? await resolveContentLocale({ seasonId: tournament?.season_id })
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
          matchId={mid}
          tournamentId={match.tournament_id}
          seasonId={tournament?.season_id}
          rulesetId={ruleset?.id}
          rulesetName={ruleset?.name}
          baseFormat={ruleset?.base_format}
          gen={ruleset?.gen}
          opponentName={opponentName}
          initialPokemon={prepTeam?.pokemon}
          scoutingAnalysis={match.status === 'scheduled' ? scoutingAnalysis : null}
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
