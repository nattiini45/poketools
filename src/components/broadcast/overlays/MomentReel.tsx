'use client';

import { useEffect, useState } from 'react';
import AnimatedReveal from '../shared/AnimatedReveal';
import OverlayMomentBanner from '../shared/OverlayMomentBanner';
import BrandWatermark from '../shared/BrandWatermark';
import type { OverlayConfig, EnrichedMatchState, BroadcastMoment } from '@/types/broadcast';
import { useT } from '@/i18n/client';
import { broadcastOverlaysMessages } from '@/i18n/messages/broadcast-overlays';

interface MomentReelProps {
  config: OverlayConfig;
  matchId: string;
}

/**
 * Auto-cycling broadcast moments overlay.
 * Displays each moment for 5 seconds with type-colored presentation.
 */
export default function MomentReel({ config, matchId }: MomentReelProps) {
  const t = useT(broadcastOverlaysMessages);
  const [moments, setMoments] = useState<BroadcastMoment[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/broadcast/state/${matchId}`);
      const json = await res.json();
      if (!json.success) return;
      const state: EnrichedMatchState = json.data;
      setMoments(state.recent_moments);
    }
    load();
  }, [matchId]);

  useEffect(() => {
    if (moments.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % moments.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [moments.length]);

  if (moments.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div style={{ color: 'var(--broadcast-text-muted)' }}>{t('reel.empty')}</div>
      </div>
    );
  }

  const moment = moments[currentIndex];

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center p-8 gap-6">
      <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--broadcast-text-muted)' }}>
        {t('reel.title', { current: currentIndex + 1, total: moments.length })}
      </div>

      <AnimatedReveal key={moment.id} animation="fadeIn">
        <OverlayMomentBanner moment={moment} />
      </AnimatedReveal>

      <BrandWatermark text={config.brand} position={config.brandpos} />
    </div>
  );
}
