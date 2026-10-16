import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import Section from '@/components/ui/Section';
import { getSession, isAdmin } from '@/lib/auth/helpers';
import { getSeasonWithDetails, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import { getDraftPoolBySeason, getDraftPoolsBySeason } from '@/lib/supabase/queries/drafts';
import { isLegacyPlaceholder } from '@/lib/draft-ui/select-pool';
import { getFormatCapabilities } from '@/lib/season/format-capabilities';
import { isDraftLike } from '@/lib/season/format-utils';
import { toPublicPlayerRef } from '@/lib/players/public-player';
import LeagueRosterManager from '@/components/league/LeagueRosterManager';
import CoreLigaManager from '@/components/league/CoreLigaManager';
import PhaseTimeline from '@/components/league/PhaseTimeline';
import ResourceAdminManager from '@/components/shared/ResourceAdminManager';
import ArchiveButton from '@/components/shared/ArchiveButton';
import DeleteResourceButton from '@/components/shared/DeleteResourceButton';
import LeagueStatusControl from '@/components/league/LeagueStatusControl';
import LeagueThemeControl from '@/components/league/LeagueThemeControl';
import LeagueTestFlagControl from '@/components/league/LeagueTestFlagControl';
import Badge from '@/components/ui/Badge';
import EditableDescription from '@/components/shared/EditableDescription';
import EvolutionTierEditor from '@/components/league/EvolutionTierEditor';
import DraftTierLimitsEditor from '@/components/league/DraftTierLimitsEditor';
import DraftPoolManager from '@/components/draft/DraftPoolManager';
import DraftPoolEditor from '@/components/league/DraftPoolEditor';
import PointBuyListManager from '@/components/league/PointBuyListManager';
import FormatRulesEditor from '@/components/league/FormatRulesEditor';
import AdminPendingTrades from '@/components/league/AdminPendingTrades';
import EpbImportPanel from '@/components/league/EpbImportPanel';
import EvolutionPointRecalcButton from '@/components/league/EvolutionPointRecalcButton';
import TokenAdminSummary from '@/components/draft-admin/TokenAdminSummary';
import PhaseGate from '@/components/ui/PhaseGate';
import { getEpbPhaseStatus } from '@/lib/season/epb-phase';
import { DRAFT_CONFIG_LIMITS } from '@/lib/draft/schemas';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { epbPack } from '@/lib/format-pack';
import { getPendingTradeRequestsForSeason } from '@/lib/supabase/queries/redraft-trade-requests';
import { getT } from '@/i18n/server';
import { DEFAULT_CONTENT_LOCALE } from '@/i18n/config';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { draftPoolFormatText } from '@/i18n/content/draft-pool-format';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import ContentLanguageControl from './_components/ContentLanguageControl';
import EpbDraftRoomCreate from './_components/EpbDraftRoomCreate';

export const dynamic = 'force-dynamic';

/**
 * Seats a queue draft needs: `draft_start` refuses fewer than the minimum and `draft__validate_seats`
 * (at create) more than the maximum. The SQL holds its own literals; `seat-limits-sql.test.ts` keeps
 * them equal to these.
 */
const MIN_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.min;
const MAX_DRAFT_SEATS = DRAFT_CONFIG_LIMITS.participant_order.max;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminLeagueDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [league, rulesets, session, participants, t, tEnum, tGlossary, tBoard] = await Promise.all([
    getSeasonWithDetails(id),
    listRulesets(),
    getSession(),
    getSeasonParticipants(id),
    getT(leagueAdminSeasonPageMessages),
    getT(enumMessages),
    getT(glossaryMessages),
    getT(draftLegacyBoardMessages),
  ]);

  if (!league) notFound();

  const isSiteAdmin = isAdmin(session);
  const caps = getFormatCapabilities(league.format_type);
  const hasDraftRoom = isDraftLike(league.format_type);
  // Only `{ id, name }` crosses into client components (AGENTS.md: never raw players rows).
  const playerRefs = participants.map(toPublicPlayerRef);
  const panelHref = `/admin/leagues/${id}/draft`;

  // Fetch the pool for every draft-like format — EPB needs the pool row for
  // its Draft Room even though pick options derive from the point-buy list
  const seasonPool = hasDraftRoom ? await getDraftPoolBySeason(id) : null;
  // EPB: an unstarted pre-M2 placeholder pool is not a draft yet; the create form
  // replaces it with the queue-engine initial pool (draft_create_pool).
  const draftPool = seasonPool && caps.pointBuyList && isLegacyPlaceholder(seasonPool) ? null : seasonPool;

  const epbPhase = caps.pointBuyList ? await getEpbPhaseStatus(id) : null;
  const formatRules = caps.pointBuyList ? await getFormatRules(id) : null;
  // The numbers `draft_create_pool` takes when the Initial draft is created without a config
  // (format rules, else the format pack's defaults; every EPB season gets a format_rules row at
  // creation, so the SQL fallbacks are never reached); only these reach the client summary.
  const epbDraftDefaults = {
    budget: formatRules?.draft_budget ?? epbPack.defaults.draftBudget,
    rosterSize: formatRules?.draft_picks ?? epbPack.defaults.draftPicks,
    fromFormatRules: formatRules !== null,
  };
  // Token summary (draft-frontend §7.4): the Comeback switch hides once a Redraft has completed.
  const showTokens = caps.draftTokens || caps.killTokens;
  const pools = showTokens ? await getDraftPoolsBySeason(id) : [];
  const hasRedraft = pools.some((p) => p.kind === 'redraft' && p.phase === 'complete');

  // Admin pending-trades status (EPB only). Fetch all pending requests for the
  // season and resolve player display names from the already-loaded
  // participants. Passed to AdminPendingTrades for consent badges + cancel.
  const pendingTrades = caps.evolutionRedraft ? await getPendingTradeRequestsForSeason(id) : [];
  const adminNameMap = new Map(participants.map((p) => [p.id, p.name]));
  const pendingTradeViews = pendingTrades.map((req) => ({
    requestId: req.id,
    playerAName: adminNameMap.get(req.player_a_id) ?? t('unknownPlayer'),
    playerBName: adminNameMap.get(req.player_b_id) ?? t('unknownPlayer'),
    lineA: req.line_a,
    lineB: req.line_b,
    consentA: req.consent_a,
    consentB: req.consent_b,
    createdAt: req.created_at,
  }));

  const format = enumLabel(tEnum, 'formatType', league.format_type);
  const baseSubtitle = league.ruleset_name
    ? t('header.subtitleWithRuleset', { format, ruleset: league.ruleset_name })
    : t('header.subtitle', { format });
  const subtitle = league.archived ? t('header.archived', { subtitle: baseSubtitle }) : baseSubtitle;

  const poolLabels = draftPool
    ? {
        type: draftPoolFormatText(tBoard, draftPool, { pointBuy: caps.pointBuyList }),
        status: enumLabel(tEnum, 'draftPoolStatus', draftPool.status),
      }
    : null;
  const roomLink = (chunks: ReactNode) => (
    <Link href={`/leagues/${id}/draft`} className="text-poke-blue hover:underline">
      {chunks}
    </Link>
  );
  const panelLink = (label: string) => (
    <Link href={panelHref} className="text-sm font-medium text-poke-blue hover:underline">
      {label}
    </Link>
  );

  return (
    <AdminGuard>
      <PageContainer
        title={league.name}
        subtitle={subtitle}
        maxWidth="lg"
        action={
          <div className="flex items-center gap-3">
            {league.is_test_season && <Badge variant="yellow">{t('header.testBadge')}</Badge>}
            <LeagueStatusControl seasonId={id} currentStatus={league.status} />
            <ArchiveButton resourceType="season" resourceId={id} isArchived={league.archived} />
            {isSiteAdmin && (
              <DeleteResourceButton
                resourceType="season"
                resourceId={id}
                resourceName={league.name}
                redirectTo="/admin/leagues"
              />
            )}
          </div>
        }
      >
        <Section title={t('description.title')} subtitle={t('description.subtitle')} collapsible defaultCollapsed>
          <EditableDescription resourceType="season" resourceId={id} initialValue={league.description} />
        </Section>

        <Section title={t('theme.title')} subtitle={t('theme.subtitle')} collapsible defaultCollapsed>
          <LeagueThemeControl seasonId={id} currentTheme={league.route_theme} />
        </Section>

        <Section title={t('language.title')} subtitle={t('language.subtitle')} collapsible defaultCollapsed>
          <ContentLanguageControl seasonId={id} currentLanguage={league.language ?? DEFAULT_CONTENT_LOCALE} />
        </Section>

        {isSiteAdmin && (
          <Section
            title={t('testLeague.title')}
            subtitle={t('testLeague.subtitle')}
            collapsible
            defaultCollapsed={!league.is_test_season}
          >
            <LeagueTestFlagControl seasonId={id} isTestSeason={league.is_test_season} />
          </Section>
        )}

        <Section title={t('participants.title')} collapsible defaultCollapsed>
          <LeagueRosterManager
            seasonId={id}
            showTypeSelector={caps.participantTypeAssignment}
            leagueState={{ status: league.status, archived: league.archived }}
          />
        </Section>

        {caps.typeCores && (
          <Section title={t('typeCores.title')} subtitle={t('typeCores.subtitle')} collapsible defaultCollapsed>
            <CoreLigaManager seasonId={id} />
          </Section>
        )}

        {caps.evolutionTiers && (
          <Section title={t('evolutionTiers.title')} subtitle={t('evolutionTiers.subtitle')} collapsible>
            <EvolutionTierEditor seasonId={id} participants={playerRefs} />
          </Section>
        )}

        {caps.genericDraftPool && (
          <Section title={t('draftPool.title')} subtitle={t('draftPool.subtitle')} collapsible>
            <DraftPoolEditor seasonId={id} />
          </Section>
        )}

        {caps.tierLimits && (
          <Section title={t('draftSettings.title')} subtitle={t('draftSettings.subtitle')} collapsible>
            <DraftTierLimitsEditor seasonId={id} />
          </Section>
        )}

        {caps.pointBuyList && (
          <Section title={t('pointBuyList.title')} subtitle={t('pointBuyList.subtitle')} collapsible>
            <PointBuyListManager seasonId={id} currentListId={league.point_buy_list_id} />
          </Section>
        )}

        {caps.pointBuyList && (
          <Section
            title={t('formatRules.title')}
            subtitle={t('formatRules.subtitle', { token: tGlossary('token.draftKill') })}
            collapsible
          >
            <FormatRulesEditor seasonId={id} />
          </Section>
        )}

        {/* Every draft format creates its draft here, and only here; the section opens while there is none yet. */}
        {hasDraftRoom && (
          <Section
            title={t('draftRoom.title')}
            subtitle={t('draftRoom.subtitle')}
            collapsible
            defaultCollapsed={draftPool !== null}
          >
            <div className="space-y-3">
              {poolLabels ? (
                <p className="text-sm text-poke-text-muted">
                  {t.rich('draftRoom.poolActive', { ...poolLabels, link: roomLink })}
                </p>
              ) : caps.pointBuyList ? (
                !league.point_buy_list_id ? (
                  <p className="text-sm text-poke-text-muted">{t('draftRoom.bindListFirst')}</p>
                ) : participants.length === 0 ? (
                  // Seats are the participants. With none, the create is refused (SEATS_INVALID) ...
                  <p className="text-sm text-poke-text-muted">{t('draftRoom.addParticipantsFirst')}</p>
                ) : participants.length < MIN_DRAFT_SEATS ? (
                  // ... with too few, the create works but the start is refused ...
                  <p className="text-sm text-poke-text-muted">
                    {t('draftRoom.tooFewParticipants', { min: MIN_DRAFT_SEATS, count: participants.length })}
                  </p>
                ) : participants.length > MAX_DRAFT_SEATS ? (
                  // ... and with too many, the create is refused again.
                  <p className="text-sm text-poke-text-muted">
                    {t('draftRoom.tooManyParticipants', { max: MAX_DRAFT_SEATS, count: participants.length })}
                  </p>
                ) : (
                  <EpbDraftRoomCreate seasonId={id} {...epbDraftDefaults} />
                )
              ) : (
                // Plain draft seasons only (EPB takes the branch above), so `pointBuy` keeps its default `false`.
                <DraftPoolManager seasonId={id} seasonName={league.name} />
              )}
              {caps.pointBuyList && draftPool && (
                <div className="border-t border-poke-border pt-3 space-y-1">
                  {panelLink(t('draftRoom.openPanel'))}
                  <p className="text-xs text-poke-text-muted">{t('draftRoom.openPanelHint')}</p>
                </div>
              )}
            </div>
          </Section>
        )}

        {caps.pointBuyList && (
          <Section title={t('dataImport.title')} subtitle={t('dataImport.subtitle')} collapsible defaultCollapsed>
            <EpbImportPanel seasonId={id} seasonName={league.name} />
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
            collapsible
            defaultCollapsed
          >
            <TokenAdminSummary
              seasonId={id}
              participants={playerRefs}
              comebackSpendOpen={formatRules?.comeback_spend_open ?? false}
              hasRedraft={hasRedraft}
            />
          </Section>
        )}

        {caps.evolutionPoints && (
          <Section
            title={t('evolutionPoints.title')}
            subtitle={t('evolutionPoints.subtitle')}
            collapsible
            defaultCollapsed
          >
            <EvolutionPointRecalcButton seasonId={id} />
          </Section>
        )}

        {caps.evolutionRedraft && (
          <Section title={t('redraft.title')} subtitle={t('redraft.subtitle')} collapsible defaultCollapsed>
            <div className="mb-4">{panelLink(t('redraft.openPanel'))}</div>
            <PhaseGate active={epbPhase?.hinrunde_complete ?? false} pendingMessage={t('redraft.pending')}>
              <div className="border-t border-poke-border pt-4">
                <p className="text-sm font-medium mb-2">{t('redraft.pendingTrades')}</p>
                <AdminPendingTrades seasonId={id} requests={pendingTradeViews} />
              </div>
            </PhaseGate>
          </Section>
        )}

        <Section title={t('phases.title')} collapsible>
          <PhaseTimeline seasonId={id} rulesets={rulesets} canDelete={isSiteAdmin} />
        </Section>

        {isSiteAdmin && (
          <Section title={t('leagueAdmins.title')} subtitle={t('leagueAdmins.subtitle')} collapsible>
            <ResourceAdminManager resourceType="season" resourceId={id} />
          </Section>
        )}
      </PageContainer>
    </AdminGuard>
  );
}
