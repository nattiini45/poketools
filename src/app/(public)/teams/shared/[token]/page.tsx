import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDataLocale, getT } from '@/i18n/server';
import { teamsLibraryMessages } from '@/i18n/messages/teams-library';
import { metaMessages } from '@/i18n/messages/meta';
import { NOINDEX } from '@/lib/seo/robots';
import { loadSharedTeam } from '@/lib/team/page-loaders';
import { formatShowdownSet } from '@/lib/team/showdown-set';
import { filledSets, speciesList } from '@/lib/team/page-text';
import TeamSetCard from '../../TeamSetCard';
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-lg font-heading font-bold text-poke-text-primary mb-2">{t('shared.rateLimitedTitle')}</h1>
          <p className="text-sm text-poke-text-muted">{t('shared.rateLimited', { count: result.retryAfterSeconds })}</p>
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
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-xl font-heading font-bold text-poke-text-primary">{title}</h1>
          {team.tournament_id && (
            <span className="px-2 py-0.5 text-[10px] bg-poke-blue/10 text-poke-blue rounded font-medium">
              {t('shared.tournament')}
            </span>
          )}
        </div>
        {team.library_description && <p className="text-sm text-poke-text-muted">{team.library_description}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filled.map((set, i) => (
          <TeamSetCard key={i} set={set} index={i} t={t} dl={dataLocale} showIvs />
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-heading font-semibold text-poke-text-secondary mb-2">{t('shared.showdownPaste')}</h2>
        <pre className="p-4 bg-poke-surface border border-poke-border rounded-poke-md text-xs text-poke-text-primary font-mono overflow-x-auto whitespace-pre-wrap">
          {paste}
        </pre>
        <CopyPasteButton text={paste} label={t('shared.copyPaste')} />
      </div>
    </div>
  );
}