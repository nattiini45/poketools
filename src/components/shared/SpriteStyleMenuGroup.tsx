'use client';

import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { spriteStyleMessages } from '@/i18n/messages/sprite-style';
import SpriteStyleOptions from './SpriteStyleOptions';
import { useSpriteStyleChange } from './sprite-style-client';

/**
 * The sprite-style choice in the NavBar language menu and the mobile drawer
 * (docs/pkmn.md, "Sprite styles"): the anonymous entry point. A choice applies
 * at once and is saved by `POST /api/sprite-style` (cookie; also the account
 * when signed in); a failed save reverts it and says why.
 */
export function SpriteStyleMenuGroup({ name, legendClassName }: { name: string; legendClassName?: string }) {
  const t = useT(spriteStyleMessages);
  const errorText = useApiErrorText();
  const { preference, pending, failed, change } = useSpriteStyleChange();
  return (
    <div aria-busy={pending || undefined}>
      <SpriteStyleOptions
        name={name}
        variant="compact"
        legendClassName={legendClassName}
        value={preference}
        onChange={(next) => void change(next)}
      />
      {failed && (
        <p role="alert" className="px-2 pt-2 text-xs text-poke-danger-ink">
          {failed.code ? errorText(failed) : t('saveFailed')}
        </p>
      )}
    </div>
  );
}
