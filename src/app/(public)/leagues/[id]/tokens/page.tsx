import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSeasonWithDetails } from '@/lib/supabase/queries/seasons';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { lineThresholdsFromEntries } from '@/lib/draft/epb-thresholds';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import { getLocale, getT } from '@/i18n/server';
import { draftTokensMessages } from '@/i18n/messages/draft/tokens';
import TokenCenter from '@/components/draft-tokens/TokenCenter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
}

const LINK = 'text-poke-text-link hover:underline mt-2 inline-block';

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center">{children}</div>;
}

/**
 * `/leagues/[id]/tokens` — the player's token centre (draft-frontend §3.3,
 * §6.2).
 *
 * Signed-in players only (otherwise a sign-in prompt); EPB leagues only. The
 * page renders only the league name and the line catalog (names, prices,
 * thresholds): the player's token overview is loaded client-side from the
 * guarded route (BE #25), never server-rendered, and no snapshot is read (so
 * nothing can tick, critique B9). No `players` row crosses into the client.
 */
export default async function TokensPage({ params }: PageProps) {
  const { id } = await params;

  const [player, league, t, locale] = await Promise.all([
    getSessionPlayer(),
    getSeasonWithDetails(id),
    getT(draftTokensMessages),
    getLocale(),
  ]);
  if (!league) notFound();

  const back = (
    <Link href={`/leagues/${id}`} className={LINK}>
      {t('page.backToLeague')}
    </Link>
  );

  if (!isEvolutionPointBuy(league.format_type)) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.notEpb')}</p>
        {back}
      </EmptyState>
    );
  }

  if (!player) {
    return (
      <EmptyState>
        <h1 className="mb-2 text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
        <p className="text-poke-text-secondary">{t('page.signIn')}</p>
        <Link href="/api/auth/signin" className={LINK}>
          {t('page.signInLink')}
        </Link>
      </EmptyState>
    );
  }

  const listVersionId = league.point_buy_list_id;
  if (!listVersionId) {
    return (
      <EmptyState>
        <p className="text-poke-text-secondary">{t('page.noList')}</p>
        {back}
      </EmptyState>
    );
  }

  const entries = await getListEntries(listVersionId);
  // The token cards show line names, forms and thresholds only; banned moves
  // feed the finder, which this page does not render.
  const catalog = buildLineCatalog(entries, lineThresholdsFromEntries(entries), [], locale);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('page.title', { league: league.name })}</h1>
        <Link href={`/leagues/${id}/draft-room`} className="text-sm text-poke-text-link hover:underline">
          {t('page.toDraftRoom')}
        </Link>
      </div>
      <TokenCenter seasonId={id} catalog={catalog} />
    </div>
  );
}
