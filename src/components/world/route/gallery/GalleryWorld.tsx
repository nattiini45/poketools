'use client';

import dynamic from 'next/dynamic';
import WorldStateProvider, { useWorldState } from '@/components/world/route/WorldStateProvider';
import HideHtmlOnRoute from '@/components/world/evoliga/route/HideHtmlOnRoute';
import { GALLERY_STATION_ID, GALLERY_STATION_IDS, galleryTheme } from './gallery-theme';

/**
 * D42 gallery world (dev-only, `/route-preview?routeDebug=1&world=gallery
 * &galleryFile=<path>&routeAssetBase=<arm>`): one GLB through the real figure
 * path, for the meshopt / decimation A/B sheets. The same tier law as every
 * world: the scene import is deferred (`ssr: false`), so nothing about the
 * asset base or the figure reaches the server render.
 */

const Scene = dynamic(() => import('./GalleryScene'), { ssr: false });

function GalleryRouteWorld({ file }: { file: string | null }) {
  const { tier } = useWorldState();
  if (tier !== 'route') return null;
  return <Scene file={file} />;
}

export default function GalleryWorld({ file }: { file: string | null }) {
  return (
    <WorldStateProvider stationIds={GALLERY_STATION_IDS} theme={galleryTheme} worldExperience="auto">
      <GalleryRouteWorld file={file} />
      <HideHtmlOnRoute />
      <section id={GALLERY_STATION_ID} className="min-h-screen px-6 py-24">
        {/* i18n-ignore: dev-only D42 gallery (route-preview, notFound in production) */}
        <h2 className="text-xl font-semibold">Figure gallery</h2>
        {/* i18n-ignore: dev-only D42 gallery (route-preview, notFound in production) */}
        <p>{file ?? 'galleryFile is missing or invalid (a .glb path under the asset base).'}</p>
      </section>
    </WorldStateProvider>
  );
}
