'use client';

import Image from 'next/image';
import type { AvatarGender, AvatarLayerKey } from '@/types/avatar';
import type { AvatarCategory, AvatarColorVariant } from '@/lib/avatar/manifest';
import { avatarColorLabel, avatarMessageKey, getAvatarAssetUrl } from '@/lib/avatar/manifest';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import { avatarWardrobeMessages } from '@/i18n/messages/avatar/wardrobe';

interface AvatarCategoryPickerProps {
  gender: AvatarGender;
  category: AvatarCategory;
  selectedOptionId: string | null;
  onSelect: (optionId: string | null) => void;
}

/**
 * Grid of selectable options for a single avatar category.
 * Groups options by style, with color variants shown as a grid within each style.
 */
export default function AvatarCategoryPicker({
  gender,
  category,
  selectedOptionId,
  onSelect,
}: AvatarCategoryPickerProps) {
  const t = useT(avatarMessages);
  const tw = useT(avatarWardrobeMessages);
  const isSingleStyle = category.styles.length === 1;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-heading font-bold text-poke-text-primary">
          {tw.dynamic(`categories.${avatarMessageKey(category.id)}`, undefined, category.label)}
        </h3>
        {!category.required && (
          <span className="text-xs text-poke-text-muted">{t('builder.optional')}</span>
        )}
      </div>

      {/* "None" option for optional categories */}
      {!category.required && (
        <div className="mb-4">
          <button
            onClick={() => onSelect(null)}
            className={`
              relative w-14 h-14 rounded-poke-md border-2 transition-all duration-150
              flex items-center justify-center
              ${selectedOptionId === null
                ? 'border-poke-accent bg-poke-accent-light shadow-poke-sm'
                : 'border-poke-border bg-poke-surface hover:border-poke-text-muted'
              }
            `}
          >
            <span className="text-xs text-poke-text-muted font-heading">{t('builder.none')}</span>
          </button>
        </div>
      )}

      {/* Style groups */}
      <div className="space-y-4">
        {category.styles.map((style) => (
          <div key={style.id}>
            {/* Style label (skip for single-style categories like skin tone) */}
            {!isSingleStyle && (
              <h4 className="text-xs font-heading font-semibold text-poke-text-secondary mb-2">
                {tw.dynamic(`styles.${avatarMessageKey(style.id)}`, undefined, style.label)}
              </h4>
            )}

            {/* Color variant grid */}
            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {style.variants.map((variant) => (
                <VariantButton
                  key={variant.optionId}
                  gender={gender}
                  categoryId={category.id}
                  variant={variant}
                  isSelected={selectedOptionId === variant.optionId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Individual variant thumbnail button. */
function VariantButton({
  gender,
  categoryId,
  variant,
  isSelected,
  onSelect,
}: {
  gender: AvatarGender;
  categoryId: string;
  variant: AvatarColorVariant;
  isSelected: boolean;
  onSelect: (optionId: string) => void;
}) {
  const tw = useT(avatarWardrobeMessages);
  const src = getAvatarAssetUrl(gender, categoryId as AvatarLayerKey, variant.filename);
  const label = tw.dynamic(`colors.${avatarMessageKey(variant.color)}`, undefined, avatarColorLabel(variant.color));

  return (
    <button
      onClick={() => onSelect(variant.optionId)}
      title={label}
      className={`
        relative w-14 h-14 rounded-poke-md border-2 transition-all duration-150
        overflow-hidden
        ${isSelected
          ? 'border-poke-accent bg-poke-accent-light shadow-poke-sm scale-105'
          : 'border-poke-border bg-poke-elevated hover:border-poke-text-muted hover:scale-102'
        }
      `}
    >
      <Image
        src={src}
        alt={label}
        width={56}
        height={56}
        className="w-full h-full object-contain"
        style={{ imageRendering: 'pixelated' }}
        unoptimized
      />
    </button>
  );
}
