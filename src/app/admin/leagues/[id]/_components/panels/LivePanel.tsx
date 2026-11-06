import Section from '@/components/ui/Section';
import ActionsOverview from '@/components/format-runtime/admin/ActionsOverview';
import AdjustmentHistory from '@/components/format-runtime/admin/AdjustmentHistory';
import AdjustmentsPanel from '@/components/format-runtime/admin/AdjustmentsPanel';
import AdminLadders, { type AdminLadderPhase } from '@/components/format-runtime/admin/AdminLadders';
import ChecksInbox from '@/components/format-runtime/admin/ChecksInbox';
import DomainsSummary from '@/components/format-runtime/admin/DomainsSummary';
import RelationsAdmin from '@/components/format-runtime/admin/RelationsAdmin';
import { PAGE_SIZE } from '@/components/format-runtime/admin/admin-shared';
import { getT } from '@/i18n/server';
import { formatRuntimeAdminMessages } from '@/i18n/messages/format-runtime/admin';
import { challengeOf } from '@/lib/format-engine/challenge';
import { loadKitContext, rosterOf } from '@/lib/format-engine/runtime/load';
import { loadAdjustmentsPage, loadAdminOverview, loadChecksPage, loadParticipantNames } from '@/lib/format-engine/runtime/views-server';
import { toChallengeView } from '@/lib/format-engine/runtime/views';
import { listFormatChallenges } from '@/lib/supabase/queries/format-challenges';
import type { LText } from '@/lib/studio-core/ltext';
import type { LeagueAdminPanelContext } from './context';

/**
 * Live format tab (custom leagues only: `availableLeagueAdminTabs`). The admin's console for a league that runs a format
 * on the kit engine: the checks inbox, manual adjustments with their history, the player actions with Open and Lock,
 * the relations with the audited "show hidden sides" read, the open challenges of the ladders and a summary of the
 * format's lists.
 *
 * A league without an attached format, or whose format does not run on the kit engine, gets a notice that links to the
 * Format tab. Otherwise the kit context is loaded ONCE (`loadKitContext`, memoised per request) and every admin loader
 * runs over it in one wave. Only plain props reach the client islands (names, ids, labels, counts): no seed, no player
 * row, no pick. Relations are masked here, exactly as an ordinary player sees them; the hidden sides come only from the
 * audited unmask request the admin makes in the island. After any write an island reads this page again
 * (`router.refresh()`); this panel is the only source of the data.
 */
export async function formatLivePanel({ id, playerId, isSiteAdmin, tabLink }: LeagueAdminPanelContext) {
  const t = await getT(formatRuntimeAdminMessages);
  const ctx = await loadKitContext(id);

  if (ctx === null) {
    return (
      <Section title={t('notRunning.title')}>
        <p className="text-sm text-poke-text-secondary">{t.rich('notRunning.body', { link: tabLink('format') })}</p>
      </Section>
    );
  }

  const now = new Date();
  const [overview, checks, adjustments, openChallenges, nameMap] = await Promise.all([
    loadAdminOverview(ctx, playerId, now),
    loadChecksPage(id, ctx, 'open', { limit: PAGE_SIZE, offset: 0 }, playerId, isSiteAdmin),
    loadAdjustmentsPage(id, ctx, { limit: PAGE_SIZE, offset: 0 }, playerId),
    listFormatChallenges(id, { status: 'open' }),
    loadParticipantNames(id),
  ]);

  // The names of the league's players are all current season participants, as in every other admin loader (a player
  // missing here is a former player), NOT the form targets: those list the players of a phase only, so a participant
  // who sits in no phase (a late joiner, one taken out of a phase) would be shown as a former player.
  const names = Object.fromEntries(nameMap);

  const ladderPhases: AdminLadderPhase[] = ctx.phases
    .filter((phase) => challengeOf(phase.stage.pairing) !== null)
    .map((phase) => ({ id: phase.id, label: phase.stage.name }));
  const challenges = openChallenges.map((row) => toChallengeView(row, nameMap, now));

  const stageLabels: Record<string, LText | null> = {};
  for (const stage of adjustments.targets.stages) stageLabels[stage.key] = stage.label;
  const actionLabels: Record<string, LText | null> = {};
  for (const action of adjustments.targets.actions) actionLabels[action.id] = action.label;

  return (
    <>
      <Section title={t('panel.checksTitle')} subtitle={t('panel.checksSubtitle')}>
        <ChecksInbox seasonId={id} initial={checks} names={names} labels={{ stages: stageLabels, actions: actionLabels }} />
      </Section>

      <Section title={t('panel.adjustTitle')} subtitle={t('panel.adjustSubtitle')}>
        <div className="space-y-6">
          <AdjustmentsPanel seasonId={id} allowed={overview.allowed_adjustments} targets={adjustments.targets} />
          <div className="space-y-2">
            <h3 className="text-sm font-heading font-semibold text-poke-text-primary">{t('panel.historyHeading')}</h3>
            <AdjustmentHistory
              seasonId={id}
              initial={adjustments.history}
              total={adjustments.total}
              targets={adjustments.targets}
              names={names}
            />
          </div>
        </div>
      </Section>

      <Section title={t('panel.actionsTitle')}>
        <ActionsOverview seasonId={id} actions={overview.actions} canAdjust={overview.allowed_adjustments.includes('action')} />
      </Section>

      <Section title={t('panel.relationsTitle')}>
        <RelationsAdmin
          seasonId={id}
          relations={overview.relations}
          actions={overview.actions}
          canReveal={overview.allowed_adjustments.includes('relation')}
          roster={rosterOf(ctx).map((playerId) => ({ id: playerId, name: nameMap.get(playerId) ?? null }))}
        />
      </Section>

      {ladderPhases.length > 0 && (
        <Section title={t('panel.challengesTitle')}>
          <AdminLadders seasonId={id} phases={ladderPhases} challenges={challenges} />
        </Section>
      )}

      <Section title={t('panel.domainsTitle')}>
        <DomainsSummary domains={overview.domains} />
      </Section>
    </>
  );
}
