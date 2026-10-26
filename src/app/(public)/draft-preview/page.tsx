import { notFound } from 'next/navigation';
import Link from 'next/link';
import WorldShell from '@/components/world/WorldShell';
import { I18nProvider } from '@/i18n/client';
import { isLocale, type Locale } from '@/i18n/config';
import { draftScreenMessages, type DraftScreenEn } from '@/i18n/messages/draft/screen';
import { getI18nProviderProps, getT } from '@/i18n/server';
import { buildDraftSearchIndex } from '@/lib/draft-finder/build-index.server';
import type { DraftSearchIndex } from '@/lib/draft-finder/index-types';
import { buildLineCatalog } from '@/lib/draft-finder/line-catalog';
import { getWorldByRouteThemeId } from '@/lib/worlds/registry';
import type { SeasonWorld } from '@/lib/worlds/types';
import { DEFAULT_BANNED_MOVES } from '@/types/format-rules';
import {
  buildPreviewScenario,
  DEFAULT_SCENARIO,
  isPreviewScenario,
  isPreviewWorld,
  PREVIEW_ENTRIES,
  PREVIEW_LEAGUE_NAME,
  PREVIEW_LIST_VERSION_ID,
  PREVIEW_SEASON_ID,
  PREVIEW_WORLDS,
  previewNow,
  SCENARIO_GROUPS,
  type PreviewScenarioId,
  type PreviewWorld,
  type ScenarioGroup,
} from './fixtures';
import PreviewClient from './PreviewClient';
import GroupPoolPicker from '@/components/draft-tool/shared/GroupPoolPicker';
import { draftGroupsMessages } from '@/i18n/messages/draft/groups';
import { spriteStyleMessages } from '@/i18n/messages/sprite-style';
import { SpriteStyleProvider } from '@/components/shared/SpriteStyleProvider';
import { SPRITE_STYLE_PREFERENCES, isSpriteStylePreference, type SpriteStylePreference } from '@/lib/pkmn/sprite-styles';

/**
 * Dev-only fixture preview of the EPB draft tool (draft-frontend §11.1, DF3).
 *
 * Renders the real screens (pick screen, redraft centre, token centre, admin
 * control panel, audit viewer) against an in-memory backend
 * (`fake-source.ts`) and deterministic scenarios over the example pack's synthetic list
 * (`fixtures.ts`, `fixture-lines.example.json`). The search index is built here on the
 * server from the fixture lines (CPU only). **Nothing touches Supabase or the
 * network** (AGENTS.md: automation never spends the Supabase quota), and the
 * route 404s in production like `/route-preview`.
 *
 * Layout: the scenario picker (a tall dev tool) stays above the screen and the
 * page scrolls here. It is deliberately NOT passed as the screen's `header`
 * (the real room does that, `leagues/[id]/draft-room/page.tsx`, so its header
 * sits inside the fixed desktop height): a picker that tall would crush the
 * panes of a fixed-height screen.
 *
 * Query:
 * - `?scenario=<id>` — see `PREVIEW_SCENARIOS` (default `live-my-turn`);
 *   `admin-room` / `admin-room-sheet` show the room's Admin button and its
 *   admin sheet (fake `AdminDraftActions`, same backend as the room);
 *   `admin-room-refused` opens the sheet on the Redraft tab of a Redraft
 *   whose automatic publish was refused.
 * - `?world=evoliga|sakura|mountain|clouds|none` — the world token namespace
 *   (default `evoliga`; `none` renders without a world, the token fallbacks).
 * - `?lang=en|de` / `?pkmn=en|de` — override the UI / Pokémon-name language
 *   for this page (screenshots); default: the site's language cookies.
 * - `?groups=1` — the league-groups switch above the screen, as the draft room
 *   and the redraft page show it in a league that drafts per group (fixture
 *   groups: the viewer's Group A shown, Group B one link away). The admin
 *   scenarios then put their pools in Group A: tabs read "Group A · …" and
 *   "Create Redraft" names the group (control panel and the room's sheet).
 * - `?sprites=site|broadcast|home|animated|pixel` — render the room's sprites in
 *   that style (docs/pkmn.md, "Sprite styles") without touching the
 *   `plc_sprite_style` cookie; default: this browser's preference.
 */

