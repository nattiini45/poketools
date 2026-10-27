import Link from 'next/link';
import type { ReactNode } from 'react';
import Section from '@/components/ui/Section';
import DraftPoolManager from '@/components/draft/DraftPoolManager';
import DraftPoolEditor from '@/components/league/DraftPoolEditor';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { draftPoolFormatText } from '@/i18n/content/draft-pool-format';
import { DRAFT_CONFIG_LIMITS } from '@/lib/draft/schemas';
import { isLegacyPlaceholder } from '@/lib/draft-ui/select-pool';
import { epbPack } from '@/lib/format-pack';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getDraftPoolBySeason, getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonGroups } from '@/lib/supabase/queries/season-groups';
import EpbDraftRoomCreate from '../EpbDraftRoomCreate';
import type { LeagueAdminPanelContext } from './context';
import { groupedDraftPanel } from './DraftPanelGroups';

/**
 * Seats a queue draft needs: `draft_start` refuses fewer than the minimum and `draft__validate_seats`
 * (at create) more than the maximum. The SQL holds its own literals; `seat-limits-sql.test.ts` keeps
 * them equal to these.
 */
const MIN_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.min;
const MAX_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.max;

/**
 * Draft tab (draft-like formats only). Classic draft: the draft pool editor and
 * the Draft Room (create form or the active pool). Evolution Point Buy: the
 * Draft Room (create summary, or the active pool plus the control panel link),
 * the Redraft link and the token summary; `TokenAdminSummary` lives on this tab
 * only. Reads: the season's pool; for EPB also the participants (seat check,
 * token rows), the format rules and the pool list (has a Redraft completed).
 *
 * League groups: the league's groups are read first. A league with groups drafts per group and renders
 * `groupedDraftPanel` (one card per group); a league without groups continues below exactly as before.
 */
export async function draftPanel(ctx: LeagueAdminPanelContext) {
  const groups = await getSeasonGroups(ctx.id);
  if (groups.length > 0) return groupedDraftPanel(ctx, groups);
  return ungroupedDraftPanel(ctx);
}

/** The Draft tab of a league without groups (the season's one pool). */
async function ungroupedDraftPanel({ id, league, caps, t, tabLink }: LeagueAdminPanelContext) {
  const isPointBuy = caps.pointBuyList;
  const showTokens = caps.draftTokens || caps.killTokens;
  const needsParticipants = isPointBuy || showTokens;
  const [seasonPool, participants, formatRules, pools, tEnum, tBoard, tGlossary] = await Promise.all([
    getDraftPoolBySeason(id),
    needsParticipants ? getSeasonParticipants(id) : Promise.resolve([]),
    isPointBuy ? getFormatRules(id) : Promise.resolve(null),
    showTokens ? getDraftPoolsBySeason(id) : Promise.resolve([]),
    getT(enumMessages),
    getT(draftLegacyBoardMessages),
    getT(glossaryMessages),
  ]);

  // EPB: an unstarted pre-M2 placeholder pool is not a draft yet; the create form
  // replaces it with the queue-engine initial pool (draft_create_pool).
  const draftPool = seasonPool && isPointBuy && isLegacyPlaceholder(seasonPool) ? null : seasonPool;
  // Only `{ id, name }` crosses into client components (AGENTS.md: never raw players rows).
  const playerRefs = participants.map(toPublicPlayerRef);
  const panelHref = `/admin/leagues/${id}/draft`;
  // The numbers `draft_create_pool` takes when the Initial draft's config names no budget or roster size
  // (format rules, else the format pack's defaults; every EPB season gets a format_rules row at
  // creation, so the SQL fallbacks are never reached); only these reach the client summary.
  const epbDraftDefaults = {
    budget: formatRules?.draft_budget ?? epbPack.defaults.draftBudget,
    rosterSize: formatRules?.draft_picks ?? epbPack.defaults.draftPicks,
    fromFormatRules: formatRules !== null,
  };
  // Token summary (draft-frontend §7.4): the Comeback switch hides once a Redraft has completed.
  const hasRedraft = pools.some((p) => p.kind === 'redraft' && p.phase === 'complete');

  const poolLabels = draftPool
    ? {
        type: draftPoolFormatText(tBoard, draftPool, { pointBuy: isPointBuy }),
        status: enumLabel(tEnum, 'draftPoolStatus', draftPool.status),
      }
    : null;
  const roomLink = (chunks: ReactNode) => (
    <Link href={`/leagues/${id}/draft`} className="text-poke-blue hover:underline">
      {chunks}
    </Link>
  );
  const panelLink = (label: string) => (
    <Link
      href={panelHref}
      className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
    >
      {label}
    </Link>
  );
  const note = (text: ReactNode) => <p className="text-sm text-poke-text-muted">{text}</p>;

  let roomBody: ReactNode;
  if (poolLabels) {
    roomBody = note(t.rich('draftRoom.poolActive', { ...poolLabels, link: roomLink }));
  } else if (!isPointBuy) {
    // Plain draft seasons only (EPB takes the branches below), so `pointBuy` keeps its default `false`.
    roomBody = <DraftPoolManager seasonId={id} seasonName={league.name} />;
  } else if (!league.point_buy_list_id) {
    roomBody = note(t.rich('draftRoom.bindListFirst', { link: tabLink('rules') }));
  } else if (participants.length === 0) {
    // Seats are the participants. With none, the create is refused (SEATS_INVALID) ...
    roomBody = note(t.rich('draftRoom.addParticipantsFirst', { link: tabLink('participants') }));
  } else if (participants.length < MIN_DRAFT_SEATS) {
    // ... with too few, the create works but the start is refused ...
    roomBody = note(
      t.rich('draftRoom.tooFewParticipants', {
        min: MIN_DRAFT_SEATS,
        count: participants.length,
        link: tabLink('participants'),
      }),
    );
  } else if (participants.length > MAX_DRAFT_SEATS) {
    // ... and with too many, the create is refused again.
    roomBody = note(
      t.rich('draftRoom.tooManyParticipants', {
        max: MAX_DRAFT_SEATS,
        count: participants.length,
        link: tabLink('participants'),
      }),
    );
  } else {
    roomBody = <EpbDraftRoomCreate seasonId={id} {...epbDraftDefaults} />;
  }

  return (
    <>
      {caps.genericDraftPool && (
        <Section title={t('draftPool.title')} subtitle={t('draftPool.subtitle')}>
          <DraftPoolEditor seasonId={id} />
        </Section>
      )}

      {/* Every draft format creates its draft here, and only here. */}
      <Section title={t('draftRoom.title')} subtitle={t('draftRoom.subtitle')}>
        <div className="space-y-3">
          {roomBody}
          {isPointBuy && draftPool && (
            <div className="border-t border-poke-border pt-3 space-y-1">
              {panelLink(t('draftRoom.openPanel'))}
              <p className="text-xs text-poke-text-muted">{t('draftRoom.openPanelHint')}</p>
            </div>
          )}
        </div>
      </Section>

      {caps.evolutionRedraft && (
        <Section title={t('redraft.title')} subtitle={t('redraft.subtitle')}>
          <div>{panelLink(t('redraft.openPanel'))}</div>
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
            participants={playerRefs}
            comebackSpendOpen={formatRules?.comeback_spend_open ?? false}
            hasRedraft={hasRedraft}
          />
        </Section>
      )}
    </>
  );
}
