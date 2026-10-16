import { notFound } from 'next/navigation';
import PageContainer from '@/components/ui/PageContainer';
import EvoligaWorld from '@/components/world/evoliga/EvoligaWorld';
import SakuraWorld from '@/components/world/themes/sakura/SakuraWorld';
import MountainWorld from '@/components/world/themes/mountain/MountainWorld';
import CloudsWorld from '@/components/world/themes/clouds/CloudsWorld';
import ProbeWorld from './ProbeWorld';
import GalleryWorld from '@/components/world/route/gallery/GalleryWorld';
import { parseGalleryFile } from '@/components/world/route/gallery/gallery-file';
import {
  buildPreviewRoute,
  buildPreviewSakuraWorld,
  buildPreviewMountainWorld,
  buildPreviewCloudsWorld,
  isPreviewScenario,
  type PreviewScenario,
  type SakuraPreviewVariant,
} from './fixtures';

/**
 * Dev-only inspection harness for the route worlds.
 *
 * Renders a scrollworld against deterministic fixtures so the 3D journey can
 * be verified — camera endpoints, station seams, reverse scroll, reload-at-depth
 * — without a database. Reachable at `/route-preview`, and only outside
 * production.
 *
 * Every world here passes `worldExperience="auto"`: the product default is
 * 'off' (DEFAULT_WORLD_EXPERIENCE), but this harness keeps capability
 * detection deciding, so the capture tooling sees the route tier as before.
 *
 * Worlds: `?world=sakura|mountain|clouds` render the themed worlds (English
 * fixture sets), `?world=c100probe` the C-100 engine-probe fixture (figure
 * contract, textureRoles consumer, tree system), and no `world` param the
 * default plaza preview (unchanged — it takes no scenario/format params).
 * D42: `?world=gallery&galleryFile=<path>` mounts one GLB for the asset A/B
 * sheets (`components/world/route/gallery/`).
 *
 * Format axis (themed worlds only): `?fixture=open` keeps its capture-harness
 * meaning — the non-EPB singles variant with `rosterLines` null — and
 * `?format=open|epb` (default `epb`) overrides the format independently, so
 * `?world=sakura&format=open&scenario=large` composes.
 *
 * Scenario axis (themed worlds only), selected via `?scenario=<name>` or by
 * passing the scenario name directly in `?fixture=` (harness convenience;
 * the dedicated `scenario` param wins when both are given). Unknown values
 * fall back to `populated`:
 *  - `populated`  — baseline season in play (the default)
 *  - `empty`      — brand-new league: no fixtures, empty standings/results
 *  - `disputed`   — baseline, latest match ended under dispute (no live match)
 *  - `archive`    — finished season: every match completed, stages closed
 *  - `long-names` — very long trainer display names (fit/wrap/ellipsis stress)
 *  - `large`      — full roster drafted and doubled matchdays
 *  - `defaults`   — baseline data with `formatRules: null` (league defaults)
 *
 * Examples: `?world=sakura&fixture=empty`, `?world=clouds&scenario=empty&format=open`,
 * `?world=mountain&fixture=open`, `?world=sakura&format=open&scenario=large`.
 *
 * Append `?routeDebug=1` for the conductor readout. `?tier=lite` forces the
 * DOM-only tier — the intentional low/HTML rendering mode, not an error state.
 * Asset-failure / absent-asset states are OPERATIONAL, not query-selectable:
 * run the dev server with `NEXT_PUBLIC_WORLD_ASSETS_URL` unset or pointed at a
 * dead host to inspect them.
 */

export const dynamic = 'force-dynamic';

interface RoutePreviewPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** First value of a search param (the App Router hands arrays for repeated keys). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface PreviewSelection {
  /** The epb/open format variant. The three theme aliases are the same union. */
  variant: SakuraPreviewVariant;
  /** The named data scenario. */
  scenario: PreviewScenario;
}

