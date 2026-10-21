import { Suspense, type ReactNode } from 'react';
import WorldShell from '@/components/world/WorldShell';
import WorldNav from '@/components/world/WorldNav';
import RouteDataProvider from '@/components/world/route/RouteDataProvider';
import RouteDebugOverlay from '@/components/world/route/RouteDebugOverlay';
import FocusUrlSync from '@/components/world/route/focus/FocusUrlSync';
import { rulesCopyContext } from '@/components/world/sections/rules-context';
import type { SeasonWorld } from '@/lib/worlds/types';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { WorldExperience } from '@/types/player';
import { getDataLocale, getLocale } from '@/i18n/server';
import { createTranslator } from '@/i18n/core';
import { worldClientMessages } from '@/i18n/messages/world/client';
import EvoligaRouteWorld from './route/EvoligaRouteWorld';
import HideHtmlOnRoute from './route/HideHtmlOnRoute';
import PulseSection from './PulseSection';
import RosterSection from './RosterSection';
import TeamsSection from './TeamsSection';
import ScheduleSection from './ScheduleSection';
import RulesSection from './RulesSection';
import EvoligaOverlays from './EvoligaOverlays';

/**
 * The EvoLiga one-page scrollworld: token-namespace shell, sticky anchor
 * nav, the five sections (Pulse, Roster, Teams, Schedule, Rules) and the
 * Team/Line context overlays, in the viewer's language (i18n D11: read once
 * here on the server and threaded down, so every DOM word is resolved in the
 * first render, long before the Pokéball reveal).
 *
 * C-093 (wave-1 SPAWN merge): the world consumes the GENERIC
 * `WorldRouteData` contract — pages fetch through `buildWorldRouteData` and
 * hand the payload here; this root maps it onto the evoliga view inline
 * (exactly the client adapter `toEvoligaRouteData`'s mapping — that adapter
 * lives in a 'use client' module, so its callable cannot cross into this
 * server component). The painted output is unchanged: same rows, same
 * `entries` flattening, with the one contract upgrade that the rules
 * surfaces now read the stage-fallback-aware `rulesetName`.
 */
export default async function EvoligaWorld({
  world,
  data,
  worldExperience,
  hub,
}: {
  world: SeasonWorld;
  data: WorldRouteData;
  worldExperience?: WorldExperience;
  /** The league hub (built by the league page), rendered inside #pulse under the pulse panels. */
  hub?: ReactNode;
}) {
  // The evoliga world is season-scoped: a payload without a league row has
  // no rendering here, and the page decides what a standalone tournament
  // gets instead (this root never invents a league).
  if (!data.league) return null;
  const [locale, dataLocale] = await Promise.all([getLocale(), getDataLocale()]);
  const nav = createTranslator(worldClientMessages, locale);

  const { league, stages, participants, rosterLines, trackers, standings, fixtures, formatRules, hasDraftPool } =
    data;
  const entries = rosterLines ?? [];

  return (
    <WorldShell world={world} worldExperience={worldExperience} routeData={data}>
      <RouteDataProvider
        data={{
          league,
          stages,
          participants,
          entries,
          trackers,
          standings,
          fixtures,
          formatRules,
          hasDraftPool,
        }}
      >
        <EvoligaRouteWorld />
      </RouteDataProvider>
      <HideHtmlOnRoute />
      <WorldNav sections={world.sections} label={nav('nav.evoligaSections')} brand="EvoLiga" />
      <PulseSection
        league={league}
        stages={stages}
        standings={standings}
        fixtures={fixtures}
        hasDraftPool={hasDraftPool}
        locale={locale}
      >
        {hub}
      </PulseSection>
      <RosterSection entries={entries} hasListBound={league.point_buy_list_id !== null} locale={locale} />
      <TeamsSection participants={participants} trackers={trackers} entries={entries} locale={locale} dataLocale={dataLocale} />
      <ScheduleSection stages={stages} fixtures={fixtures} standings={standings} locale={locale} />
      {/* The contract's rulesetName: the season's, else the first stage's.
          The league's format (not the row) picks the body. */}
      <RulesSection
        formatRules={formatRules}
        rulesetName={data.rulesetName}
        context={rulesCopyContext({ league, stages })}
        leagueId={league.id}
        locale={locale}
        dataLocale={dataLocale}
      />
      <EvoligaOverlays
        league={league}
        stages={stages}
        participants={participants}
        trackers={trackers}
        entries={entries}
        standings={standings}
        fixtures={fixtures}
        formatRules={formatRules}
        rulesetName={data.rulesetName}
        locale={locale}
        dataLocale={dataLocale}
      />
      <Suspense fallback={null}>
        <FocusUrlSync />
      </Suspense>
      <RouteDebugOverlay />
    </WorldShell>
  );
}
