'use client';

/**
 * The staged sprites of the pinned line (draft-frontend §5.5, mockup f_03):
 * stage 2 on the left, the final stage large at the rear, stage 1 in front,
 * over the amber halftone. `renderer` is the slot for the later 3D stage.
 * Sprites load by canonical English name; their `alt` text is localized by
 * `PokemonSprite`.
 */
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import styles from '../draft-tool.module.css';

export interface LinePreviewProps {
  entry: DraftLineCatalogEntry;
  renderer?: 'sprites';
  /** Phones: 72/88/104 px instead of 80/96/144 px. */
  compact?: boolean;
}

export default function LinePreview({ entry, compact = false }: LinePreviewProps) {
  const [s1, s2, s3] = entry.stages;
  const finalStage = s3 ?? s2;
  const middle = s3 ? s2 : null;
  const size = compact ? { s1: 72, s2: 88, s3: 104 } : { s1: 80, s2: 96, s3: 144 };

  return (
    <div className={`${styles.halftone} ${styles.previewStage} ${compact ? styles.previewCompact : ''}`}>
      {middle ? (
        <div className={styles.previewS2}>
          <PokemonSprite name={middle.name} size={size.s2} />
        </div>
      ) : null}
      {finalStage ? (
        <div className={styles.previewS3}>
          <PokemonSprite name={finalStage.name} size={size.s3} />
        </div>
      ) : null}
      <div className={styles.previewS1}>
        <PokemonSprite name={s1.name} size={size.s1} />
      </div>
    </div>
  );
}
