import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ItemIcon from '@/components/ui/ItemIcon';
import Select from '@/components/ui/Select';
import type { ItemIconId } from '@/lib/pkmn/item-icons';
import { cn } from '@/lib/utils/cn';

/**
 * Layout pieces the wiki and Pokémon pages share (universal: no hooks, so server pages and client widgets both
 * render them). Direction B: sunken hero panels, hairline sections with a pixel-face title, scoreboard numbers.
 */

/** A page section on the page ground: a strong hairline, the title in the pixel face, one optional item icon. */
export function WikiSection({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ItemIconId;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-4 border-t border-hairline-strong pt-6', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {icon && <ItemIcon item={icon} size={24} />}
          <h2 className="font-heading text-title text-fg">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The entry header: a sunken arena panel that holds the name, its chips and the key numbers. */
export function WikiHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-poke-xl border border-hairline bg-sunken p-5 sm:p-6', className)}>{children}</div>
  );
}

/** The link back to an index. `label` is the translated text without an arrow glyph; the icon carries it. */
export function WikiBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-poke-sm text-caption font-[550] text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
    >
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}

export interface WikiStat {
  label: string;
  value: ReactNode;
}

/** Key numbers as one hairline-divided strip: the value in the pixel face, its label under it. */
export function WikiStatStrip({ stats, className }: { stats: readonly WikiStat[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid gap-px overflow-hidden rounded-poke-lg border border-hairline bg-hairline',
        className,
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col-reverse items-center gap-0.5 bg-surface px-2 py-3 text-center">
          <dt className="text-caption text-fg-muted">{stat.label}</dt>
          <dd className="font-heading text-title tabular-nums text-fg">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Nothing here yet: the Poké Doll, a pixel-face title, one sentence on what happens next, and its action. */
export function WikiEmptyState({
  title,
  hint,
  action,
  role,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div
      role={role}
      className="flex flex-col items-center gap-2 rounded-poke-lg border border-hairline bg-surface px-5 py-8 text-center"
    >
      <ItemIcon item="poke-doll" size={72} />
      <p className="font-heading text-title text-fg">{title}</p>
      {hint && <p className="max-w-prose text-body text-fg-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** One usage bar: the name, a track on the sunken ground with the amber fill, and the share in mono. */
export function WikiUsageBar({ label, percent, value }: { label: string; percent: number; value: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
      <span className="truncate text-body font-[550] text-fg">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-sunken">
        <span className="block h-full rounded-full bg-accent-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </span>
      <span className="min-w-14 text-right font-mono text-caption tabular-nums text-fg-muted">{value}</span>
    </li>
  );
}

export interface WikiDefinition {
  key: string;
  term: ReactNode;
  children: ReactNode;
}

/** Entry data as a compact definition grid: the term in the left column, hairlines between rows. */
export function WikiDefinitionList({ rows }: { rows: readonly WikiDefinition[] }) {
  return (
    <dl className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid gap-1 border-b border-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="text-caption font-[550] text-fg-muted sm:pt-0.5">{row.term}</dt>
          <dd className="max-w-[72ch] text-body text-fg">{row.children}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The site Select with a caption label wired to it (the scope and player filters of the usage widgets). */
export function WikiSelect({
  label,
  className,
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { label: string }) {
  const id = useId();
  return (
    <div className={cn('flex min-w-40 flex-1 flex-col gap-1 sm:max-w-56', className)}>
      <label htmlFor={id} className="text-caption text-fg-muted">
        {label}
      </label>
      {/* The primitive leaves its field gap under the control when it shows no message; the filter row aligns on the control. */}
      <div className="-mb-1.5">
        <Select id={id} className="h-9 py-1" {...props}>
          {children}
        </Select>
      </div>
    </div>
  );
}
