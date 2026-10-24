import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer, isLeagueParticipant } from '@/lib/supabase/queries/season-groups';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getDraftSnapshot, type ViewerContext } from '@/lib/draft/snapshot';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { isQueuePool } from '@/lib/draft-ui/select-pool';
import { isOtherGroupReadOnly, scopePoolsToGroup } from '@/lib/draft-ui/group-pools';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { draftGroupsMessages } from '@/i18n/messages/draft/groups';
import GroupPoolPicker, { type GroupPoolPickerOption } from '@/components/draft-tool/shared/GroupPoolPicker';
import { getLocale, getT } from '@/i18n/server';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import RedraftCenter from '@/components/draft-redraft/RedraftCenter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
  /** `?pool=<id>`: a league with groups opens that group's Redraft (the group switch links here with it). */
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

const LINK = 'text-poke-text-link hover:underline mt-2 inline-block';

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center">{children}</div>;
}

/**
 * `/leagues/[id]/redraft` — the player's redraft page (draft-frontend §3.2).
 *
 * Public page. The latest redraft pool's snapshot seeds the client (no tick
 * during render). The viewer's own drop submission is secret
 * until the deadline: it is fetched client-side from the owner-guarded route
 * (BE #18) and never read or rendered here. Participants cross into the
 * client only inside the snapshot DTO (allowlist mapper); no `players` row
 * is passed.
 *
 * League groups: every group runs its own Redraft. The page opens the
 * viewer's own group's (or the group of `?pool=`), and lists the groups with a
 * Redraft by name to switch. A league without groups renders exactly as before.
 */
export default async function RedraftPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = (await searchParams) ?? {};

  const [player, league, t, locale] = await Promise.all([
    getSessionPlayer(),
    getSeasonWithDetails(id),
    getT(draftRedraftMessages),
    getLocale(),
  ]);
  if (!league) notFound();

  if (!isEvolutionPointBuy(league.format_type)) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.notEpb')}</p>
        <Link href={`/leagues/${id}`} className={LINK}>
          {t('page.backToLeague')}
        </Link>
      </EmptyState>
    );
  }

  const [allPools, isPoolAdmin] = await Promise.all([
    getDraftPoolsBySeasonWithGroups(id),
    player
      ? player.isAdmin ||
        (player.isResourceAdmin && isResourceAdminFor(player.playerId, 'season', id))
      : false,
  ]);
  // Oldest first: the last queue-engine redraft pool is the current one. A
  // legacy (pre-M2) pool is never opened here (POOL_ENGINE_LEGACY).
  const redrafts = allPools.filter((p) => p.kind === 'redraft' && isQueuePool(p));
  // League groups: the viewer's group (one read, only when the league drafts per group and someone is signed in).
  const grouped = redrafts.some((p) => p.season_group_id != null);
  const viewerGroup = grouped && player ? await getSeasonGroupOfPlayer(id, player.playerId) : null;
  const scope = scopePoolsToGroup(redrafts, query.pool, viewerGroup?.id ?? null);
  const pool = scope.pools.at(-1) ?? null;
  if (!pool) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.noRedraft')}</p>
        <Link href={`/leagues/${id}`} className={LINK}>
          {t('page.backToLeague')}
        </Link>
      </EmptyState>
    );
  }

  const listVersionId = league.point_buy_list_id;
  if (!listVersionId) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.noList')}</p>
      </EmptyState>
    );
  }

  const viewer: ViewerContext | null = player ? { playerId: player.playerId, isPoolAdmin } : null;
  const [snapshot, entries] = await Promise.all([
    getDraftSnapshot(pool.id, viewer, { tick: false }).then(
      (result): DraftSnapshotDTO | null => ('unchanged' in result.dto ? null : result.dto),
      (err: unknown) => {
        console.error(`[redraft] snapshot read failed for pool ${pool.id}`, err);
        return null;
      },
    ),
    getListEntries(listVersionId),
  ]);

  // The redraft UI shows line names, prices and flags only; banned moves feed
  // the finder, which this page does not render (one Supabase read saved).
  const catalog = buildLineCatalog(entries, lineThresholdsFromEntries(entries), [], locale);

  // The group switch (leagues with groups only): each group links to its own current Redraft.
  let picker: ReactNode = null;
  if (scope.grouped) {
    const tGroups = await getT(draftGroupsMessages);
    const options = scope.groups.flatMap((group): GroupPoolPickerOption[] => {
      const target = redrafts.filter((p) => p.season_group_id === group.id).at(-1);
      if (!target) return [];
      return [
        {
          groupId: group.id,
          label: translateEngineLabel('group', group.name, locale),
          href: `/leagues/${id}/redraft?pool=${encodeURIComponent(target.id)}`,
          current: group.id === scope.groupId,
          mine: group.id === viewerGroup?.id,
        },
      ];
    });
    const mineHasNoPool = viewerGroup !== null && !scope.groups.some((g) => g.id === viewerGroup.id);
    // Another group's draft is read-only for a trainer of the league, also one in no group (admins act on behalf of
    // anyone; spectators pick nowhere). A trainer in no group costs one roster read (signed-in non-admins only).
    const viewerIsParticipant =
      viewerGroup !== null || (player !== null && !isPoolAdmin && (await isLeagueParticipant(id, player.playerId)));
    const readOnly = isOtherGroupReadOnly({
      shownGroupId: scope.groupId,
      viewerGroupId: viewerGroup?.id ?? null,
      viewerIsParticipant,
      isPoolAdmin,
    });
    picker = (
      <GroupPoolPicker
        options={options}
        labels={{
          nav: tGroups('picker.label'),
          mine: tGroups('picker.mine'),
          showing: tGroups('picker.showing', { group: options.find((o) => o.current)?.label ?? '' }),
          mineHasNoPool: mineHasNoPool ? tGroups('picker.mineHasNoPool') : undefined,
          readOnly: readOnly ? tGroups('picker.readOnly') : undefined,
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
        {picker}
      </div>

      {!player ? (
        <div className="rounded-lg border border-poke-border bg-poke-card p-3 text-sm">
          <p>{t('page.signIn')}</p>
          <Link href="/api/auth/signin" className={LINK}>
            {t('page.signInLink')}
          </Link>
        </div>
      ) : null}

      <RedraftCenter
        key={pool.id}
        seasonId={id}
        poolId={pool.id}
        catalog={catalog}
        initialSnapshot={snapshot}
        viewer={{ playerId: player?.playerId ?? null }}
        links={{ room: `/leagues/${id}/draft-room?pool=${encodeURIComponent(pool.id)}` }}
      />
    </div>
  );
}
