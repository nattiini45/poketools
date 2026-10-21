import type { MetadataRoute } from 'next';
import { getT } from '@/i18n/server';
import { metaMessages } from '@/i18n/messages/meta';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getT(metaMessages);
  return {
    id: '/',
    name: 'PokéTools',
    short_name: 'PokéTools',
    description: t('description'),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#E8D9B5',
    theme_color: '#C05E0A',
    icons: [
      {
        src: '/pwa/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/pwa/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/pwa/icon-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