/**
 * Resolve the format + scenario selection from the query string.
 * `?fixture=open` → open format, populated; `?fixture=<scenario>` → epb format
 * with that scenario; `?format=open|epb` overrides the format; `?scenario=`
 * overrides the scenario. Invalid values fall back to the defaults.
 */
function resolvePreviewSelection(
  params: Record<string, string | string[] | undefined>,
): PreviewSelection {
  const fixture = firstParam(params.fixture);
  const format = firstParam(params.format);
  const scenarioParam = firstParam(params.scenario);

  const selection: PreviewSelection = {
    variant: format === 'open' ? 'open' : 'epb',
    scenario: 'populated',
  };
  if (fixture === 'open') {
    selection.variant = 'open';
  } else if (isPreviewScenario(fixture)) {
    selection.scenario = fixture;
  }
  if (isPreviewScenario(scenarioParam)) {
    selection.scenario = scenarioParam;
  }
  return selection;
}

export default async function RoutePreviewPage({ searchParams }: RoutePreviewPageProps) {
  // Public: no auth required — dev-only, and 404s in production.
  if (process.env.NODE_ENV === 'production') notFound();

  const params = await searchParams;
  // Repeated keys arrive as arrays — resolve `world` through the same
  // first-value helper the fixture/format/scenario reads use, so
  // `?world=sakura&world=clouds` dispatches instead of silently falling
  // through to the plaza default.
  const world = firstParam(params.world);

  // Themed-world dispatch: hand each themed world root the generic contract,
  // built from its own English fixture set. Default preview (plaza) untouched.
  if (world === 'sakura') {
    const { variant, scenario } = resolvePreviewSelection(params);
    const sakura = buildPreviewSakuraWorld(variant, scenario);
    return (
      <PageContainer title={sakura.data.league?.name ?? 'Sakura Park preview'}>
        <SakuraWorld world={sakura.world} data={sakura.data} worldExperience="auto" />
      </PageContainer>
    );
  }

  if (world === 'mountain') {
    const { variant, scenario } = resolvePreviewSelection(params);
    const mountain = buildPreviewMountainWorld(variant, scenario);
    return (
      <PageContainer title={mountain.data.league?.name ?? 'Mountain Pass preview'}>
        <MountainWorld world={mountain.world} data={mountain.data} worldExperience="auto" />
      </PageContainer>
    );
  }

  if (world === 'clouds') {
    const { variant, scenario } = resolvePreviewSelection(params);
    const clouds = buildPreviewCloudsWorld(variant, scenario);
    return (
      <PageContainer title={clouds.data.league?.name ?? 'Skyisle preview'}>
        <CloudsWorld world={clouds.world} data={clouds.data} worldExperience="auto" />
      </PageContainer>
    );
  }

  // C-100 probe world (dev-only): the engine-contract fixture — figure
  // contract (roster + pool), the theme textureRoles consumer, the shared
  // tree system. ADDITIVE dispatch; the plaza default below is untouched.
  if (world === 'c100probe') {
    return (
      <PageContainer title="Engine probe preview (C-100)">
        <ProbeWorld />
      </PageContainer>
    );
  }

  // D42 gallery (dev-only): one GLB through the real figure path, posed by
  // `window.__routeGallery` (`?world=gallery&galleryFile=<path under the
  // asset base>`; `?routeDebug=1&routeAssetBase=<arm>` picks the mirror).
  // ADDITIVE dispatch; the plaza default below is untouched.
  if (world === 'gallery') {
    return (
      <PageContainer title="Figure gallery (D42)">
        <GalleryWorld file={parseGalleryFile(firstParam(params.galleryFile))} />
      </PageContainer>
    );
  }

  const data = buildPreviewRoute();

  return (
    <PageContainer title={data.league?.name ?? 'Route preview'}>
      <EvoligaWorld world={data.world} data={data} worldExperience="auto" />
    </PageContainer>
  );
}
