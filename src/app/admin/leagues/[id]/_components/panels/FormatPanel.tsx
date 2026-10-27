import Link from 'next/link';
import Section from '@/components/ui/Section';
import FormatDetail from '@/components/format-studio/FormatDetail';
import FormatAttachPanel from '@/components/format-studio/attach/FormatAttachPanel';
import ReadinessCard from '@/components/format-studio/attach/ReadinessCard';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getT } from '@/i18n/server';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { formatStudioAttachMessages } from '@/i18n/messages/format-studio/attach';
import { loadAttachCandidates } from '@/lib/format-studio/attach-candidates';
import { loadLeagueFormat } from '@/lib/format-studio/loader';
import { loadLeagueFormatState } from '@/lib/format-studio/readiness-loader';
import { leagueAdminHref } from '@/lib/league-admin/tabs';
import { getRulesetPinInfo } from '@/lib/ruleset-studio/pin-info.server';
import type { LeagueAdminPanelContext } from './context';

/**
 * Format tab (every format). The read-only Format Studio view of this league: the generated
 * stage outline, the rules text with its EN/DE toggle, the diagnostics in plain words and the
 * coverage line, plus a link to the full detail page. Reads only through `loadLeagueFormat`
 * (stages, group counts, league group counts and the per-format extras, one wave); the league row
 * comes from the page. Nothing here changes data: editing stays on the other tabs, and the module
 * facts link there.
 *
 * A custom league adds two blocks above the outline: its readiness checklist and the attach panel (`#format-attach`),
 * where a published format is chosen, previewed and attached. They read in the same wave as the outline: the attached
 * format and the start signals (`loadLeagueFormatState`), and the formats this admin may attach
 * (`loadAttachCandidates`, for the live player). The attach preview names the rulesets the stages use ("Ruleset Spring OU v2"):
 * the format detail it loads carries the labels of the stored rulesets the spec names, and the league's own pin is a prop. Only plain props reach the client: no spec, no seed, no
 * player row.
 */
export async function formatPanel(ctx: LeagueAdminPanelContext) {
  if (ctx.league.format_type === 'custom') return customFormatPanel(ctx);
  return readOnlyFormatPanel(ctx);
}

async function readOnlyFormatPanel({ id, league, tabLink }: LeagueAdminPanelContext) {
  const [result, tStudio] = await Promise.all([loadLeagueFormat(league), getT(formatStudioAdminMessages)]);

  if (result.kind === 'no_phases') {
    // A custom league gets its phases from the attached format; a hand-made phase would block the attach.
    return (
      <p className="text-sm text-poke-text-muted">
        {league.format_type === 'custom'
          ? tStudio('detail.noPhasesCustom')
          : tStudio.rich('detail.noPhases', { link: tabLink('phases') })}
      </p>
    );
  }

  return (
    <Section title={tStudio('tab.title')} subtitle={tStudio('tab.subtitle')}>
      <div className="space-y-4">
        <Link
          href={`/admin/formats/league/${id}`}
          className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
        >
          {tStudio('tab.openStudio')}
        </Link>
        <FormatDetail view={result.view} variant="tab" editorLinks={result.editorLinks} />
      </div>
    </Section>
  );
}

async function customFormatPanel({ id, league, playerId, isSiteAdmin }: LeagueAdminPanelContext) {
  const viewer = { playerId, isAdmin: isSiteAdmin };
  // The page gate already decided who may open this tab; the live player only scopes the picker's formats.
  const access = await getLiveAccess();
  const [result, state, candidates, pin, tStudio, tAttach] = await Promise.all([
    loadLeagueFormat(league),
    loadLeagueFormatState(league),
    access?.player ? loadAttachCandidates(access.player) : Promise.resolve({ items: [], capped: false }),
    getRulesetPinInfo(league.ruleset_id, viewer),
    getT(formatStudioAdminMessages),
    getT(formatStudioAttachMessages),
  ]);

  return (
    <>
      {state !== null && !state.started && <ReadinessCard id="format-readiness" result={state.readiness} seasonId={id} />}

      <Section title={tAttach('panel.title')}>
        <FormatAttachPanel
          seasonId={id}
          started={state?.started ?? false}
          rulesetId={league.ruleset_id}
          seasonRuleset={pin === null ? null : { name: pin.name, version_no: pin.version_no }}
          seasonLanguage={league.language}
          manualPhaseCount={state?.manualPhaseCount ?? 0}
          attached={state?.attached ?? null}
          candidates={candidates.items}
          capped={candidates.capped}
          phasesHref={leagueAdminHref(id, 'phases')}
        />
      </Section>

      {result.kind === 'ok' && (
        <Section title={tStudio('tab.title')} subtitle={tStudio('tab.subtitle')}>
          <div className="space-y-4">
            <Link
              href={`/admin/formats/league/${id}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-poke-blue hover:underline sm:min-h-0"
            >
              {tStudio('tab.openStudio')}
            </Link>
            <FormatDetail view={result.view} variant="tab" editorLinks={result.editorLinks} />
          </div>
        </Section>
      )}
    </>
  );
}
