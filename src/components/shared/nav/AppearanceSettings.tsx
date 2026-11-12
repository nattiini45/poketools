'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useT } from '@/i18n/client';
import { navMessages } from '@/i18n/messages/nav';
import { PalettePickerSection } from '../PalettePicker';
import { SpriteStyleMenuGroup } from '../SpriteStyleMenuGroup';

const subscribe = () => () => {};

/** The legend of every group in the site menus. */
export const MENU_LEGEND = 'pb-1.5 text-caption font-[550] text-fg-muted';

const THEME_OPTION =
  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-poke-md border border-hairline px-3 text-body text-fg ' +
  'transition-colors duration-[80ms] hover:bg-hover has-[:checked]:border-hairline-strong has-[:checked]:bg-accent-subtle ' +
  'has-[:checked]:font-[550] has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ' +
  'has-[:focus-visible]:outline-accent-ink lg:min-h-9';

/**
 * Appearance in the account menu and the signed-out drawer: sunlit or moonlit, the site palette and the sprite
 * style. `name` keeps the radio groups of two mounted copies apart.
 */
export default function AppearanceSettings({ name }: { name: string }) {
  const t = useT(navMessages);
  const { resolvedTheme, setTheme } = useTheme();
  // The theme is only known in the browser: nothing is checked on the server render.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const current = mounted ? resolvedTheme : undefined;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className={MENU_LEGEND}>{t('account.theme')}</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {(['light', 'dark'] as const).map((theme) => (
            <label key={theme} className={THEME_OPTION}>
              <input
                type="radio"
                className="sr-only"
                name={`${name}-theme`}
                value={theme}
                checked={current === theme}
                onChange={() => setTheme(theme)}
              />
              {theme === 'light' ? <Sun aria-hidden="true" className="size-4" /> : <Moon aria-hidden="true" className="size-4" />}
              {t(theme === 'light' ? 'account.sunlit' : 'account.moonlit')}
            </label>
          ))}
        </div>
      </fieldset>
      <PalettePickerSection name={`${name}-palette`} legendClassName={MENU_LEGEND} />
      <SpriteStyleMenuGroup name={`${name}-sprite-style`} legendClassName={MENU_LEGEND} />
    </div>
  );
}
