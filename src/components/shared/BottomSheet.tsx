'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from '@/components/shared/motion';

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

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  height = 'auto',
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const isDragging = useRef(false);

  // Close on escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  const handleDragStart = (e: React.TouchEvent | React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
  };

  const handleDragEnd = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const endY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
    const delta = endY - dragStartY.current;
    if (delta > 100) onClose(); // Dragged down > 100px
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-poke-surface border-t border-poke-border
              rounded-t-2xl shadow-poke-lg flex flex-col overflow-hidden"
            style={{ maxHeight: HEIGHT_MAP[height], height: height === 'auto' ? undefined : HEIGHT_MAP[height] }}
          >
            {/* Drag handle */}
            <div
              className="flex justify-center py-2 cursor-grab active:cursor-grabbing shrink-0"
              onTouchStart={handleDragStart}
              onTouchEnd={handleDragEnd}
              onMouseDown={handleDragStart}
              onMouseUp={handleDragEnd}
            >
              <div className="w-10 h-1 rounded-full bg-poke-border" />
            </div>

            {/* Title */}
            {title && (
              <div className="px-4 pb-2 border-b border-poke-border shrink-0">
                <h3 className="font-heading font-semibold text-poke-text-primary text-sm">{title}</h3>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
