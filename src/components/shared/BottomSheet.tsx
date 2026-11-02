'use client';

import { type ReactNode, type TouchEvent, type MouseEvent, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { uiMessages } from '@/i18n/messages/ui';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  height?: 'half' | 'full' | 'auto';
}

const HEIGHT_MAP = {
  half: '50vh',
  full: '90vh',
  auto: 'auto',
};

/** The slide is dropped (the fade stays) for viewers who asked for reduced motion. */
const SHEET_ANIMATION =
  'duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:slide-out-to-bottom-0';

/**
 * Bottom sheet on the same Radix dialog as `Modal`: dialog role named by the title, focus moved in and trapped,
 * Escape, scroll lock and focus restore come from Radix. The handle's swipe-down gesture and the close button are the
 * two touch/pointer ways out besides Escape and the backdrop.
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  height = 'auto',
}: BottomSheetProps) {
  const t = useT(uiMessages);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const handleDragStart = (e: TouchEvent | MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
  };

  const handleDragEnd = (e: TouchEvent | MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const endY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
    const delta = endY - dragStartY.current;
    if (delta > 100) onClose(); // Dragged down > 100px
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <Dialog.Content
          aria-describedby={undefined}
          // Radix hands focus back only to a `Dialog.Trigger`; this sheet is opened by state from elsewhere, so it
          // remembers the focused element itself.
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            openerRef.current = null;
            if (opener?.isConnected) opener.focus();
          }}
          className={`fixed bottom-0 left-0 right-0 z-50 bg-poke-surface border-t border-poke-border rounded-t-2xl shadow-poke-lg flex flex-col overflow-hidden ${SHEET_ANIMATION}`}
          style={{ maxHeight: HEIGHT_MAP[height], height: height === 'auto' ? undefined : HEIGHT_MAP[height] }}
        >
          {/* Drag handle: touch and mouse only; the close button below is the keyboard way out. */}
          <div
            data-bottom-sheet-handle=""
            className="flex justify-center py-2 cursor-grab active:cursor-grabbing shrink-0"
            onTouchStart={handleDragStart}
            onTouchEnd={handleDragEnd}
            onMouseDown={handleDragStart}
            onMouseUp={handleDragEnd}
          >
            <div className="w-10 h-1 rounded-full bg-poke-border" />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4 px-4 pb-2 border-b border-poke-border">
            <Dialog.Title
              className={title ? 'font-heading font-semibold text-poke-text-primary text-sm' : 'sr-only'}
            >
              {title ?? t('modal.untitled')}
            </Dialog.Title>
            <Dialog.Close
              className="ml-auto shrink-0 rounded-poke-sm p-1 text-poke-text-muted transition-colors hover:text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t('modal.close')}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
