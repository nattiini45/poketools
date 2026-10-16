import { notFound } from 'next/navigation';
import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { getAbilityNatDex } from '@/lib/pkmn/dex';

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WikiAbilityOverlay({ params, searchParams }: PageProps) {
  const { name } = await params;
  const sp = await searchParams;
  const decodedName = decodeURIComponent(name);
  const resolved = getAbilityNatDex(decodedName);

  if (!resolved) return notFound();

  const ability = resolved.entity;

  const config = parseOverlayConfig(
    new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  );
  // Wiki overlays have no league: `?lang=` or the default content language (i18n-core §6.5).
  const locale = await resolveOverlayLocale(config, {});

  const englishDesc =
    (ability as unknown as { desc?: string }).desc ??
    (ability as unknown as { shortDesc?: string }).shortDesc ??
    '';
  const desc = localizeDesc('ability', ability.name, englishDesc, locale);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: 'var(--broadcast-accent)',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: '36px', fontWeight: 700 }}>{localizeAbility(ability.name, locale)}</span>
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
