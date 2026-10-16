import { Suspense, type ReactNode } from 'react';
import WorldShell from '@/components/world/WorldShell';
import WorldNav from '@/components/world/WorldNav';
import RouteDataProvider from '@/components/world/route/RouteDataProvider';
import RouteDebugOverlay from '@/components/world/route/RouteDebugOverlay';
import FocusUrlSync from '@/components/world/route/focus/FocusUrlSync';
import ThemeOverlays from '@/components/world/sections/overlays/ThemeOverlays';
import type { SeasonWorld } from '@/lib/worlds/types';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { WorldExperience } from '@/types/player';
import { getDataLocale, getLocale, getT } from '@/i18n/server';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import HideHtmlOnRoute from '@/components/world/evoliga/route/HideHtmlOnRoute';
import SakuraRouteWorld from './SakuraRouteWorld';
import PulseSection from './sections/PulseSection';
import RosterSection from './sections/RosterSection';
import TeamsSection from './sections/TeamsSection';
import ScheduleSection from './sections/ScheduleSection';
import RulesSection from './sections/RulesSection';
import { plaqueCopy } from './content/paint';
import { toSakuraRouteData } from './types';

/**
 * The Sakura Park one-page scrollworld: token-namespace shell, sticky anchor
 * nav, the five sections (in the viewer's language) (Pulse, Roster, Teams, Schedule, Rules)
 * and the 3D park behind them.
 *
 * Everything renders from the generic `WorldRouteData` contract: the page
 * (or the dev preview) fetches through `buildWorldRouteData` and hands the
 * payload here — no Supabase read happens inside the theme. The contract is
 * adapted once (`toSakuraRouteData`, a pure server-safe mapping) into the
 * sakura view both the DOM sections and the scene read; a payload without a
 * season row renders nothing (the park is season-scoped, and the page
 * decides what a standalone tournament gets instead).
 */
export default async function SakuraWorld({
  world,
  data,
  worldExperience,
  hub,
}: {
  world: SeasonWorld;
  data: WorldRouteData;
  worldExperience?: WorldExperience;
  /** The league hub (built by the league page), rendered inside #pulse under the masthead. */
  hub?: ReactNode;
}) {
  const view = toSakuraRouteData(data);
  if (!view) return null;
  // The world follows the viewer (i18n D11): one cookie read per render.
  const locale = await getLocale();
  const dataLocale = await getDataLocale();
  const t = await getT(worldThemesMessages, locale);

  return (
    <WorldShell world={world} worldExperience={worldExperience} routeData={data}>
      <RouteDataProvider data={view}>
        <SakuraRouteWorld />
      </RouteDataProvider>
      <HideHtmlOnRoute />
      <WorldNav sections={world.sections} label={t('nav.sakura.label')} brand={t('nav.sakura.brand')} />
      <PulseSection data={view} locale={locale}>
        {hub}
      </PulseSection>
      <RosterSection data={view} locale={locale} dataLocale={dataLocale} />
      <TeamsSection data={view} locale={locale} dataLocale={dataLocale} />
      <ScheduleSection data={view} locale={locale} />
      <RulesSection data={view} locale={locale} />
      <ThemeOverlays
        data={view}
        locale={locale}
        dataLocale={dataLocale}
        rulesCopy={(formatRules, rulesetName, context) => plaqueCopy(formatRules, rulesetName, context, locale)}
      />
      <Suspense fallback={null}>
        <FocusUrlSync />
      </Suspense>
      <RouteDebugOverlay />
    </WorldShell>
  );
}
