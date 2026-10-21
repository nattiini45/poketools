import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer, isLeagueParticipant } from '@/lib/supabase/queries/season-groups';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getLiveAccess } from '@/lib/auth/helpers';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { resolveViewerWorld, WORLD_OVERRIDE_URL_PARAM } from '@/lib/worlds/registry';
import { getDraftSnapshot, type ViewerContext } from '@/lib/draft/snapshot';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog, hashCatalog } from '@/lib/draft-finder/line-catalog';
import { INDEX_SCHEMA_VERSION } from '@/lib/draft-finder/index-types';
import { legacyBoardHref, selectPool } from '@/lib/draft-ui/select-pool';
import { isOtherGroupReadOnly, scopePoolsToGroup } from '@/lib/draft-ui/group-pools';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { getLocale, getT } from '@/i18n/server';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import { draftGroupsMessages } from '@/i18n/messages/draft/groups';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { DEFAULT_BANNED_MOVES } from '@/types/format-rules';
import WorldShell from '@/components/world/WorldShell';
import WorldOverrideRedirect from '@/components/world/route/WorldOverrideRedirect';
import RedraftPhaseNotice from '@/components/draft-redraft/RedraftPhaseNotice';
import GroupPoolPicker, {
  type GroupPoolPickerLabels,
  type GroupPoolPickerOption,
} from '@/components/draft-tool/shared/GroupPoolPicker';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { isValidUuid } from '@/lib/utils/uuid';
import DraftRoomClient from './client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const LINK = 'text-poke-text-link hover:underline mt-2 inline-block';

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center">{children}</div>;
}

/**
 * `/leagues/[id]/draft-room` — the EPB pick screen (draft-frontend §3.1).
 *
 * Public page: spectators see the server seed; signed-in viewers poll.
 * The viewer, the pool-admin flag and the admin links come from the LIVE
 * access check (`getLiveAccess` + `isResourceAdminFor`, as `gateDraftAdmin`
 * does), never from the up-to-5-minutes-stale session copy: a revoked admin
 * gets no admin snapshot fields and no Admin button on the first paint.
 * Every write route re-checks anyway. Participants cross into the client
 * only inside the snapshot DTO, which the backend builds with an allowlist
 * mapper; no `players` row is passed. The admin sheet's own data (Redraft
 * submissions) loads in the client when its tab opens, never here.
 *
 * Supabase budget (cold): live player (signed-in viewers only), season,
 * pools, resource-admin check (resource admins only), snapshot RPC, list
 * entries, format rules — at most 7; a league with groups adds the signed-in
 * viewer's group (8), and for a signed-in non-admin in no group one roster
 * head count (9: is the viewer a trainer of the league?).
 *
 * League groups: every group drafts its own pools. The room shows the
 * viewer's own group by default (`scopePoolsToGroup`), lists the groups with
 * a draft by name (`GroupPoolPicker`, links with `?pool=`), and anyone, admins
 * included, switches between them (boards are public; lead ruling round 4); a
 * `?pool=` of another group selects that group. Another group's draft is
 * read-only for a trainer of the league (also one in no group): the snapshot seats them nowhere there
 * (no pick controls, every pick route refuses), and the switch says so. A
 * league without groups renders exactly as before.
 */
