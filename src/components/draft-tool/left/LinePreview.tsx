'use client';

/**
 * The pinned line as a group portrait (draft-frontend §5.5, owner feedback
 * 2026-10, the pick-screen mockup): the stages stand on one ascending diagonal,
 * the base smallest in front at the lower left, the final stage largest at the
 * back on the upper right, over the halftone field. Reading left to right is the
 * evolution order, so the picture cannot be read as a tree.
 *
 * One responsive instance for every width: it iterates `entry.stages` (two or
 * three, never destructured), and a two-stage line is centred as a pair. The
 * field (`.previewArea`) is a size container that takes the room the stage
 * column leaves it, and the picture fits inside it by BOTH its width and its
 * height, so a short window shrinks the sprites instead of pushing the base
 * stage under the sticky DRAFT button. The slots are fractions of the picture
 * (container units in `.previewStage`), not pixels.
 *
 * The sprites are art-directed, not the viewer's choice: they are shown at
 * 200 to 300 px, where a pixel-art or animated sprite would be scaled up
 * blurred, so the picture pins the site default style (broadcast renders,
 * falling back to HOME where a species has none; docs/pkmn.md "Sprite styles")
 * and loads the `full` asset. The markup is an ordered list of the stages, so
 * assistive tech announces the chain in order; the sprites' `alt` text is
 * localized by `PokemonSprite` and they load by canonical English name.
 */
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { SITE_DEFAULT_SPRITE_STYLE } from '@/lib/pkmn/sprite-styles';
import styles from '../draft-tool.module.css';

export interface LinePreviewProps {
  entry: DraftLineCatalogEntry;
}

/** Nominal pixel size of the sprite box; CSS (`.previewImg`) sizes the image, this only sets the attributes. */
const SPRITE_ATTR_PX = 256;

export default function LinePreview({ entry }: LinePreviewProps) {
  const count = entry.stages.length;

  return (
    <div className={`${styles.halftone} ${styles.previewArea}`}>
      <ol className={styles.previewStage} data-stages={count}>
        {entry.stages.map((stage, i) => (
          // The base stands in front: the first stage has the highest stacking order.
          <li key={stage.stage} className={styles.previewSlot} data-slot={i} style={{ zIndex: count - i }}>
            <PokemonSprite
              name={stage.name}
              size={SPRITE_ATTR_PX}
              variant="full"
              spriteStyle={SITE_DEFAULT_SPRITE_STYLE}
              className={styles.previewImg}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
