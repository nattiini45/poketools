import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import { getSession, isSuperadmin } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { resolveEffectiveRuleset } from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { getMatchPrepAnalysis } from '@/lib/supabase/queries/match-prep-analyses';
import { isValidUuid } from '@/lib/utils/uuid';
import MatchPrepClient from '@/components/match/MatchPrepClient';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { resolveContentLocale } from '@/i18n/content-locale';
import { matchMessages } from '@/i18n/messages/match';
import { matchAiMessages } from '@/i18n/messages/match/ai';
import { matchFormsMessages } from '@/i18n/messages/match/forms';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ mid: string }>;
}

export default async function MatchPrepPage({ params }: PageProps) {
  const { mid } = await params;
  const session = await getSession();
  const player = session?.player;
  if (!player) redirect('/');

  // A malformed id is a missing page, not a database error (22P02).
  if (!isValidUuid(mid)) notFound();

  const match = await getMatchById(mid);
  if (!match) notFound();

  const isParticipant =
    player.playerId === match.player_1_id ||
    player.playerId === match.player_2_id;

  // Only match participants and the superadmin can view prep — regular admins cannot
  if (!isParticipant && !isSuperadmin(session)) {
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

  // Resolve the EFFECTIVE league ruleset (upgrades a base-tier id to the league's
  // custom ruleset where one exists), so the displayed format and the ruleset id
  // forwarded to the agent are the real league rules — not the base tier, which
  // carries none of the type-quota / NFE / custom-ban constraints.
  const season = tournament?.season_id
    ? await getSeasonById(tournament.season_id)
    : null;
  const resolved = tournament
    ? await resolveEffectiveRuleset({
        tournamentRulesetId: tournament.ruleset_id,
        tournamentBracketType: tournament.bracket_type,
        season: season
          ? {
              id: season.id,
              name: season.name,
              rulesetId: season.ruleset_id,
              formatType: season.format_type,
            }
          : null,
      })
    : null;
  const ruleset = resolved?.ruleset ?? null;

  const isP1 = player.playerId === match.player_1_id;
  const opponentName = isP1 ? match.player_2_name : match.player_1_name;

  // The stored scouting report is written in the league's language (i18n-core §6.4).
  const contentLocale =
    match.status === 'scheduled' && scoutingAnalysis
      ? await resolveContentLocale({ seasonId: tournament?.season_id })
      : undefined;

  const [t, tAi, tForms] = await Promise.all([getT(matchMessages), getT(matchAiMessages), getT(matchFormsMessages)]);

  return (
    <AuthGuard>
      <PageContainer
        title={tAi('prep.title')}
        subtitle={t('versusTitle', { p1: match.player_1_name, p2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="full"
      >
        <MatchPrepClient
          matchId={mid}
          rulesetId={ruleset?.id}
          rulesetName={ruleset?.name}
          baseFormat={ruleset?.base_format}
          opponentName={opponentName}
          initialPokemon={prepTeam?.pokemon}
          scoutingAnalysis={match.status === 'scheduled' ? scoutingAnalysis : null}
          hasExistingPrepTeam={!!prepTeam?.pokemon?.length}
          isAdmin={player.isAdmin}
          contentLocale={contentLocale}
        />

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          &larr; {tForms('common.backToDashboard')}
        </Link>
      </PageContainer>
    </AuthGuard>
  );
}
