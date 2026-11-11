import ItemIcon from '@/components/ui/ItemIcon';
import type { IconComponent } from '@/lib/fluid/icon-context';
import { ITEM_ICON_IDS, type ItemIconId } from '@/lib/pkmn/item-icons';

/**
 * The approved item icons as @fluid icon components, for the slots that take one (sidebar rows, command-menu rows).
 * @fluid asks for its 16 px icon size; item icons only render at whole multiples of 24 px, so the size is fixed.
 */
export const NAV_ICONS = Object.fromEntries(
  ITEM_ICON_IDS.map((item) => {
    const NavIcon: IconComponent = () => <ItemIcon item={item} />;
    NavIcon.displayName = `NavIcon(${item})`;
    return [item, NavIcon];
  }),
) as Record<ItemIconId, IconComponent>;
