import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDataLocale, getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { metaMessages } from '@/i18n/messages/meta';
import { NOINDEX } from '@/lib/seo/robots';
import { loadSharedTeam } from '@/lib/team/page-loaders';
import { formatShowdownSet } from '@/lib/team/showdown-set';
import { filledSets, speciesList } from '@/lib/team/page-text';
import Section from '@/components/ui/Section';
import SkewChip from '@/components/ui/SkewChip';
import TeamSheet from '../../TeamSheet';
import CopyPasteButton from './CopyPasteButton';

/**
 * A shared team: read-only, no sign-in, the token is the authorization. Server-rendered from the same allowlist as
 * `GET /api/teams/shared/[token]` (`filterTeamForShare`), so the roster is in the first response. A dead link is a
 * real 404 from the proxy (`src/lib/seo/page-gate.ts`); `notFound()` here covers a link that changes in between.
 * `noindex`: the link is a bearer token and must not be listed.
 */

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const result = await loadSharedTeam(token);
  if (result.status !== 'ok') return { robots: NOINDEX };

  const [t, meta, dataLocale] = await Promise.all([getT(teamsLibraryMessages), getT(metaMessages), getDataLocale()]);
  const title = result.team.library_title || t('shared.defaultTitle');
  const description = t('shared.metaDescription', { species: speciesList(result.team.pokemon, dataLocale) });
  return {
    title,
    description,
    robots: NOINDEX,
    openGraph: { title, description, type: 'website', siteName: meta('title') },
  };
}

export default async function SharedTeamPage({ params }: Params) {
  const { token } = await params;
  const result = await loadSharedTeam(token);
  const [t, dataLocale] = await Promise.all([getT(teamsLibraryMessages), getDataLocale()]);

  if (result.status === 'rate_limited') {
    // A page cannot answer 429: the notice stands in, and no team data is read or sent.
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex max-w-md flex-col gap-2 rounded-poke-lg border border-hairline bg-surface px-6 py-8 text-center">
          <h1 className="font-heading text-title text-fg">{t('shared.rateLimitedTitle')}</h1>
          <p className="text-body text-fg-muted">{t('shared.rateLimited', { count: result.retryAfterSeconds })}</p>
        </div>
      </div>
    );
  }
  if (result.status !== 'ok') notFound();

  const { team } = result;
  const title = team.library_title || t('shared.defaultTitle');
  const filled = filledSets(team.pokemon);
  const paste = filled.map(formatShowdownSet).join('\n\n');

  return (
    <TeamSheet
      title={title}
      description={team.library_description}
      meta={team.tournament_id ? <SkewChip tone="accent">{t('shared.tournament')}</SkewChip> : undefined}
      sets={filled}
      t={t}
      dl={dataLocale}
      showIvs
    >
      <Section title={t('shared.showdownPaste')} action={<CopyPasteButton text={paste} label={t('shared.copyPaste')} />}>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-poke-md bg-sunken p-4 font-mono text-caption text-fg">
          {paste}
        </pre>
      </Section>
    </TeamSheet>
  );
}
