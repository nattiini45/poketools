/* eslint-disable @next/next/no-img-element */
import { notFound } from 'next/navigation';
import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { getItemNatDex } from '@/lib/pkmn/dex';
import { getItemSpriteUrl } from '@/lib/pkmn/sprites';

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WikiItemOverlay({ params, searchParams }: PageProps) {
  const { name } = await params;
  const sp = await searchParams;
  const decodedName = decodeURIComponent(name);
  const resolved = getItemNatDex(decodedName);

  if (!resolved) return notFound();

  const item = resolved.entity;

  const config = parseOverlayConfig(
    new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  );
  // Wiki overlays have no league: `?lang=` or the default content language (i18n-core §6.5).
  const locale = await resolveOverlayLocale(config, {});

  const englishDesc =
    (item as unknown as { desc?: string }).desc ??
    (item as unknown as { shortDesc?: string }).shortDesc ??
    '';
  const desc = localizeDesc('item', item.name, englishDesc, locale);
  const itemName = localizeItem(item.name, locale);

  return (
    <OverlayShell config={config} locale={locale}>
      <div
        style={{
          padding: '48px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <img
            src={getItemSpriteUrl(item.name)}
            alt={itemName}
            width={64}
            height={64}
            style={{ imageRendering: 'pixelated' }}
          />
          <span style={{ fontSize: '36px', fontWeight: 700 }}>{itemName}</span>
        </div>

        {/* Description */}
        {desc.text && (
          <div
            style={{
              background: 'var(--broadcast-surface-light)',
              borderRadius: '12px',
              padding: '20px 28px',
            }}
          >
            <p lang={desc.lang} style={{ fontSize: '22px', lineHeight: 1.6, opacity: 0.9 }}>
              {desc.text}
            </p>
          </div>
        )}
      </div>
    </OverlayShell>
  );
}
