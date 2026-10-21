import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { getSeasonWithDetails, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { getAllTiers, getTierList, getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getTierLimits } from '@/lib/supabase/queries/draft-tier-limits';
import { getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { pointBuyListToDraftPool } from '@/lib/draft/point-buy-pool';
import { isLegacyBoardPool, LEGACY_BOARD_PARAM } from '@/lib/draft-ui/select-pool';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import DraftBoard from '@/components/draft/DraftBoard';
import TierListDisplay from '@/components/draft/TierListDisplay';

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Always fresh — draft is live

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

type PoolRef = { id: string } | null;

/**
 * Server-side boundary map for DraftBoard ('use client'): it renders player
 * names only. Raw participant rows (discord_id, auth_user_id, ban_reason,
 * suspended_until, admin/test flags) never cross into the client payload.
 */
function toDraftBoardPlayerNames(
  participants: ReadonlyArray<{ id: string; name: string }>,
): Record<string, string> {
  const playerNames: Record<string, string> = {};
  for (const participant of participants) {
    playerNames[participant.id] = participant.name;
  }
  return playerNames;
}

/**
 * `/leagues/[id]/draft` — the legacy draft board. Evolution Point Buy leagues
 * draft in the draft room (draft-frontend §8.1), so they are redirected there
 * when the season has a queue-engine pool or no pool yet. An EPB season whose
 * pools all predate migration M2 (`engine = 'legacy'`, e.g. the live EvoLiga
 * initial draft) keeps this board exactly as before the draft room existed:
 * the draft room cannot open a legacy pool. A season with both (legacy
 * initial + queue redraft) redirects too, unless the draft room's link asks
 * for the legacy board (`?board=legacy`). The draft room never redirects
 * back here (it only links), so there is no redirect loop.
 */
export default async function DraftPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [player, league, t] = await Promise.all([
    getSessionPlayer(),
    getSeasonWithDetails(id),
    getT(draftScreenMessages),
  ]);
  if (!league) notFound();

  const isEpb = isEvolutionPointBuy(league.format_type);
  // EPB: the newest legacy-engine pool is this board's pool (pools are oldest first).
  let epbLegacyPool: PoolRef = null;
  if (isEpb) {
    const pools = await getDraftPoolsBySeason(id);
    // An unstarted legacy placeholder counts as "no pool yet" (the draft room explains it).
    const legacy = pools.filter(isLegacyBoardPool);
    const wantsLegacy = query[LEGACY_BOARD_PARAM] === 'legacy';
    if (legacy.length === 0 || (legacy.length < pools.length && !wantsLegacy)) {
      redirect(`/leagues/${id}/draft-room`);
    }
    epbLegacyPool = legacy.at(-1) ?? null;
  }

  // Only draft-format leagues (and legacy EPB drafts) have draft pages
  if (league.format_type !== 'draft' && !isEpb) {
    return (
      <div className="p-8 text-center">
        <p className="text-poke-text-secondary">{t('legacyPage.notDraft')}</p>
      </div>
    );
  }

  const [pool, participants, evoTiers, tierLimits, poolEntries, allTiers] = await Promise.all([
    // A league with groups never has a legacy pool (POST /api/drafts refuses it), so it has no board: null.
    isEpb ? Promise.resolve<PoolRef>(epbLegacyPool) : getInitialPoolForPlayer(id, null),
    getSeasonParticipants(id),
    getTierList(id),
    getTierLimits(id),
    getPoolEntries(id),
    getAllTiers(id),
  ]);

  const isEvoLeague = allTiers.length > 0;
  const playerNames = toDraftBoardPlayerNames(participants);

  // Legacy EPB: the board's pick options derive from the bound point-buy list.
  let epbPoolEntries: typeof poolEntries = [];
  if (isEpb && league.point_buy_list_id) {
    const [pbEntries, trackers] = await Promise.all([
      getListEntries(league.point_buy_list_id),
      getSeasonTrackers(id),
    ]);
    epbPoolEntries = pointBuyListToDraftPool(pbEntries, id, trackers);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('legacyPage.title', { league: league.name })}</h1>
        <p className="text-sm text-poke-text-secondary mt-1">
          {t('legacyPage.participants', { count: league.participant_count })}
          {league.ruleset_name && ` · ${league.ruleset_name}`}
          {isEvoLeague && (
            <span className="ml-2 inline-block px-2 py-0.5 border border-poke-accent/50 bg-poke-accent/10 text-poke-accent rounded-full text-xs font-medium">
              {t('legacyPage.evoLeague')}
            </span>
          )}
        </p>
      </div>

      {/* Tier list reference (always visible in evo-leagues) */}
      {isEvoLeague && evoTiers.length > 0 && (
        <div className="mb-6">
          <details className="border border-poke-border rounded-lg" open={!pool}>
            <summary className="px-4 py-2 text-sm font-medium cursor-pointer hover:bg-poke-elevated">
              {t('legacyPage.tierList', { count: evoTiers.length })}
            </summary>
            <div className="px-4 pb-3 pt-1">
              <TierListDisplay tiers={evoTiers} tierLimits={tierLimits} />
            </div>
          </details>
        </div>
      )}

      {/* Draft not set up yet */}
      {!pool && (
        <div className="p-8 text-center">
          <p className="text-poke-text-secondary">
            {t('legacyPage.notSetUp')}
            {player?.isAdmin && (
              <>
                {' '}
                {t.rich('legacyPage.adminSetUp', {
                  link: (chunks: ReactNode) => (
                    <a href={leagueAdminHref(id, 'draft')} className="text-poke-text-link hover:underline">
                      {chunks}
                    </a>
                  ),
                })}
              </>
            )}
          </p>
        </div>
      )}

      {/* Draft board */}
      {pool && player && (
        <DraftBoard
          poolId={pool.id}
          currentPlayerId={player.playerId}
          isAdmin={player.isAdmin}
          playerNames={playerNames}
          seasonId={id}
          poolEntries={
            isEpb && epbPoolEntries.length > 0
              ? epbPoolEntries
              : poolEntries.length > 0
                ? poolEntries
                : undefined
          }
          evoTiers={isEvoLeague && !isEpb ? evoTiers : undefined}
          tierLimits={tierLimits.length > 0 && !isEpb ? tierLimits : undefined}
          isEpb={isEpb}
        />
      )}

      {pool && !player && (
        <div className="p-8 text-center">
          <p className="text-poke-text-secondary">{t('legacyPage.signIn')}</p>
        </div>
      )}
    </div>
  );
}