export const dynamic = 'force-dynamic';

interface DraftPreviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const WORLD_THEME: Record<Exclude<PreviewWorld, 'none'>, string> = {
  evoliga: 'plaza',
  sakura: 'sakura',
  mountain: 'mountain',
  clouds: 'clouds',
};

function worldOf(world: PreviewWorld): SeasonWorld | null {
  return world === 'none' ? null : getWorldByRouteThemeId(WORLD_THEME[world]);
}

// The index depends only on the committed fixture list: build it once per server process.
let indexMemo: Promise<DraftSearchIndex> | null = null;
function previewIndex(): Promise<DraftSearchIndex> {
  if (!indexMemo) {
    indexMemo = buildDraftSearchIndex(PREVIEW_LIST_VERSION_ID, PREVIEW_ENTRIES).then((r) => r.index);
    indexMemo.catch(() => {
      indexMemo = null;
    });
  }
  return indexMemo;
}

interface PickerState {
  scenario: PreviewScenarioId;
  world: PreviewWorld;
  lang: Locale | null;
  pkmn: Locale | null;
  /** League groups: show the group switch (`?groups=1`). */
  groups: boolean;
  /** Sprite style for this page only (`?sprites=`); null = the browser's preference. */
  sprites: SpriteStylePreference | null;
}

function previewHref(state: PickerState, patch: Partial<PickerState>): string {
  const next = { ...state, ...patch };
  const q = new URLSearchParams({ scenario: next.scenario });
  if (next.world !== 'evoliga') q.set('world', next.world);
  if (next.lang) q.set('lang', next.lang);
  if (next.pkmn) q.set('pkmn', next.pkmn);
  if (next.groups) q.set('groups', '1');
  if (next.sprites) q.set('sprites', next.sprites);
  return `/draft-preview?${q.toString()}`;
}

/** Scenario id → its `preview.scenario.*` label key. */
const SCENARIO_KEY: Record<PreviewScenarioId, keyof DraftScreenEn['preview']['scenario']> = {
  'live-my-turn': 'liveMyTurn',
  'live-waiting': 'liveWaiting',
  'live-up-next': 'liveUpNext',
  'live-paused': 'livePaused',
  'live-makeup': 'liveMakeup',
  'live-ext-used': 'liveExtUsed',
  'live-reasons': 'liveReasons',
  'live-filters': 'liveFilters',
  'live-confirm': 'liveConfirm',
  'live-wall': 'liveWall',
  'live-filters-more': 'liveFiltersMore',
  'live-index-loading': 'liveIndexLoading',
  'live-index-failed': 'liveIndexFailed',
  'slow-my-turn': 'slowMyTurn',
  'slow-penalty': 'slowPenalty',
  'redraft-submission': 'redraftSubmission',
  'redraft-locked': 'redraftLocked',
  'redraft-reveal': 'redraftReveal',
  'redraft-picking': 'redraftPicking',
  complete: 'complete',
  spectator: 'spectator',
  'signed-out': 'signedOut',
  'admin-panel': 'adminPanel',
  'admin-publish-refused': 'adminPublishRefused',
  'admin-tokens': 'adminTokens',
  'admin-audit': 'adminAudit',
  'admin-room': 'adminRoom',
  'admin-room-sheet': 'adminRoomSheet',
  'admin-room-refused': 'adminRoomRefused',
  'tokens-before': 'tokensBefore',
  'tokens-open': 'tokensOpen',
  'tokens-comeback': 'tokensComeback',
  'many-drafted': 'manyDrafted',
};

