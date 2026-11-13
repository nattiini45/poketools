/* eslint-disable @next/next/no-img-element */
import { notFound } from 'next/navigation';
import OverlayShell from '@/components/broadcast/shared/OverlayShell';
import { parseOverlayConfig } from '@/lib/broadcast/overlay-config';
import { resolveOverlayLocale } from '@/lib/broadcast/overlay-locale';
import { localizeDesc } from '@/lib/pkmn/i18n/descriptions.server';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeMoveCategory } from '@/lib/pkmn/i18n/names/misc';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { LEAGUE_TIME_ZONE } from '@/i18n/config';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';
import { getMoveNatDex } from '@/lib/pkmn/dex';
import { getCategorySpriteUrl } from '@/lib/pkmn/sprites';
import TypeBadge from '@/components/shared/TypeBadge';

interface PageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WikiMoveOverlay({ params, searchParams }: PageProps) {
  const { name } = await params;
  const sp = await searchParams;
  const decodedName = decodeURIComponent(name);
  const resolved = getMoveNatDex(decodedName);

  if (!resolved) return notFound();

  const move = resolved.entity;

  const config = parseOverlayConfig(
    new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string')
    )
  );
  // Wiki overlays have no league: `?lang=` or the default content language (i18n-core §6.5).
  const locale = await resolveOverlayLocale(config, {});
  const t = createTranslator(broadcastOverlaysMessages, locale);
  const formatter = createFormatter({ locale, timeZone: LEAGUE_TIME_ZONE });

  const englishDesc =
    (move as unknown as { desc?: string }).desc ??
    (move as unknown as { shortDesc?: string }).shortDesc ??
    '';
  const desc = localizeDesc('move', move.name, englishDesc, locale);
  // A never-missing move (accuracy === true) shows '--', as before.
  const accuracy = move.accuracy === true ? '--' : formatter.percentOf(move.accuracy, 0);

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
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '36px', fontWeight: 700 }}>{localizeMove(move.name, locale)}</span>
          <TypeBadge type={move.type} locale={locale} className="text-base" />
          <img
            src={getCategorySpriteUrl(move.category)}
            alt={localizeMoveCategory(move.category, locale)}
            width={48}
            height={21}
          />
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '32px', fontSize: '24px' }}>
          <StatPill label={t('wiki.power')} value={move.basePower > 0 ? String(move.basePower) : '--'} />
          <StatPill label={t('wiki.accuracy')} value={accuracy} />
          <StatPill label={t('wiki.pp')} value={String(move.pp)} />
          {move.priority !== 0 && (
            <StatPill label={t('wiki.priority')} value={String(move.priority)} />
          )}
        </div>

        {/* Description */}
        {desc.text && (
          <p lang={desc.lang} style={{ fontSize: '20px', lineHeight: 1.6, opacity: 0.9 }}>
            {desc.text}
          </p>
        )}
      </div>
    </OverlayShell>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--broadcast-surface-light)',
        borderRadius: '12px',
        padding: '12px 24px',
        minWidth: '100px',
      }}
    >
      <span
        style={{
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--broadcast-text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '28px', fontWeight: 700 }}>{value}</span>
    </div>
  );
}