export default async function DraftRoomPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  // A malformed id is a 404 before any read: Postgres would answer the uuid cast with an error (a 500).
  if (!isValidUuid(id)) notFound();
  const query = await searchParams;

  const [access, league, t, locale] = await Promise.all([
    getLiveAccess(),
    getSeasonWithDetails(id),
    getT(draftScreenMessages),
    getLocale(),
  ]);
  if (!league) notFound();
  // The live player (null when signed out or without a player row). Its roles count only in good standing.
  const player = access?.player ?? null;

  if (!isEvolutionPointBuy(league.format_type)) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.notEpb')}</p>
        <Link href={`/leagues/${id}/draft`} className={LINK}>
          {t('page.standardDraft')}
        </Link>
      </EmptyState>
    );
  }

  // The live admin decision, as `gateDraftAdmin` makes it: a site admin, or an
  // admin with a resource role on this season (one read, in parallel with the pools).
  const resourceAdminCheck = async (): Promise<boolean> => {
    if (!access?.player || access.isSiteAdmin || !access.isAnyAdmin) return false;
    return await isResourceAdminFor(access.player.playerId, 'season', id);
  };
  const [allPools, isResourceAdmin] = await Promise.all([getDraftPoolsBySeasonWithGroups(id), resourceAdminCheck()]);
  const isPoolAdmin = access?.player ? access.isSiteAdmin || isResourceAdmin : false;
  // League groups: the viewer's group (one read, only when the league drafts per group and someone is signed in).
  const grouped = allPools.some((p) => p.season_group_id != null);
  const viewerGroup = grouped && player ? await getSeasonGroupOfPlayer(id, player.playerId) : null;
  const scope = scopePoolsToGroup(allPools, query.pool, viewerGroup?.id ?? null);
  // Queue-engine pools only: a legacy (pre-M2) pool's snapshot raises
  // POOL_ENGINE_LEGACY, so legacy drafts are linked to the legacy board.
  const { pool, reason, legacyPools } = selectPool(scope.pools, query.pool);

  // Legacy-only season: `/leagues/[id]/draft` renders the legacy board for it
  // (it does not redirect here), so this links there and never redirects.
  if (reason === 'legacy_only') {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.legacyOnly')}</p>
        <Link href={legacyBoardHref(id)} className={LINK}>
          {t('page.legacyBoard')}
        </Link>
      </EmptyState>
    );
  }

  // `/leagues/[id]/draft` redirects EPB leagues without a pool here, so the
  // empty states offer no "back to the draft page" link (it would land here).
  if (!pool) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">
          {league.point_buy_list_id ? t('page.noPoolAdmin') : t('page.noPool')}
        </p>
        {league.point_buy_list_id && isPoolAdmin ? (
          <Link href={leagueAdminHref(id, 'draft')} className={LINK}>
            {t('page.goToAdmin')}
          </Link>
        ) : null}
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
  const [snapshot, entries, formatRules] = await Promise.all([
    // The same read as the state route, without the tick (critique B9), so the
    // first paint equals the first poll. A failed read seeds null: the client
    // shows "loading" and polls.
    getDraftSnapshot(pool.id, viewer, { tick: false }).then(
      (result): DraftSnapshotDTO | null => ('unchanged' in result.dto ? null : result.dto),
      (err: unknown) => {
        console.error(`[draft-room] snapshot read failed for pool ${pool.id}`, err);
        return null;
      },
    ),
    getListEntries(listVersionId),
    getFormatRules(id),
  ]);

  const banned = formatRules?.banned_moves?.length ? formatRules.banned_moves : DEFAULT_BANNED_MOVES;
  // Thresholds from the entries already read: the loader would cost two
  // extra reads (query budget, §3.1 step 7).
  const catalog = buildLineCatalog(entries, lineThresholdsFromEntries(entries), banned, locale);
  const indexUrl =
    `/api/point-buy-lists/${encodeURIComponent(listVersionId)}/search-index` +
    `?v=${INDEX_SCHEMA_VERSION}&h=${hashCatalog(entries)}`;

  // Same registry path as the scrollworld and tournament pages, resolved for
  // the VIEWER: `?world=` > admin pin > format auto-map.
  const world = resolveViewerWorld(league, query[WORLD_OVERRIDE_URL_PARAM]);

  // The shown pool's group (admin sheet: "Create Redraft" creates that group's Redraft); null without groups.
  const seasonGroupOf = (poolId: string): { id: string; name: string } | null => {
    const row = allPools.find((p) => p.id === poolId);
    if (!row?.season_group_id) return null;
    return { id: row.season_group_id, name: translateEngineLabel('group', row.season_group_name ?? '', locale) };
  };

  // The group switch (leagues with groups only): each group links to its own default pool.
  let picker: { options: GroupPoolPickerOption[]; labels: GroupPoolPickerLabels } | null = null;
  if (scope.grouped) {
    const tGroups = await getT(draftGroupsMessages);
    const options = scope.groups.flatMap((group): GroupPoolPickerOption[] => {
      const target = selectPool(allPools.filter((p) => p.season_group_id === group.id)).pool;
      if (!target) return [];
      return [
        {
          groupId: group.id,
          label: translateEngineLabel('group', group.name, locale),
          href: `/leagues/${id}/draft-room?pool=${encodeURIComponent(target.id)}`,
          current: group.id === scope.groupId,
          mine: group.id === viewerGroup?.id,
        },
      ];
    });
    const shown = options.find((o) => o.current)?.label ?? '';
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
    picker = {
      options,
      labels: {
        nav: tGroups('picker.label'),
        mine: tGroups('picker.mine'),
        showing: tGroups('picker.showing', { group: shown }),
        mineHasNoPool: mineHasNoPool ? tGroups('picker.mineHasNoPool') : undefined,
        readOnly: readOnly ? tGroups('picker.readOnly') : undefined,
      },
    };
  }

  return (
    <WorldShell world={world}>
      <WorldOverrideRedirect />
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
          <p className="text-sm text-poke-text-secondary mt-1">
            {t('page.subtitle', { count: league.participant_count })}
          </p>
          {legacyPools.some((p) => p.kind === 'initial') ? (
            <p className="text-sm text-poke-text-secondary mt-1">
              {t('page.legacyInitial')}{' '}
              <Link href={legacyBoardHref(id)} className="text-poke-text-link hover:underline">
                {t('page.legacyInitialBoard')}
              </Link>
            </p>
          ) : null}
          {picker ? <GroupPoolPicker options={picker.options} labels={picker.labels} /> : null}
        </div>

        {reason === 'submissions' ? (
          // Before the snapshot seeds (failed read), the pool's own phase stands in.
          <RedraftPhaseNotice
            phase={snapshot?.redraft?.phase ?? 'submissions'}
            deadlineAt={snapshot?.redraft?.deadline_at ?? null}
            links={{ redraft: `/leagues/${id}/redraft` }}
          />
        ) : null}

        <DraftRoomClient
          key={pool.id}
          poolId={pool.id}
          seasonId={id}
          seasonGroup={seasonGroupOf(pool.id)}
          leagueName={league.name}
          catalog={catalog}
          initialSnapshot={snapshot}
          indexUrl={indexUrl}
          viewer={{ playerId: player?.playerId ?? null, isSiteAdmin: access?.isSiteAdmin ?? false }}
          links={{
            redraft: `/leagues/${id}/redraft`,
            tokens: `/leagues/${id}/tokens`,
            admin: isPoolAdmin ? `/admin/leagues/${id}/draft` : null,
            adminAudit: isPoolAdmin ? `/admin/leagues/${id}/draft/audit` : null,
            trainerCreator: '/draft-room/trainer-creator',
          }}
        />
      </div>
    </WorldShell>
  );
}
