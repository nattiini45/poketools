'use client';

import { useT } from '@/i18n/client';
import { shellMessages } from '@/i18n/messages/shell';
import { MAIN_CONTENT_ID } from '@/lib/ui/main-content';

/**
 * First focusable element of a site layout: hidden until it takes focus, then fixed above everything (including the
 * route world's canvas) so a keyboard user can jump past the NavBar. The target <main> carries 	abIndex={-1}.
 */
export default function SkipToContent() {
  const t = useT(shellMessages);
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[10000] focus:rounded-poke-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-heading focus:font-semibold focus:text-fg focus:shadow-poke-lg focus:outline-2 focus:outline-offset-2 focus:outline-transparent focus:ring-2 focus:ring-ring"
    >
      {t('skipToContent')}
    </a>
  );
}