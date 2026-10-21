'use client';

/**
 * A section that collapses on phones only (draft-frontend §5.3 phone items 3
 * and 8: the "Selected" card, "My roster", "Last picks"). Below 768 px a
 * full-width toggle (≥ 44 px, `aria-expanded`) shows or hides the body. From
 * 768 px the toggle is hidden and the wrapper and body are `display:
 * contents`, so the children lay out as if the wrapper were not there.
 */
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from '../draft-tool.module.css';

export interface PhoneSectionProps {
  /** The toggle label (already translated). */
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

export default function PhoneSection({ title, children, defaultOpen = true }: PhoneSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={styles.phoneSection}>
      <button
        type="button"
        className={`${styles.phoneToggle} ${styles.focusable}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="min-w-0 truncate">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <div id={bodyId} className={open ? styles.phoneBody : `${styles.phoneBody} ${styles.phoneBodyCollapsed}`}>
        {children}
      </div>
    </div>
  );
}
