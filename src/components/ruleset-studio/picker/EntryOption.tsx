'use client';

import { memo, type MouseEvent } from 'react';
import { Ban, Check, LockOpen, Minus, Plus } from 'lucide-react';
import TypeSprite from '@/components/shared/TypeSprite';
import { useT } from '@/i18n/client';
import { rulesetStudioPickerMessages } from '@/i18n/messages/ruleset-studio/picker';
import type { CatalogEntry } from '@/lib/pkmn/catalog-index';
import type { EntryState } from '@/lib/ruleset-kit/entry-state';
import { isLegalState } from '@/lib/ruleset-kit/entry-state';
import type { Room } from '@/lib/ruleset-studio/editor/picker/layout';
import { cn } from '@/lib/utils/cn';
import EntryArt from './EntryArt';
import StateChip, { STATE_STYLE } from './StateChip';

export type OptionDensity = 'grid' | 'compact';

export interface EntryOptionProps {
  entry: CatalogEntry;
  state: EntryState;
  density: OptionDensity;
  /** What a compact row has room for (the grid cards ignore it). */
  room: Room;
  selected: boolean;
  /** The keyboard's active entry (aria-activedescendant points at it). */
  active: boolean;
  /** The list has keyboard focus: only then is the active entry outlined. */
  listFocused: boolean;
  id: string;
  /** 1-based position and total, for screen readers (the list is virtualized). */
  position: number;
  setSize: number;
  /** The entry's index in the filtered order. */
  index: number;
  name: string;
  /** Localized tier of a Pokémon, the item category of an item. */
  tag: string;
  description: string | undefined;
  /** Allowlist mode: the toggle adds to and removes from the list instead of banning. */
  allowlist: boolean;
  onPick: (index: number, event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Grows a small control's touch target to 44px without growing its box (a row is a fixed height, see `layout.ts`): the
 * pseudo-element belongs to the control, so a tap on it reads as a tap on the control.
 */
const HIT_BOX = "relative after:absolute after:content-['']";
const HIT_SQUARE = `${HIT_BOX} after:-inset-3`;
const HIT_BAR = `${HIT_BOX} after:-inset-x-1 after:-inset-y-2`;

/** The one-line facts under an entry's name. */
function Facts({ entry, tag }: { entry: CatalogEntry; tag: string }) {
  switch (entry.kind) {
    case 'species':
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="flex items-center gap-0.5">
            {entry.types.map((type) => (
              <TypeSprite key={type} type={type} size={12} />
            ))}
          </span>
          <span className="truncate text-[11px] text-poke-text-muted">
            {tag} · {entry.bst}
          </span>
        </span>
      );
    case 'moves':
      return (
        <span className="truncate text-[11px] text-poke-text-muted">
          {entry.power > 0 ? entry.power : '–'} · {entry.accuracy === null ? '∞' : entry.accuracy} · {entry.pp}
        </span>
      );
    case 'items':
      return <span className="truncate text-[11px] text-poke-text-muted">{tag}</span>;
    default:
      return null;
  }
}

/**
 * One entry of the picker as a listbox option (the card of the grid density, the line of the compact one). The whole
 * option is the click target of the list; the pieces marked `data-pick` say what a click means (the toggle button bans or
 * unbans, the check box selects, anything else makes the entry active). Everything inside is presentational for assistive
 * tech: the option's name says "<name>, <state>", and the keyboard model (B, U, R, Space) does what the buttons do.
 * Memoised: a keystroke in the search rebuilds the view, but an unchanged option does not re-render.
 */
function EntryOptionView({ entry, state, density, room, selected, active, listFocused, id, position, setSize, index, name, tag, description, allowlist, onPick }: EntryOptionProps) {
  const t = useT(rulesetStudioPickerMessages);
  const style = STATE_STYLE[state];
  const stateLabel = t(`state.${state}`);
  const legal = isLegalState(state);
  const ActionIcon = allowlist ? (legal ? Minus : Plus) : legal ? Ban : state === 'preset_banned' || state === 'you_unbanned' ? LockOpen : Check;
  const actionLabel = allowlist ? (legal ? t('action.disallowShort') : t('action.allowShort')) : legal ? t('action.banShort') : t('action.unbanShort');
  const actionName = allowlist ? (legal ? t('action.disallow', { name }) : t('action.allow', { name })) : legal ? t('action.ban', { name }) : t('action.unban', { name });

  const outline = active && listFocused ? 'outline outline-2 outline-offset-1 outline-poke-focus' : '';
  const frame = cn(
    'group/option relative flex h-full w-full min-w-0 cursor-pointer select-none overflow-hidden rounded-poke-md border text-left transition-colors duration-150',
    style.card,
    selected && 'ring-2 ring-poke-accent',
    active && !listFocused && 'border-poke-border-strong',
    'hover:border-poke-border-strong',
    outline,
  );

  const select = (
    <span
      data-pick="select"
      aria-hidden="true"
      title={t('card.select', { name })}
      className={cn(
        // The 20px box keeps the card compact; its pseudo-element is the 44px touch target (the card clips it at its edge).
        HIT_SQUARE,
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
        selected ? 'border-poke-accent bg-poke-accent text-poke-surface' : 'border-poke-border-strong bg-poke-surface text-transparent group-hover/option:text-poke-text-muted',
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </span>
  );

  const toggle = (
    <span
      data-pick="toggle"
      aria-hidden="true"
      title={actionName}
      className={cn(
        HIT_BAR,
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-poke-md border px-2 text-xs font-semibold transition-colors',
        legal
          ? 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-danger/50 hover:bg-poke-danger-light hover:text-poke-danger'
          : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-green/50 hover:bg-poke-green-light hover:text-poke-green',
      )}
    >
      <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className={density === 'compact' && room === 'tight' ? 'hidden' : ''}>{actionLabel}</span>
    </span>
  );

  const flags =
    entry.kind === 'species' && entry.future ? (
      <span className="shrink-0 rounded border border-poke-border px-1 text-[10px] text-poke-text-muted">{t('card.future')}</span>
    ) : null;

  const shared = {
    id,
    role: 'option' as const,
    'aria-selected': selected,
    'aria-posinset': position,
    'aria-setsize': setSize,
    'aria-label': t('card.name', { name, state: stateLabel }),
    'data-index': index,
    'data-state': state,
    onClick: (event: MouseEvent<HTMLDivElement>) => onPick(index, event),
  };

  if (density === 'compact') {
    return (
      <div {...shared} className={cn(frame, 'items-center gap-2 px-2')}>
        {select}
        <EntryArt entry={entry} size="row" className={style.art} />
        <span className="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-poke-text-primary" title={name}>
          {name}
        </span>
        {room === 'roomy' && (
          <span className="flex min-w-0 shrink items-center gap-2">
            <Facts entry={entry} tag={tag} />
          </span>
        )}
        {flags}
        {room === 'tight' ? <StateChip state={state} label={stateLabel} iconOnly /> : <StateChip state={state} label={stateLabel} className="max-w-[9rem]" />}
        {toggle}
      </div>
    );
  }

  return (
    <div {...shared} className={cn(frame, 'flex-col gap-1 p-2')}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <EntryArt entry={entry} size="card" className={style.art} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-start justify-between gap-1">
            <span className="min-w-0 truncate font-heading text-sm font-semibold leading-5 text-poke-text-primary" title={name}>
              {name}
            </span>
            {select}
          </div>
          <Facts entry={entry} tag={tag} />
          {description !== undefined && entry.kind !== 'species' && (
            <span className="line-clamp-2 text-[11px] leading-4 text-poke-text-secondary">{description}</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <StateChip state={state} label={stateLabel} />
          {flags}
        </span>
        {toggle}
      </div>
    </div>
  );
}

const EntryOption = memo(EntryOptionView);
export default EntryOption;
