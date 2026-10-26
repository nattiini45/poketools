'use client';

/**
 * The pinned line as a group portrait (draft-frontend §5.5, owner feedback
 * 2026-10, the pick-screen mockup): the stages stand on one ascending diagonal,
 * the base smallest in front at the lower left, the final stage largest at the
 * back on the upper right, overlapping a little over the halftone field. Reading
 * left to right is the evolution order, so the picture cannot be read as a tree.
 *
 * One responsive instance for every width: it iterates `entry.stages` (two or
 * three, never destructured), and a two-stage line is centred as a pair. The
 * sizes are fractions of the pane (CSS container units in `.previewStage`), not
 * pixels; the sprites load the `full` asset because they are shown large. The
 * markup is an ordered list of the stages, so assistive tech announces the
 * chain in order; the sprites' `alt` text is localized by `PokemonSprite` and
 * they load by canonical English name.
 */
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useSpriteStyle } from '@/components/shared/SpriteStyleProvider';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import styles from '../draft-tool.module.css';

export interface LinePreviewProps {
  entry: DraftLineCatalogEntry;
}

/** Nominal pixel size of the sprite box; CSS (`.previewImg`) sizes the image, this only sets the attributes. */
const SPRITE_ATTR_PX = 256;

export default function LinePreview({ entry }: LinePreviewProps) {
  const pixel = useSpriteStyle() === 'pixel';
  const count = entry.stages.length;

  return (
    <ol className={`${styles.halftone} ${styles.previewStage} ${pixel ? styles.previewPixel : ''}`} data-stages={count}>
      {entry.stages.map((stage, i) => (
        // The base stands in front: the first stage has the highest stacking order.
        <li key={stage.stage} className={styles.previewSlot} data-slot={i} style={{ zIndex: count - i }}>
          <PokemonSprite name={stage.name} size={SPRITE_ATTR_PX} variant="full" className={styles.previewImg} />
        </li>
      ))}
    </ol>
  );
}
