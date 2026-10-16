import type { BrandPosition } from '@/types/broadcast';

interface BrandWatermarkProps {
  text: string;
  position: BrandPosition;
}

const POSITION_STYLES: Record<BrandPosition, React.CSSProperties> = {
  tl: { top: 16, left: 16 },
  tr: { top: 16, right: 16 },
  bl: { bottom: 16, left: 16 },
  br: { bottom: 16, right: 16 },
};

/**
 * Configurable corner branding for broadcast overlays.
 * Renders as a subtle, semi-transparent text in the specified corner.
 */
export default function BrandWatermark({ text, position }: BrandWatermarkProps) {
  if (!text) return null;

  return (
    <div
      style={{
        position: 'absolute',
        ...POSITION_STYLES[position],
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--broadcast-text-muted)',
        opacity: 0.6,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {text}
    </div>
  );
}
