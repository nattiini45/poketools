import { notFound } from 'next/navigation';
import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import { createTranslator } from '@/i18n/core';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import TypeBadge from '@/components/shared/TypeBadge';
import { WIKI_OVERLAY_TERA_TYPES } from '@/lib/broadcast/wiki-overlay-lookup';


interface PageProps {
  params: Promise<{ type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WikiTeraOverlay({ params, searchParams }: PageProps) {
  const { type } = await params;
  const sp = await searchParams;
  const decodedType = decodeURIComponent(type);

  // Match case-insensitively against valid types
  const matched = WIKI_OVERLAY_TERA_TYPES.find((t) => t.toLowerCase() === decodedType.toLowerCase());
  if (!matched) return notFound();

  const config = parseOverlayConfig(
    new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  );
  // Wiki overlays have no league: `?lang=` or the default content language (i18n-core §6.5).
  const locale = await resolveOverlayLocale(config, {});
  const t = createTranslator(broadcastOverlaysMessages, locale);

  return (
    <OverlayShell config={config} locale={locale}>
      <div
        style={{
          padding: '48px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          height: '100%',
        }}
      >
        <span
          style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--broadcast-text-muted)',
          }}
        >
          {t('wiki.teraType')}
        </span>
        <TypeBadge type={matched} locale={locale} className="text-2xl px-6 py-2" />
      </div>
    </OverlayShell>
  );
}
