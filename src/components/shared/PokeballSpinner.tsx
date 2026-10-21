'use client';

import Pokeball from '@/components/shared/Pokeball';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

/**
 * Loading indicator: the Pokéball mark on a slow spin. Transform-only
 * animation; reduced motion swaps to a static ball so feedback never
 * disappears entirely. A cheap client leaf (i18n-core §1.7 rule 2), so the
 * server `loading.tsx` files can render it; `label` overrides the localized
 * "Loading".
 */
export default function PokeballSpinner({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const t = useT(uiMessages);
  const text = label ?? t('spinner.label');
  return (
    <div
      role="status"
      aria-label={text}
      className={cn('flex flex-col items-center justify-center gap-3 py-16', className)}
    >
      <span className="animate-spin motion-reduce:animate-none [animation-duration:1.6s]">
        <Pokeball className="h-10 w-10" />
      </span>
      <span className="text-xs font-heading font-semibold uppercase tracking-wide text-poke-text-muted">
        {t('spinner.visible', { label: text })}
      </span>
    </div>
  );
}
