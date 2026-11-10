import { cn } from '@/lib/utils/cn';
import { itemIconSource, type ItemIconId, type ItemIconSize } from '@/lib/pkmn/item-icons';

interface ItemIconProps {
  item: ItemIconId;
  /** Whole multiples of the 24 px source only, so the pixel art never resamples. */
  size?: ItemIconSize;
  className?: string;
}

/** A decorative Showdown item icon for chrome (nav, tabs, section headers, states); the label beside it names it. */
export default function ItemIcon({ item, size = 24, className }: ItemIconProps) {
  const source = itemIconSource(item);
  if (source.kind === 'file') {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a 24 px pixel-art icon scaled by whole multiples; next/image would resample it
      <img
        src={source.url}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn('inline-block shrink-0 [image-rendering:pixelated]', className)}
      />
    );
  }
  const scale = size / source.cell;
  return (
    <span aria-hidden="true" className={cn('inline-block shrink-0 overflow-hidden', className)} style={{ width: size, height: size }}>
      <span
        className="block origin-top-left [image-rendering:pixelated]"
        style={{
          width: source.cell,
          height: source.cell,
          background: `url(${source.url}) no-repeat ${source.coords.left}px ${source.coords.top}px`,
          transform: scale === 1 ? undefined : `scale(${scale})`,
        }}
      />
    </span>
  );
}
