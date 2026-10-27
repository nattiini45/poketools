'use client';

/**
 * The pinned line's info box (draft-frontend §5.5, SPEC:375-378): line 1 is
 * the base Pokémon with its price, line 2 the evolution requirements
 * ("4 KOs → Ursaring · +11 KOs → Ursaluna-Bloodmoon"). No role or flavour
 * text. Glass panel, never a dark slab. The title is the one place the price
 * shows on the stage (the budget left after the pick sits above DRAFT).
 */
import { GitCompareArrows } from 'lucide-react';
import FavoriteStar from '@/components/draft-tool/shared/FavoriteStar';
import { useT } from '@/i18n/client';
import type { Locale } from '@/i18n/config';
import { draftScreenMessages } from '@/i18n/messages/draft/screen';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import type { NameResolver } from '@/lib/draft-finder/names-port';
import styles from '../draft-tool.module.css';

export interface InfoBoxProps {
  entry: DraftLineCatalogEntry;
  dl: Locale;
  names: NameResolver;
  isFavorite: boolean;
  inCompare: boolean;
  compareFull: boolean;
  onToggleFavorite(): void;
  onToggleCompare(): void;
  /** Favourites need a signed-in viewer. */
  canFavorite?: boolean;
  headingId?: string;
}

export default function InfoBox({
  entry,
  dl,
  names,
  isFavorite,
  inCompare,
  compareFull,
  onToggleFavorite,
  onToggleCompare,
  canFavorite = true,
  headingId,
}: InfoBoxProps) {
  const t = useT(draftScreenMessages);
  const [s1, s2, s3] = entry.stages;
  const base = names.species(s1.name, dl);
  const stage2 = s2 ? names.species(s2.name, dl) : '';
  const k2 = entry.thresholds.toStage2;
  const k3 = entry.thresholds.additionalToStage3;
  const thresholds =
    s3 && k3 !== null
      ? t('info.thresholds', { k2, stage2, k3, stage3: names.species(s3.name, dl) })
      : t('info.thresholdsTwoStage', { k2, stage2 });
  const compareDisabled = !inCompare && compareFull;

  return (
    <div className={`${styles.glass} flex flex-col gap-2 p-3`}>
      <div className="flex items-start gap-2">
        <h2 id={headingId} className="min-w-0 flex-1 text-xl font-extrabold leading-tight">
          {t('info.title', { base, price: entry.price })}
        </h2>
        {canFavorite ? (
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? t('info.unfavorite') : t('info.favorite')}
            title={isFavorite ? t('info.unfavorite') : t('info.favorite')}
            className={`${styles.focusable} inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[var(--draft-border)] hover:bg-[var(--draft-elevated)] md:h-9 md:w-9`}
          >
            <FavoriteStar filled={isFavorite} className="h-5 w-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onToggleCompare}
          disabled={compareDisabled}
          aria-pressed={inCompare}
          title={compareDisabled ? t('info.compareFull') : inCompare ? t('info.compareRemove') : t('info.compare')}
          className={`${styles.focusable} inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-[var(--draft-elevated)] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-[36px] ${inCompare ? 'border-[var(--draft-accent)]' : 'border-[var(--draft-border)]'}`}
        >
          <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
          <span>{inCompare ? t('info.compareRemove') : t('info.compare')}</span>
        </button>
      </div>
      <p className="text-sm font-semibold text-[var(--draft-ink-2)]">{thresholds}</p>
      {entry.flags.cosmog || entry.flags.noRedraft ? (
        <div className="flex flex-wrap gap-1.5">
          {entry.flags.cosmog ? (
            <span className="rounded-full border border-[var(--draft-accent)] px-2 py-0.5 text-xs font-semibold">{t('info.cosmogLine')}</span>
          ) : null}
          {entry.flags.noRedraft ? (
            <span className="rounded-full border border-[var(--draft-border)] px-2 py-0.5 text-xs">{t('info.noRedraft')}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
