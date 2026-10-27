import Link from 'next/link';
import type { ReactNode } from 'react';
import Section from '@/components/ui/Section';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import DraftPoolEditor from '@/components/league/DraftPoolEditor';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import { getLocale, getT } from '@/i18n/server';
import { LocalTime } from '@/i18n/LocalTime';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { leagueAdminGroupsMessages } from '@/i18n/messages/league-admin/groups';
import { DRAFT_CONFIG_LIMITS } from '@/lib/draft/schemas';
import { epbPack } from '@/lib/format-pack';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getDraftPoolsBySeasonWithGroups } from '@/lib/supabase/queries/drafts';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import type { DraftPhase } from '@/types/draft-queue';
import type { GroupedPoolSummary, SeasonGroupWithMembers } from '@/types/season-group';
import { draftDeletable } from '@/components/draft-admin/admin-view';
import EpbDraftRoomCreate from '../EpbDraftRoomCreate';
import GroupDraftDelete from '../GroupDraftDelete';
import { loadPublishRefusals } from '../../draft/_lib/load';
import { groupDraftGate, type GroupDraftGate } from './DraftGroupGate';
import type { LeagueAdminPanelContext } from './context';

const MIN_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.min;
const MAX_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.max;

const LINK =
  'inline-flex min-h-11 items-center text-sm font-medium text-poke-text-link hover:underline sm:min-h-0';
const NOTE = 'text-sm text-poke-text-muted';
/** Amber, never red (red means "drafted"): a warning the admin acts on. */
const WARNING = 'rounded-poke-md border border-poke-amber-ink px-3 py-2 text-sm text-poke-amber-ink';

/**
 * Draft tab of a league WITH groups (the league groups design: one draft per group). Leagues without groups keep
 * `draftPanel`'s own branch, untouched.
 *
 * Evolution Point Buy: one card per group with its members, its pools (Initial draft, Redraft; phase, control
 * panel and draft room links, "Delete draft" while the Initial draft has not started, the Redraft's
 * "auto-publish refused at" admin line from `publish_refused_at`) and,
 * while it has no Initial draft, the create form behind the seat gates and the completability check. Other formats
 * cannot draft per group (`POST /api/drafts` refuses a legacy pool in a league with groups): the Draft Room says so.
 *
 * Reads (one wave): pools with groups, participants, format rules, the list's lines (only while a group still needs
 * its create form), and the Redraft refusal instants (only for a Redraft in its submission phase).
 */