const CHIP =
  'inline-flex min-h-11 items-center rounded-lg border border-poke-border px-2.5 py-1 text-sm motion-safe:transition-colors hover:bg-poke-elevated sm:min-h-0';
const CHIP_ACTIVE = 'border-poke-text-secondary bg-poke-elevated font-semibold';

export default async function DraftPreviewPage({ searchParams }: DraftPreviewPageProps) {
  // Public: no auth required — dev-only, and 404s in production.
  if (process.env.NODE_ENV === 'production') notFound();

  const params = await searchParams;
  const scenarioParam = firstParam(params.scenario);
  const worldParam = firstParam(params.world);
  const langParam = firstParam(params.lang);
  const pkmnParam = firstParam(params.pkmn);
  const spritesParam = firstParam(params.sprites);
  const state: PickerState = {
    scenario: isPreviewScenario(scenarioParam) ? scenarioParam : DEFAULT_SCENARIO,
    world: isPreviewWorld(worldParam) ? worldParam : 'evoliga',
    lang: isLocale(langParam) ? langParam : null,
    pkmn: isLocale(pkmnParam) ? pkmnParam : null,
    groups: firstParam(params.groups) === '1',
    sprites: isSpriteStylePreference(spritesParam) ? spritesParam : null,
  };

  const site = await getI18nProviderProps();
  const locale = state.lang ?? site.locale;
  const dataLocale = state.pkmn ?? (state.lang ? locale : site.dataLocale);
  const t = await getT(draftScreenMessages, locale);
  const tGroups = await getT(draftGroupsMessages, locale);
  const tSprites = await getT(spriteStyleMessages, locale);

  const scenario = buildPreviewScenario(state.scenario, previewNow());
  const catalog = buildLineCatalog(PREVIEW_ENTRIES, [], DEFAULT_BANNED_MOVES, locale);
  const index = await previewIndex();
  const world = worldOf(state.world);
  const admin = scenario.init.snapshot?.viewer.is_pool_admin === true;
  const links = {
    redraft: previewHref(state, { scenario: 'redraft-submission' }),
    tokens: previewHref(state, { scenario: 'tokens-open' }),
    // The room's admin sheet appends `?pool=…`: the trailing `#` keeps that out of the preview's query.
    admin: admin ? `${previewHref(state, { scenario: 'admin-panel' })}#` : null,
    adminAudit: admin ? `${previewHref(state, { scenario: 'admin-audit' })}#` : null,
    trainerCreator: '/draft-room/trainer-creator',
  };
  // DraftControlPanel appends `?pool=…` to its links: the trailing `#` keeps that out of the preview's query.
  const screenLinks = {
    redraftRoom: previewHref(state, { scenario: 'redraft-picking' }),
    adminRoom: `${previewHref(state, { scenario: 'live-my-turn' })}#`,
    adminAudit: `${previewHref(state, { scenario: 'admin-audit' })}#`,
  };

  const groups = Object.entries(SCENARIO_GROUPS) as [ScenarioGroup, readonly PreviewScenarioId[]][];
  const content = (
    <div className="space-y-4">
      <header className="space-y-3 rounded-xl border border-poke-border p-3">
        <div>
          <h1 className="text-lg font-bold">{t('preview.title')}</h1>
          <p className="text-sm text-poke-text-secondary">{t('preview.intro')}</p>
        </div>
        <nav aria-label={t('preview.title')} className="space-y-2">
          {groups.map(([group, ids]) => (
            <div key={group} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-[6rem] shrink-0 text-xs font-semibold uppercase text-poke-text-secondary">{t(`preview.groups.${group}`)}</span>
              {ids.map((id) => (
                <Link
                  key={id}
                  href={previewHref(state, { scenario: id })}
                  aria-current={id === state.scenario ? 'page' : undefined}
                  title={id}
                  className={`${CHIP} ${id === state.scenario ? CHIP_ACTIVE : ''}`}
                >
                  {t(`preview.scenario.${SCENARIO_KEY[id]}`)}
                </Link>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-[6rem] shrink-0 text-xs font-semibold uppercase text-poke-text-secondary">{t('preview.world')}</span>
            {PREVIEW_WORLDS.map((w) => (
              <Link key={w} href={previewHref(state, { world: w })} className={`${CHIP} ${w === state.world ? CHIP_ACTIVE : ''}`}>
                <code>{w}</code>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-[6rem] shrink-0 text-xs font-semibold uppercase text-poke-text-secondary">{t('preview.language')}</span>
            {([null, 'en', 'de'] as const).map((l) => (
              <Link key={l ?? 'site'} href={previewHref(state, { lang: l })} className={`${CHIP} ${l === state.lang ? CHIP_ACTIVE : ''}`}>
                {l === null ? t('preview.siteSetting') : <code>{l}</code>}
              </Link>
            ))}
            <span className="ml-3 text-xs font-semibold uppercase text-poke-text-secondary">{t('preview.pkmnLanguage')}</span>
            {([null, 'en', 'de'] as const).map((l) => (
              <Link key={l ?? 'site'} href={previewHref(state, { pkmn: l })} className={`${CHIP} ${l === state.pkmn ? CHIP_ACTIVE : ''}`}>
                {l === null ? t('preview.siteSetting') : <code>{l}</code>}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-[6rem] shrink-0 text-xs font-semibold uppercase text-poke-text-secondary">{tGroups('preview.toggle')}</span>
            {([false, true] as const).map((on) => (
              <Link
                key={String(on)}
                href={previewHref(state, { groups: on })}
                className={`${CHIP} ${on === state.groups ? CHIP_ACTIVE : ''}`}
              >
                {on ? tGroups('preview.on') : tGroups('preview.off')}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="min-w-[6rem] shrink-0 text-xs font-semibold uppercase text-poke-text-secondary">{tSprites('menuLegend')}</span>
            <Link href={previewHref(state, { sprites: null })} className={`${CHIP} ${state.sprites === null ? CHIP_ACTIVE : ''}`}>
              {t('preview.siteSetting')}
            </Link>
            {SPRITE_STYLE_PREFERENCES.map((style) => (
              <Link
                key={style}
                href={previewHref(state, { sprites: style })}
                className={`${CHIP} ${style === state.sprites ? CHIP_ACTIVE : ''}`}
              >
                {tSprites(`options.${style}.label`)}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      {state.groups ? (
        <GroupPoolPicker
          options={[
            { groupId: 'preview-a', label: tGroups('preview.groupA'), href: previewHref(state, {}), current: true, mine: true },
            { groupId: 'preview-b', label: tGroups('preview.groupB'), href: `${previewHref(state, {})}#group-b`, current: false, mine: false },
          ]}
          labels={{
            nav: tGroups('picker.label'),
            mine: tGroups('picker.mine'),
            showing: tGroups('picker.showing', { group: tGroups('preview.groupA') }),
          }}
        />
      ) : null}
      <PreviewClient
        key={`${state.scenario}:${locale}:${dataLocale}:${state.groups ? 'groups' : 'one'}`}
        scenario={scenario}
        seasonId={PREVIEW_SEASON_ID}
        leagueName={PREVIEW_LEAGUE_NAME}
        catalog={catalog}
        index={index}
        links={links}
        screenLinks={screenLinks}
        group={state.groups ? { id: 'preview-a', name: tGroups('preview.groupA') } : null}
      />
    </div>
  );

  return (
    <I18nProvider locale={locale} dataLocale={dataLocale} timeZone={site.timeZone} requestTime={site.requestTime}>
      {state.sprites ? (
        <SpriteStyleProvider key={state.sprites} initialPreference={state.sprites}>
          {world ? <WorldShell world={world}>{content}</WorldShell> : content}
        </SpriteStyleProvider>
      ) : world ? (
        <WorldShell world={world}>{content}</WorldShell>
      ) : (
        content
      )}
    </I18nProvider>
  );
}
