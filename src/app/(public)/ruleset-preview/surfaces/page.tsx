import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dangerPanel } from '@/app/admin/leagues/[id]/_components/panels/DangerPanel';
import LeagueTrashPanel from '@/components/league-trash/LeagueTrashPanel';
import RulesetPinCard from '@/components/ruleset/RulesetPinCard';
import RulesetPageView from '@/components/ruleset-studio/RulesetPageView';
import RulesetsGalleryView from '@/components/ruleset-studio/RulesetsGalleryView';
import NewRulesetDialog from '@/components/ruleset-studio/starts/NewRulesetDialog';
import PageContainer from '@/components/ui/PageContainer';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import { I18nProvider } from '@/i18n/client';
import { isLocale, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { getI18nProviderProps } from '@/i18n/server';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import { leagueAdminSeasonPageMessages } from '@/i18n/messages/league-admin/season-page';
import { rulesetMessages } from '@/i18n/messages/ruleset';
import { rulesetStudioMessages } from '@/i18n/messages/ruleset-studio';
import { rulesetStudioEditorMessages } from '@/i18n/messages/ruleset-studio/editor';
import { rulesetStudioSectionsMessages } from '@/i18n/messages/ruleset-studio/sections';
import { LEAGUE_TRASH_RETENTION_DAYS } from '@/lib/league-trash/constants';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { describeDocument } from '@/lib/ruleset-studio/describe.server';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';
import { DialogGallery, FakeApi } from './SurfacesClient';
import {
  DANGER_LEAGUE,
  DEFAULT_SURFACE,
  DETAIL_CHANGES,
  DETAIL_ID,
  DETAIL_SUMMARY,
  DETAIL_USAGE,
  DETAIL_VERSIONS,
  GALLERY,
  PIN_CARDS,
  SURFACES,
  TRASH_PENDING,
  TRASH_ROWS,
  isSurface,
  type SurfaceId,
} from './fixtures';
import { PREVIEW_LOCALES } from '../fixtures';

/**
 * Dev-only fixture preview of the Ruleset Studio pages and the league recycle bin that need a database to render for real:
 * the gallery (`/admin/rulesets`), the read-only page of one ruleset with its usage panel and version list, the pin card in
 * each of its states, the pin confirmation dialog in each state of the impact count, the league trash page and the Danger tab
 * of a league. Every one renders the REAL component over fixtures (`fixtures.ts`); the buttons answer from memory
 * (`fake-api.ts`). **Nothing touches Supabase**, and the route 404s in production like `/ruleset-preview`.
 *
 * Query: `?surface=gallery|detail|pins|dialogs|trash|danger` (default `gallery`), `?lang=en|de`.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function href(surface: SurfaceId, lang: Locale | null): string {
  const query = new URLSearchParams({ surface });
  if (lang !== null) query.set('lang', lang);
  return `/ruleset-preview/surfaces?${query.toString()}`;
}

const CHIP = 'inline-flex min-h-11 items-center rounded-lg border border-poke-border px-2.5 py-1 text-sm hover:bg-poke-elevated sm:min-h-0';
const CHIP_ACTIVE = 'border-poke-text-secondary bg-poke-elevated font-semibold';

export default async function RulesetSurfacesPreviewPage({ searchParams }: PageProps) {
  // Public: no auth required — dev-only, and 404s in production.
  if (process.env.NODE_ENV === 'production') notFound();

  const params = await searchParams;
  const surfaceParam = first(params.surface);
  const langParam = first(params.lang);
  const surface: SurfaceId = isSurface(surfaceParam) ? surfaceParam : DEFAULT_SURFACE;
  const lang: Locale | null = isLocale(langParam) ? langParam : null;

  const site = await getI18nProviderProps();
  const locale = lang ?? site.locale;

  return (
    <I18nProvider locale={locale} dataLocale={locale} timeZone={site.timeZone} requestTime={site.requestTime}>
      <div className="mx-auto max-w-[110rem] space-y-6 p-4">
        {/* i18n-ignore: dev-only fixture page, English only */}
        <nav aria-label="Surfaces" className="flex flex-wrap items-center gap-1.5">
          {SURFACES.map((id) => (
            <Link key={id} href={href(id, lang)} aria-current={id === surface ? 'page' : undefined} className={`${CHIP} ${id === surface ? CHIP_ACTIVE : ''}`}>
              {id}
            </Link>
          ))}
          <span className="mx-2 text-poke-text-muted" aria-hidden="true">
            |
          </span>
          {([null, ...PREVIEW_LOCALES] as const).map((option) => (
            <Link key={option ?? 'site'} href={href(surface, option)} className={`${CHIP} ${option === lang ? CHIP_ACTIVE : ''}`}>
              {/* i18n-ignore: dev-only fixture page, English only */}
              {option ?? 'site'}
            </Link>
          ))}
        </nav>
        <FakeApi>{await renderSurface(surface, locale)}</FakeApi>
      </div>
    </I18nProvider>
  );
}

