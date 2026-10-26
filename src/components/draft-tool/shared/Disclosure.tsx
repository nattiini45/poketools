'use client';

/**
 * A collapsible block of the left column (the compare tray, the team weakness overview): a native
 * `<details>` in a bordered box whose `<summary>` is the heading, so the browser supplies the keyboard and
 * screen-reader behaviour.
 *
 * Uncontrolled by default (`defaultOpen`). A parent that must change the state itself (the compare tray
 * opens when its first line arrives) passes `open` and `onOpenChange`: the browser's own toggles are reported
 * through `onOpenChange`, and the parent's value is written back to the element.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import styles from '../draft-tool.module.css';

export interface DisclosureProps {
  /** The always-visible heading (already translated). */
  summary: ReactNode;
  defaultOpen?: boolean;
  /** Controlled open state; pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  className?: string;
  children: ReactNode;
}

export default function Disclosure({ summary, defaultOpen, open, onOpenChange, className, children }: DisclosureProps) {
  return (
    <details
      className={cn('rounded-lg border border-[var(--draft-border)] p-2', className)}
      open={open ?? defaultOpen}
      onToggle={(e) => onOpenChange?.(e.currentTarget.open)}
    >
      <summary className={`${styles.focusable} cursor-pointer rounded text-sm font-semibold`}>{summary}</summary>
      {children}
    </details>
  );
}
