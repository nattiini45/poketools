'use client';

/**
 * Small shared pieces of the admin panel: the panel card, the reason field
 * used by every audited action, and the inline notice / error lines.
 * Theme tokens only (no fixed dark fills).
 */
import { createContext, useContext, useId, type ReactNode } from 'react';
import type { ButtonVariant } from '@/components/ui/buttonStyles';
import { useT } from '@/i18n/client';
import { draftAdminMessages } from '@/i18n/messages/draft/admin';
import { cn } from '@/lib/utils/cn';
import { REASON_MAX } from './admin-view';

export const LABEL = 'block text-sm font-heading font-semibold text-poke-text-primary';
export const HINT = 'text-xs text-poke-text-secondary';
export const FIELD =
  'w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
export const TABLE = 'w-full text-left text-sm';
export const TH = 'px-2 py-1.5 text-xs font-semibold text-poke-text-secondary';
export const TD = 'px-2 py-1.5 align-top text-poke-text-primary';

/**
 * Where the admin controls render: the control page (`page`) or the draft
 * room's admin sheet (`room`). In the room, red means "drafted" only (draft
 * room design rule), so destructive actions (abort, void) use the amber
 * warning tone there instead of the red danger button.
 */
export type AdminSurface = 'page' | 'room';

const AdminSurfaceContext = createContext<AdminSurface>('page');

export function AdminSurfaceProvider({ surface, children }: { surface: AdminSurface; children: ReactNode }) {
  return <AdminSurfaceContext.Provider value={surface}>{children}</AdminSurfaceContext.Provider>;
}

export function useAdminSurface(): AdminSurface {
  return useContext(AdminSurfaceContext);
}

/** Amber outline for destructive actions inside the draft room (token with the theme fallback). */
const ROOM_DESTRUCTIVE =
  'border-[var(--draft-warn-ink,var(--poke-amber-ink))] bg-transparent text-[var(--draft-warn-ink,var(--poke-amber-ink))] shadow-none hover:border-[var(--draft-warn-ink,var(--poke-amber-ink))] hover:bg-poke-elevated';

/** Button props for a destructive action on the current surface (red danger on the page, amber in the room). */
export function useDestructiveButton(): { variant: ButtonVariant; className?: string } {
  return useAdminSurface() === 'room' ? { variant: 'secondary', className: ROOM_DESTRUCTIVE } : { variant: 'danger' };
}

/**
 * Neutral ink outline for the main action of a section inside the draft room
 * (start, save, publish). The theme accent of some worlds is red-ish, and in
 * the room red means "drafted" and violet is reserved for the DRAFT call to
 * action, so the room's primary buttons use the draft ink instead. Every token
 * carries a theme fallback: the armed confirms portal outside the room's
 * token scope.
 */
const ROOM_PRIMARY =
  'border-[var(--draft-ink,var(--poke-text-primary))] bg-transparent text-[var(--draft-ink,var(--poke-text-primary))] shadow-none hover:border-[var(--draft-ink,var(--poke-text-primary))] hover:bg-[var(--draft-elevated,var(--poke-elevated))]';

/** Button props for the main action on the current surface (theme accent on the page, neutral ink in the room). */
export function usePrimaryButton(): { variant: ButtonVariant; className?: string } {
  return useAdminSurface() === 'room' ? { variant: 'secondary', className: ROOM_PRIMARY } : { variant: 'primary' };
}

export function PanelCard({
  title,
  id,
  children,
  className,
}: {
  title: string;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn('rounded-poke-lg border border-poke-border bg-poke-elevated p-4 space-y-3', className)}
    >
      <h2 id={headingId} className="font-heading text-lg font-semibold text-poke-text-primary">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Required (or optional) reason textarea; the length hint shows for required fields. */
export function ReasonField({
  value,
  onChange,
  label,
  required = true,
  disabled = false,
}: {
  value: string;
  onChange(next: string): void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const t = useT(draftAdminMessages);
  const id = useId();
  const hintId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={LABEL}>
        {label ?? t('live.reason')}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={REASON_MAX}
        rows={2}
        required={required}
        disabled={disabled}
        aria-describedby={required ? hintId : undefined}
        className={FIELD}
      />
      {required ? (
        <p id={hintId} className={HINT}>
          {t('live.reasonHint')}
        </p>
      ) : null}
    </div>
  );
}

export function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-[var(--draft-warn-ink,var(--poke-amber-ink))]">
      {text}
    </p>
  );
}

export function InlineNotice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="text-sm text-poke-text-secondary">
      {text}
    </p>
  );
}