async function renderSurface(surface: SurfaceId, locale: Locale) {
  switch (surface) {
    case 'gallery': {
      const t = createTranslator(rulesetStudioMessages, locale);
      return (
        <PageContainer title={t('page.title')} subtitle={t('page.subtitle')} maxWidth="xl" action={<NewRulesetDialog data={GALLERY.dialog} />}>
          <RulesetsGalleryView
            t={t}
            locale={locale}
            mine={GALLERY.mine}
            shared={GALLERY.shared}
            site={GALLERY.site}
            usage={GALLERY.usage}
            catalogVersion={PRESET_RULES_VERSION}
            limit={50}
          />
        </PageContainer>
      );
    }
    case 'detail': {
      const described = describeDocument(newRulesetDocument('Spring OU', 'en', 'gen9ou'), locale);
      const latest = DETAIL_VERSIONS[0].version_no;
      return (
        // i18n-ignore: dev-only fixture page, the title is the fixture's own name
        <PageContainer title="Spring OU" maxWidth="lg">
          <RulesetPageView
            id={DETAIL_ID}
            summary={DETAIL_SUMMARY}
            canEdit
            locale={locale}
            described={described}
            isDraft={false}
            usage={DETAIL_USAGE}
            latestVersionNo={latest}
            versions={DETAIL_VERSIONS}
            changes={DETAIL_CHANGES}
            catalogVersion={PRESET_RULES_VERSION}
            t={createTranslator(rulesetStudioSectionsMessages, locale)}
            tList={createTranslator(rulesetStudioMessages, locale)}
            tEditor={createTranslator(rulesetStudioEditorMessages, locale)}
            tRuleset={createTranslator(rulesetMessages, locale)}
          />
        </PageContainer>
      );
    }
    case 'pins':
      return (
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
          {PIN_CARDS.map((card) => (
            <div key={card.key} className="space-y-1">
              {/* i18n-ignore: dev-only fixture page, English only */}
              <p className="text-xs font-semibold uppercase text-poke-text-muted">{card.key}</p>
              <RulesetPinCard kind={card.kind} target={card.target} pin={card.pin} />
            </div>
          ))}
        </div>
      );
    case 'dialogs':
      return (
        <div className="mx-auto max-w-5xl space-y-3">
          {/* i18n-ignore: dev-only fixture page, English only */}
          <p className="text-sm text-poke-text-secondary">Each button opens the pin confirmation with one answer of the impact count.</p>
          <DialogGallery />
        </div>
      );
    case 'trash': {
      const t = createTranslator(leagueAdminMessages, locale);
      return (
        <PageContainer
          title={t('trash.title')}
          subtitle={t('trash.subtitle', { days: LEAGUE_TRASH_RETENTION_DAYS })}
          maxWidth="xl"
          action={
            <Link href="/admin/leagues" className={`${getButtonClasses('ghost', 'sm')} min-h-11 sm:min-h-0`}>
              {t('trash.back')}
            </Link>
          }
        >
          <LeagueTrashPanel rows={TRASH_ROWS} pending={TRASH_PENDING} />
        </PageContainer>
      );
    }
    case 'danger': {
      const t = createTranslator(leagueAdminSeasonPageMessages, locale);
      return (
        <div className="mx-auto max-w-5xl space-y-8">
          {await dangerPanel({ id: DANGER_LEAGUE.id, league: DANGER_LEAGUE, isSiteAdmin: true, t })}
          {await dangerPanel({ id: DANGER_LEAGUE.id, league: { ...DANGER_LEAGUE, archived: true }, isSiteAdmin: false, t })}
        </div>
      );
    }
  }
}
