'use client';

import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import BottomSheet from '@/components/shared/BottomSheet';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';

/**
 * Lays out the replay filter form: one row on the elevated ground from 768 px up, and a bottom sheet behind a
 * button (with the number of active filters) on phones. The form itself is server-rendered and passed in; it is a
 * plain GET form, so the URL stays the only state.
 */
export default function ReplayFilters({
  label,
  activeCount,
  children,
}: {
  label: string;
  activeCount: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden rounded-poke-lg border border-hairline bg-elevated p-4 md:block">{children}</div>
      <div className="md:hidden">
        <Button type="button" variant="secondary" className="h-11 w-full" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {label}
          {activeCount > 0 && <SkewChip tone="accent">{activeCount}</SkewChip>}
        </Button>
        <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
          {children}
        </BottomSheet>
      </div>
    </>
  );
}
