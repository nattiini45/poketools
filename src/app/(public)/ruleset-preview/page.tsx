import Link from 'next/link';
import { notFound } from 'next/navigation';
import { I18nProvider } from '@/i18n/client';
import { isLocale, type Locale } from '@/i18n/config';
import { getI18nProviderProps } from '@/i18n/server';
import { PRESET_RULES_VERSION } from '@/lib/pkmn/preset-data/pin';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import {
  DEFAULT_SCENARIO,
  PREVIEW_DEFINITION_ID,
  PREVIEW_LOCALES,
  PREVIEW_OWNER,
  PREVIEW_SCENARIOS,
  buildScenario,
  isPreviewScenario,
  presetOf,
  type PreviewScenarioId,
} from './fixtures';
import PreviewClient from './PreviewClient';
import { ltext } from '@/lib/studio-core/ltext';
import type { RulesetEditorProps } from '@/components/ruleset-studio/editor/RulesetEditor';

/**
 * Dev-only fixture preview of the Ruleset Studio editor.
 *
 * Renders the real editor (outline, sections, entry picker, live summary) over a fixture draft. Saving and publishing
 * answer from memory (`fake-library.ts`); the entry catalog and the preset rules come from the real dex-only routes.
 * **Nothing touches Supabase** (AGENTS.md: automation never spends the Supabase quota), and the route 404s in production
 * like `/draft-preview` and `/route-preview`. Run the dev server with `.claude/local-assets.cjs` so sprites come from the
 * local mirror.
 *
 * Query: `?scenario=ou-edited|blank|allowlist|roster|gen3|issues|published|unreadable` (default `ou-edited`),
 * `?lang=en|de` (the page language; default: the site's). The pages that need a database (gallery, read-only page, pin card,
 * league recycle bin, Danger tab) are in `/ruleset-preview/surfaces`.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

function href(scenario: PreviewScenarioId, lang: Locale | null): string {
  const query = new URLSearchParams({ scenario });
  if (lang !== null) query.set('lang', lang);
  return `/ruleset-preview?${query.toString()}`;
}

const CHIP = 'inline-flex min-h-11 items-center rounded-lg border border-poke-border px-2.5 py-1 text-sm hover:bg-poke-elevated sm:min-h-0';
const CHIP_ACTIVE = 'border-poke-text-secondary bg-poke-elevated font-semibold';

export default async function RulesetPreviewPage({ searchParams }: PageProps) {
  // Public: no auth required — dev-only, and 404s in production.
  if (process.env.NODE_ENV === 'production') notFound();

  const params = await searchParams;
  const scenarioParam = first(params.scenario);
  const langParam = first(params.lang);
  const id: PreviewScenarioId = isPreviewScenario(scenarioParam) ? scenarioParam : DEFAULT_SCENARIO;
  const lang: Locale | null = isLocale(langParam) ? langParam : null;

  const site = await getI18nProviderProps();
  const locale = lang ?? site.locale;
  const scenario = buildScenario(id);
  const presetId = presetOf(scenario);

  const editor: RulesetEditorProps = {
    definitionId: PREVIEW_DEFINITION_ID,
    summary: {
      id: PREVIEW_DEFINITION_ID,
      slug: 'preview',
      name: ltext('en', 'Preview ruleset', 'Vorschau-Regelwerk'),
      description: null,
      kind: 'custom',
      visibility: scenario.visibility,
      season_id: null,
      forked_from: null,
      draft_rev: scenario.draftRev,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
      owner: PREVIEW_OWNER,
      current_version:
        scenario.published === null
          ? null
          : {
              id: 'preview-version',
              version_no: scenario.published.versionNo,
              content_hash: scenario.published.contentHash,
              created_at: '2026-10-02T10:00:00Z',
              catalog_version: PRESET_RULES_VERSION,
              base_preset: null,
            },
    },
    initial: { document: scenario.document, draftRev: scenario.draftRev },
    published: scenario.published,
    actor: { playerId: PREVIEW_OWNER.id, isAdmin: true, leagueIds: [] },
    initialPreset: presetId === null ? null : resolvePresetRules(presetId),
  };

  return (
    <I18nProvider locale={locale} dataLocale={locale} timeZone={site.timeZone} requestTime={site.requestTime}>
      <div className="mx-auto max-w-[110rem] space-y-4 p-4">
        {/* i18n-ignore: dev-only fixture page, English only */}
        <nav aria-label="Scenarios" className="flex flex-wrap items-center gap-1.5">
          {PREVIEW_SCENARIOS.map((scenarioId) => (
            <Link key={scenarioId} href={href(scenarioId, lang)} aria-current={scenarioId === id ? 'page' : undefined} className={`${CHIP} ${scenarioId === id ? CHIP_ACTIVE : ''}`}>
              {scenarioId}
            </Link>
          ))}
          <span className="mx-2 text-poke-text-muted" aria-hidden="true">
            |
          </span>
          {([null, ...PREVIEW_LOCALES] as const).map((option) => (
            <Link key={option ?? 'site'} href={href(id, option)} className={`${CHIP} ${option === lang ? CHIP_ACTIVE : ''}`}>
              {/* i18n-ignore: dev-only fixture page, English only */}
              {option ?? 'site'}
            </Link>
          ))}
          <span className="mx-2 text-poke-text-muted" aria-hidden="true">
            |
          </span>
          <Link href="/ruleset-preview/surfaces" className={CHIP}>
            {/* i18n-ignore: dev-only fixture page, English only */}
            surfaces
          </Link>
        </nav>
        <PreviewClient key={`${id}:${locale}`} editor={editor} />
      </div>
    </I18nProvider>
  );
}
