import { Ban, Check, CircleSlash, Lock, LockOpen, type LucideIcon } from 'lucide-react';
import type { EntryState } from '@/lib/ruleset-kit/entry-state';

/**
 * Colour and glyph per state. The state is never colour alone: every chip carries a glyph and (unless `iconOnly`, where
 * the surrounding control names it) the state's words. Tokens only, so both themes work; no fixed dark fills.
 */
export const STATE_STYLE: Record<EntryState, { chip: string; icon: string; card: string; art: string; Icon: LucideIcon }> = {
  legal: {
    chip: 'border-hairline bg-surface text-fg-muted',
    icon: 'text-fg-muted',
    card: 'border-hairline bg-surface',
    art: '',
    Icon: Check,
  },
  allowed: {
    chip: 'border-poke-green/40 bg-poke-green-light text-fg',
    icon: 'text-poke-green',
    card: 'border-poke-green/40',
    art: '',
    Icon: Check,
  },
  you_unbanned: {
    chip: 'border-poke-green/40 bg-poke-green-light text-fg',
    icon: 'text-poke-green',
    card: 'border-poke-green/50',
    art: '',
    Icon: LockOpen,
  },
  you_banned: {
    chip: 'border-loss bg-poke-danger-light text-fg',
    icon: 'text-loss',
    card: 'border-loss',
    art: 'opacity-70',
    Icon: Ban,
  },
  preset_banned: {
    chip: 'border-hairline bg-sunken text-fg-muted',
    icon: 'text-fg-muted',
    card: 'border-hairline',
    art: 'opacity-60 grayscale',
    Icon: Lock,
  },
  not_allowed: {
    chip: 'border-dashed border-hairline-strong bg-sunken text-fg-muted',
    icon: 'text-fg-muted',
    card: 'border-dashed border-hairline-strong',
    art: 'opacity-50 grayscale',
    Icon: CircleSlash,
  },
};

interface StateChipProps {
  state: EntryState;
  /** The state's words in the viewer's language. */
  label: string;
  /** Draw the glyph only; the caller names the state some other way (a button label). */
  iconOnly?: boolean;
  className?: string;
}

export default function StateChip({ state, label, iconOnly = false, className = '' }: StateChipProps) {
  const { chip, icon, Icon } = STATE_STYLE[state];
  return (
    <span
      data-state={state}
      className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 ${chip} ${className}`}
    >
      <Icon className={`h-3 w-3 shrink-0 ${icon}`} aria-hidden="true" />
      {iconOnly ? <span className="sr-only">{label}</span> : <span className="truncate">{label}</span>}
    </span>
  );
}
