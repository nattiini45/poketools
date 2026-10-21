import Link from 'next/link';

export interface GroupPoolPickerOption {
  groupId: string;
  /** Already translated (`translateEngineLabel('group', …)`). */
  label: string;
  /** The page with that group's default pool (`?pool=<id>`). */
  href: string;
  /** The group shown now. */
  current: boolean;
  /** The viewer's own group. */
  mine: boolean;
}

export interface GroupPoolPickerLabels {
  /** `<nav>` landmark name. */
  nav: string;
  /** Suffix of the viewer's own group. */
  mine: string;
  /** The line above the switch (which group is shown). */
  showing: string;
  /** Set when the viewer's group has no draft yet. */
  mineHasNoPool?: string;
  /**
   * Set when a trainer of the league looks at another group's draft: they follow it, but pick only in their own
   * group's draft (the snapshot seats them nowhere here, so the room shows no pick controls).
   */
  readOnly?: string;
}

interface GroupPoolPickerProps {
  options: readonly GroupPoolPickerOption[];
  labels: GroupPoolPickerLabels;
}

/**
 * The group switch of the draft room and the redraft page in a league that drafts per group (league groups design
 * §7): one link per group that has a draft, the shown group marked `aria-current`. Plain links (`?pool=`), so it
 * works without JavaScript, keeps the browser history and needs no client state; a server component passes the
 * translated labels.
 *
 * Switching is open to everyone (boards are public, lead ruling round 4); another group's draft is read-only for a
 * trainer of the league (`labels.readOnly` says so; the server seats nobody outside the group, so no pick control
 * renders and every pick route refuses NOT_PARTICIPANT).
 *
 * Colours: the draft tokens with the palette fallbacks (`--draft-*` exist only inside the draft tool's own scope;
 * here, in the page header, the `--poke-*` fallbacks apply). Only the shown group's chip has a fill: the elevated
 * surface token (theme-aware in light and dark, never a fixed dark box). No red, no violet (those belong to drafted
 * lines and the DRAFT call to action). Touch targets are 44px; the colour transition runs only when the viewer
 * allows motion (`motion-safe:`).
 */
export default function GroupPoolPicker({ options, labels }: GroupPoolPickerProps) {
  if (options.length < 2) return null;
  return (
    <nav aria-label={labels.nav} className="mt-3 space-y-2">
      <p className="text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
        {labels.mineHasNoPool ? `${labels.mineHasNoPool} ` : ''}
        {labels.showing}
      </p>
      {labels.readOnly ? (
        <p role="note" className="text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]">
          {labels.readOnly}
        </p>
      ) : null}
      <ul className="flex flex-wrap gap-2">
        {options.map((option) => (
          <li key={option.groupId} className="max-w-full">
            <Link
              href={option.href}
              aria-current={option.current ? 'page' : undefined}
              className={
                'inline-flex min-h-11 max-w-full items-center rounded-full border px-4 py-1 text-sm font-heading ' +
                'break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
                'focus-visible:outline-[var(--draft-accent,var(--poke-focus))] motion-safe:transition-colors ' +
                (option.current
                  ? 'border-[var(--draft-accent,var(--poke-accent))] bg-[var(--draft-elevated,var(--poke-elevated))] font-semibold text-[var(--draft-ink,var(--poke-text-primary))]'
                  : 'border-[var(--draft-border,var(--poke-border))] text-[var(--draft-ink-2,var(--poke-text-secondary))] hover:border-[var(--draft-accent,var(--poke-accent))] hover:text-[var(--draft-ink,var(--poke-text-primary))]')
              }
            >
              {option.label}
              {option.mine ? <span className="ml-1 font-normal">({labels.mine})</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
