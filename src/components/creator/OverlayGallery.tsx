'use client';

import { useT } from '@/i18n/client';
import { creatorMessages } from '@/i18n/messages/creator';

export default function OverlayGallery() {
  const t = useT(creatorMessages);
  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-5 shadow-poke-sm">
      <h2 className="text-sm font-heading font-bold text-poke-text-primary mb-3">
        {t('overlayGallery.title')}
      </h2>
      <div className="flex items-center justify-center py-8">
        <p className="text-xs text-poke-text-secondary">
          {t('overlayGallery.empty')}
        </p>
      </div>
    </div>
  );
}
