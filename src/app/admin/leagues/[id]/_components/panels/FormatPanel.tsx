import Link from 'next/link';
import Section from '@/components/ui/Section';
import FormatDetail from '@/components/format-studio/FormatDetail';
import { getT } from '@/i18n/server';
import { formatStudioAdminMessages } from '@/i18n/messages/format-studio/admin';
import { loadLeagueFormat } from '@/lib/format-studio/loader';
import type { LeagueAdminPanelContext } from './context';

/**
 * Format tab (every format). The read-only Format Studio view of this league: the generated
 * stage outline, the rules text with its EN/DE toggle, the diagnostics in plain words and the
 * coverage line, plus a link to the full detail page. Reads only through `loadLeagueFormat`
 * (stages, group counts, league group counts and the per-format extras, one wave); the league row
 * comes from the page. Nothing here changes data: editing stays on the other tabs, and the module
 * facts link there.
 */
export async function formatPanel({ id, league, tabLink }: LeagueAdminPanelContext) {
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
