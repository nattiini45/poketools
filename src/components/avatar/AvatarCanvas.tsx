'use client';

import { useRef, useEffect } from 'react';
import type { AvatarConfig } from '@/types/avatar';
import { renderAvatar } from '@/lib/avatar/renderer';

interface AvatarCanvasProps {
  config: AvatarConfig;
  size?: number;
  className?: string;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

/**
 * Renders a layered avatar on an HTML canvas from an AvatarConfig.
 * Used in both the builder (large preview) and as a standalone display.
 */
export default function AvatarCanvas({
  config,
  size = 160,
  className = '',
  canvasRef: externalRef,
}: AvatarCanvasProps) {
  const internalRef = useRef<HTMLCanvasElement | null>(null);
  const ref = externalRef || internalRef;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    renderAvatar(ctx, config, size).catch(console.error);
  }, [config, size, ref]);

  return (
    <canvas
      ref={ref as React.RefObject<HTMLCanvasElement>}
      width={size}
      height={size}
      className={`rounded-poke-lg ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
