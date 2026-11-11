'use client';

import ItemIcon from '@/components/ui/ItemIcon';
import { useT } from '@/i18n/client';
import { creatorMessages } from '@/i18n/messages/creator';

export default function OverlayGallery() {
  const t = useT(creatorMessages);
  return (
    <section className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
      <h2 className="border-b border-hairline bg-elevated px-5 py-3 font-heading text-title text-fg">{t('overlayGallery.title')}</h2>
      <div className="flex items-center gap-4 px-5 py-6">
        <ItemIcon item="poke-doll" size={48} />
        <p className="text-body text-fg-muted">{t('overlayGallery.empty')}</p>
      </div>
    </section>
  );
}
