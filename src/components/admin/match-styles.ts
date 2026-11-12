/**
 * Class recipes shared by the admin match pages (redesign A11): the list, the match detail with its actions rail,
 * the game editor and the replay import. Direction B's calm end: surfaces with hairlines, one amber accent, body
 * text in Geist Sans, numbers in the pixel face.
 */

/** The admin track's focus ring (never `outline-none` followed by `outline-2`: Tailwind 4 leaves the style at none). */
export const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

/** An inline text link in the accent ink. */
export const TEXT_LINK = `rounded-sm font-[550] text-accent-ink underline-offset-2 hover:underline ${FOCUS}`;

/** A text-sized control is a full 44 px target on a phone. */
export const TOUCH = 'min-h-11 sm:min-h-0';

/** A fact in a `<dl>`: a caption label over its value. */
export const FACT_LABEL = 'text-caption text-fg-muted';
export const FACT_VALUE = 'mt-0.5 break-words text-body text-fg';

/** The label of a control that is not one of the `Input` / `Textarea` primitives (which draw their own). */
export const FIELD_LABEL = 'block text-caption font-medium text-fg';

/** A pick among a few options (winner, outcome): a bordered choice that fills with the selected wash. */
export const CHOICE = `inline-flex min-h-11 items-center justify-center gap-2 rounded-poke-md border px-3 py-2 text-body motion-safe:transition-colors motion-safe:duration-80 sm:min-h-9 ${FOCUS}`;
export const CHOICE_ON = 'border-transparent bg-tier-1 font-[550] text-tier-ink';
export const CHOICE_OFF = 'border-hairline-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg';

/** A row inside a card: a game, a history entry. */
export const INSET_ROW = 'rounded-poke-md border border-hairline bg-elevated px-3 py-2';

/** The link or button around a skewed action plate: the plate brightens on hover and dips when pressed. */
export const PLATE_TARGET =
  'inline-flex max-w-full rounded-sm active:translate-y-px [&_.skew-plate-bg]:motion-safe:transition-[filter] [&_.skew-plate-bg]:motion-safe:duration-80 hover:[&_.skew-plate-bg]:brightness-105 active:[&_.skew-plate-bg]:brightness-95';

/** The plate itself: 44 px tall on a phone, 36 px from `sm` up; the label never wraps or gets a fixed width. */
export const PLATE = 'min-h-11 whitespace-nowrap px-4 text-body sm:min-h-9';

/**
 * Native buttons whose label is their only child (tests and the bulk bar read them that way), so they cannot wrap
 * the label in the `Button` or `SkewPlate` primitives. `NATIVE_PLATE` draws the amber skewed plate behind the label
 * with a pseudo-element; the focus ring follows the plate.
 */
const NATIVE_BASE = 'inline-flex items-center justify-center gap-2 whitespace-nowrap text-body disabled:cursor-not-allowed disabled:opacity-50';
export const NATIVE_PLATE = `${NATIVE_BASE} relative isolate px-4 font-[550] text-tier-ink active:translate-y-px before:absolute before:inset-0 before:-z-1 before:rounded-[3px] before:bg-accent-fill before:[transform:skewX(var(--skew))] before:motion-safe:transition-[filter] before:motion-safe:duration-80 hover:before:brightness-105 focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-solid focus-visible:before:outline-offset-2 focus-visible:before:outline-[var(--focus-ring)]`;
export const NATIVE_SECONDARY = `${NATIVE_BASE} rounded-poke-md border border-hairline-strong bg-surface px-3 text-fg hover:bg-hover motion-safe:transition-colors motion-safe:duration-80 ${FOCUS}`;
export const NATIVE_GHOST = `${NATIVE_BASE} rounded-poke-md px-3 text-fg-muted hover:bg-hover hover:text-fg motion-safe:transition-colors motion-safe:duration-80 ${FOCUS}`;

/** A destructive lifecycle action (delete, reset): an outline in the danger colour, never a solid red fill. */
export const DANGER_OUTLINE = 'border-poke-danger bg-transparent text-poke-danger-ink shadow-none hover:bg-poke-danger-light';

/** An informational callout in the warm family, replacing the legacy blue `Alert` info tint. */
export const INFO_CALLOUT = 'border-hairline bg-elevated text-fg';
