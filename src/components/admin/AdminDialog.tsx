'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/fluid/dialog';
import { FOCUS } from '@/components/admin/match-styles';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';
import { cn } from '@/lib/utils/cn';

interface AdminDialogProps {
  open: boolean;
  /** Asked for by Escape, the scrim and the close button; the caller decides (a running request keeps it open). */
  onClose: () => void;
  title: string;
  /** sm 400 px, md 540 px, lg 672 px; never wider than the viewport minus its margin. */
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const WIDTH = { sm: 'sm', md: 'lg', lg: 'lg' } as const;

/**
 * The admin pages' dialog on the @fluid dialog (docs/design.md, "Fluid primitives"): its spring, scrim and focus
 * handling, with the site's own frame inside. The title sits in the pixel face over a hairline like a section
 * header, the close button comes before the content (so the last control is the dialog's own action), and the body
 * scrolls on its own when the dialog is taller than the viewport, so title and buttons stay in reach on a phone.
 */
export default function AdminDialog({ open, onClose, title, size = 'md', children }: AdminDialogProps) {
  const t = useT(uiMessages);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        size={WIDTH[size]}
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn('flex max-h-[calc(100dvh-2rem)] flex-col p-0', size === 'lg' && 'max-w-[42rem]')}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-3">
          <DialogTitle className="min-w-0 font-heading text-title text-fg">{title}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t('modal.close')}
              className={cn('-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-poke-md text-fg-muted hover:bg-hover hover:text-fg sm:size-8', FOCUS)}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </DialogClose>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