export async function groupedDraftPanel(
  { id, league, caps, t, tabLink }: LeagueAdminPanelContext,
  groups: readonly SeasonGroupWithMembers[],
): Promise<ReactNode> {
  const isPointBuy = caps.pointBuyList;
  const showTokens = caps.draftTokens || caps.killTokens;
  const [tGroups, tAdmin, tGlossary, locale] = await Promise.all([
    getT(leagueAdminGroupsMessages),
    getT(draftAdminMessages),
    getT(glossaryMessages),
    getLocale(),
  ]);

  const genericPool = caps.genericDraftPool ? (
    <Section title={t('draftPool.title')} subtitle={t('draftPool.subtitle')}>
      <DraftPoolEditor seasonId={id} />
    </Section>
  ) : null;

  if (!isPointBuy) {
    return (
      <>
        {genericPool}
        <Section title={t('draftRoom.title')} subtitle={t('draftRoom.subtitle')}>
          <p className={NOTE}>{tGroups.rich('draft.legacyUnsupported', { link: tabLink('participants') })}</p>
        </Section>
      </>
    );
  }

  const [pools, participants, formatRules] = await Promise.all([
    getDraftPoolsBySeasonWithGroups(id),
    getSeasonParticipants(id),
    getFormatRules(id),
  ]);
  const initialOf = (groupId: string) =>
    pools.find((p) => p.season_group_id === groupId && p.kind === 'initial') ?? null;
  const needsCreate = league.point_buy_list_id !== null && groups.some((g) => initialOf(g.id) === null);
  const [entries, refusals] = await Promise.all([
    needsCreate && league.point_buy_list_id ? getListEntries(league.point_buy_list_id) : Promise.resolve([]),
    loadPublishRefusals(pools),
  ]);

  const budget = formatRules?.draft_budget ?? epbPack.defaults.draftBudget;
  const rosterSize = formatRules?.draft_picks ?? epbPack.defaults.draftPicks;
  const fromFormatRules = formatRules !== null;
  const lines = entries.map((e) => ({ lineId: e.line_id, price: e.price }));
  const placed = new Set(groups.flatMap((g) => g.player_ids));
  const unplaced = participants.filter((p) => !placed.has(p.id)).length;
  const groupName = (name: string) => translateEngineLabel('group', name, locale);
  const phaseText = (phase: DraftPhase) => tAdmin(`panel.phase.${phase}`);

  const gateNote = (gate: Exclude<GroupDraftGate, { kind: 'ready' }>): ReactNode => {
    const link = tabLink('participants');
    switch (gate.kind) {
      case 'empty':
        return <p className={NOTE}>{tGroups.rich('draft.noMembers', { link })}</p>;
      case 'tooFew':
        return <p className={NOTE}>{tGroups.rich('draft.tooFew', { min: MIN_DRAFT_SEATS, count: gate.count, link })}</p>;
      case 'tooMany':
        return <p className={NOTE}>{tGroups.rich('draft.tooMany', { max: MAX_DRAFT_SEATS, count: gate.count, link })}</p>;
      case 'notCompletable':
        return (
          <p role="alert" className={WARNING}>
            {tGroups.rich('draft.notCompletable', {
              lines: gate.totals.lines,
              slots: gate.totals.slots,
              participants: gate.totals.participants,
              link,
            })}
          </p>
        );
      case 'undecided':
        return <p className={WARNING}>{tGroups('draft.undecided')}</p>;
    }
  };

  const poolRow = (pool: GroupedPoolSummary, label: string): ReactNode => {
    const refusedAt = refusals[pool.id];
    return (
      <li key={pool.id} className="space-y-1">
        <p className="text-sm text-poke-text-primary">
          <span className="font-heading font-semibold">{label}</span>
          {' · '}
          <span className="text-poke-text-secondary">{tGroups('draft.poolPhase', { phase: phaseText(pool.phase) })}</span>
        </p>
        {refusedAt ? (
          <div className={WARNING}>
            <p className="font-semibold">
              {tAdmin('redraft.publishRefusedAt')} <LocalTime value={refusedAt} preset="weekdayDateTime" zone="both" />
            </p>
            <p className="text-poke-text-secondary">{tAdmin('redraft.publishRefusedHint')}</p>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href={`/admin/leagues/${id}/draft?pool=${encodeURIComponent(pool.id)}`} className={LINK}>
            {tGroups('draft.openPanel')}
          </Link>
          <Link href={`/leagues/${id}/draft-room?pool=${encodeURIComponent(pool.id)}`} className={LINK}>
            {tGroups('draft.openRoom')}
          </Link>
          {draftDeletable(pool) && pool.season_group_id ? (
            <GroupDraftDelete seasonId={id} poolId={pool.id} seasonGroupId={pool.season_group_id} />
          ) : null}
        </div>
      </li>
    );
  };

  const card = (group: SeasonGroupWithMembers): ReactNode => {
    const groupPools = pools.filter((p) => p.season_group_id === group.id);
    const initial = initialOf(group.id);
    const headingId = `draft-group-${group.id}`;
    let body: ReactNode;
    if (initial) {
      body = (
        <ul className="space-y-3">
          {groupPools.map((pool) =>
            poolRow(pool, pool.kind === 'redraft' ? tGroups('draft.redraft') : tGroups('draft.initial')),
          )}
        </ul>
      );
    } else if (!league.point_buy_list_id) {
      body = <p className={NOTE}>{t.rich('draftRoom.bindListFirst', { link: tabLink('rules') })}</p>;
    } else {
      const gate = groupDraftGate({
        memberCount: group.player_ids.length,
        lines,
        budget,
        rosterSize,
        minSeats: MIN_DRAFT_SEATS,
        maxSeats: MAX_DRAFT_SEATS,
      });
      body =
        gate.kind === 'ready' ? (
          <EpbDraftRoomCreate
            seasonId={id}
            seasonGroupId={group.id}
            seatsLabel={tGroups('draft.seats')}
            budget={budget}
            rosterSize={rosterSize}
            fromFormatRules={fromFormatRules}
          />
        ) : (
          gateNote(gate)
        );
    }
    return (
      <Card key={group.id} variant="outlined" padding="sm" aria-labelledby={headingId} role="group">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id={headingId} className="font-heading text-base font-semibold text-poke-text-primary break-words">
            {groupName(group.name)}
          </h3>
          <Badge variant="default">{tGroups('draft.members', { count: group.player_ids.length })}</Badge>
        </div>
        {body}
      </Card>
    );
  };

  // The Comeback switch hides once every group's Redraft has completed (draft-frontend §7.4, per group).
  const hasRedraft =
    groups.length > 0 &&
    groups.every((g) => pools.some((p) => p.season_group_id === g.id && p.kind === 'redraft' && p.phase === 'complete'));

  return (
    <>
      {genericPool}

      <Section title={t('draftRoom.title')} subtitle={t('draftRoom.subtitle')}>
        <div className="space-y-3">
          <p className={NOTE}>{tGroups('draft.intro')}</p>
          {unplaced > 0 ? (
            <p className={WARNING}>
              {tGroups.rich('draft.unplaced', { count: unplaced, link: tabLink('participants') })}
            </p>
          ) : null}
          <div className="grid gap-3 lg:grid-cols-2">{groups.map(card)}</div>
        </div>
      </Section>

      {caps.evolutionRedraft && (
        <Section title={t('redraft.title')} subtitle={t('redraft.subtitle')}>
          <div>
            <Link href={`/admin/leagues/${id}/draft`} className={LINK}>
              {t('redraft.openPanel')}
            </Link>
          </div>
        </Section>
      )}

      {showTokens && (
        <Section
          title={t('tokens.title')}
          subtitle={t('tokens.subtitle', {
            draftKill: tGlossary('token.draftKill'),
            comeback: tGlossary('token.comeback'),
            cosmo: tGlossary('token.cosmo'),
          })}
        >
          <TokenAdminSummary
            seasonId={id}
            participants={participants.map(toPublicPlayerRef)}
            comebackSpendOpen={formatRules?.comeback_spend_open ?? false}
            hasRedraft={hasRedraft}
          />
        </Section>
      )}
    </>
  );
}
