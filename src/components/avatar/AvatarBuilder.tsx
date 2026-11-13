'use client';

import { useState, useCallback, useRef } from 'react';
import type { AvatarConfig, AvatarGender, AvatarLayerKey } from '@/types/avatar';
import { AVATAR_BASE_SIZE } from '@/types/avatar';
import { avatarMessageKey, getCategories, getDefaultAvatarConfig } from '@/lib/avatar/manifest';
import { compositeToBase64 } from '@/lib/avatar/renderer';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import { avatarWardrobeMessages } from '@/i18n/messages/avatar/wardrobe';
import {
  avatarErrorFromBody,
  avatarErrorFromCatch,
  useAvatarErrorText,
  type AvatarError,
} from './avatar-error';
import { cn } from '@/lib/utils/cn';
import AvatarCanvas from './AvatarCanvas';
import AvatarCategoryPicker from './AvatarCategoryPicker';
import AiAvatarGenerator from './AiAvatarGenerator';
import ShowdownPicker from './ShowdownPicker';
import PhotoTransformPanel from './PhotoTransformPanel';

/**
 * Direction B's skewed plate drawn on the button itself (docs/design.md, "Skewed plates"): the plate is the button's
 * ::before, so the button's only child stays its label.
 */
const PLATE =
  'relative isolate inline-flex min-h-11 items-center justify-center px-4 text-body transition-[color,filter] duration-80 ease-out before:absolute before:inset-0 before:-z-1 before:rounded-[3px] before:[transform:skewX(var(--skew))] disabled:opacity-60';
const PLATE_SURFACE = 'before:border before:border-hairline-strong before:bg-surface';
const PLATE_UNDERSIDE =
  'after:absolute after:inset-x-0 after:bottom-0 after:-z-1 after:h-[3px] after:bg-accent-ink after:[transform:skewX(var(--skew))]';

const MODES = ['build', 'pick', 'generate', 'transform'] as const;
type BuilderMode = (typeof MODES)[number];

/**
 * Random index in [0, length) for the cosmetic "Randomize" button. Web Crypto
 * instead of Math.random so the option IDs it picks (which flow into the saved
 * avatar config) are not flagged as insecure randomness; the tiny modulo bias
 * does not matter for a wardrobe shuffle.
 */
function randomIndex(length: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % length;
}

interface AvatarBuilderProps {
  playerId: string;
  initialConfig?: AvatarConfig | null;
  /**
   * Runs after a successful save or removal. Awaited before the buttons and
   * the mode tabs re-enable, so the page's follow-up (a session refresh, then
   * navigation) cannot race a second save from this panel or another mode.
   */
  onSaved?: () => void | Promise<void>;
}

/**
 * Full avatar builder — two modes:
 * "Build" = layer-based paper-doll builder with gender selection
 * "Generate with AI" = T2I via curated choices
 */
export default function AvatarBuilder({ playerId, initialConfig, onSaved }: AvatarBuilderProps) {
  const t = useT(avatarMessages);
  const tw = useT(avatarWardrobeMessages);
  const errorText = useAvatarErrorText();
  const [mode, setMode] = useState<BuilderMode>('build');
  const [config, setConfig] = useState<AvatarConfig>(() => {
    // Legacy/showdown configs won't have valid gender — fall back to defaults
    if (initialConfig && 'gender' in initialConfig && (initialConfig.gender === 'male' || initialConfig.gender === 'female')) {
      return initialConfig;
    }
    return getDefaultAvatarConfig('male');
  });
  const [activeTab, setActiveTab] = useState<AvatarLayerKey>('base');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AvatarError | null>(null);

  // Saves in flight in the sibling panels (each owns its Save state). Each save reports its own
  // start and end, so a stale completion can only release its own count: the mode tabs stay locked
  // until every save that started, POST and awaited follow-up included, has finished.
  const [siblingSaves, setSiblingSaves] = useState(0);
  // Synchronous mirrors of the lock. State only lands on the next render, so a click (or a second
  // click) in the same tick as a save's start would still see it unlocked; the refs see it at once.
  // `ownSaveRef` holds the token of this panel's one save in flight (single-flight): only the save
  // that owns the token may release it, so a stale completion can never unlock a later save.
  const siblingSavesRef = useRef(0);
  const ownSaveRef = useRef<symbol | null>(null);
  const onSiblingBusy = useCallback((busy: boolean) => {
    siblingSavesRef.current = Math.max(0, siblingSavesRef.current + (busy ? 1 : -1));
    setSiblingSaves((n) => Math.max(0, n + (busy ? 1 : -1)));
  }, []);
  const tabsLocked = saving || siblingSaves > 0;

  /** Claims the single save slot, or returns null while any save (own or sibling) is in flight. */
  const beginSave = useCallback((): symbol | null => {
    if (ownSaveRef.current !== null || siblingSavesRef.current > 0) return null;
    const token = Symbol('avatar-save');
    ownSaveRef.current = token;
    setSaving(true);
    return token;
  }, []);

  /** Releases the slot only for the save that still owns it. */
  const endSave = useCallback((token: symbol) => {
    if (ownSaveRef.current !== token) return;
    ownSaveRef.current = null;
    setSaving(false);
  }, []);

  const selectMode = useCallback((next: BuilderMode) => {
    if (ownSaveRef.current !== null || siblingSavesRef.current > 0) return;
    setMode(next);
  }, []);

  const categories = getCategories(config.gender);
  const activeCategory = categories.find((c) => c.id === activeTab);

  const updateGender = useCallback((gender: AvatarGender) => {
    // Switching gender resets all layers since option IDs are gender-namespaced
    setConfig(getDefaultAvatarConfig(gender));
    setActiveTab('base');
  }, []);

  const updateLayer = useCallback((key: AvatarLayerKey, optionId: string | null) => {
    setConfig((prev) => ({ ...prev, [key]: optionId }));
  }, []);

  const randomize = useCallback(() => {
    const cats = getCategories(config.gender);
    const newConfig: Record<string, string | null> = { gender: config.gender };
    for (const cat of cats) {
      // Optional layers are left empty ~30% of the time
      if (!cat.required && randomIndex(10) < 3) {
        newConfig[cat.id] = null;
      } else {
        // Pick a random style, then a random color variant
        const randomStyle = cat.styles[randomIndex(cat.styles.length)];
        const randomVariant = randomStyle.variants[randomIndex(randomStyle.variants.length)];
        newConfig[cat.id] = randomVariant.optionId;
      }
    }
    setConfig(newConfig as unknown as AvatarConfig);
  }, [config.gender]);

  const save = useCallback(async () => {
    const token = beginSave();
    if (!token) return;
    setError(null);

    try {
      const imageData = await compositeToBase64(config, AVATAR_BASE_SIZE);

      const res = await fetch(`/api/players/${playerId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData, config }),
      });

      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'saveFailed'));
        return;
      }

      await onSaved?.();
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'saveFailed'));
    } finally {
      endSave(token);
    }
  }, [config, playerId, onSaved, beginSave, endSave]);

  const removeAvatar = useCallback(async () => {
    const token = beginSave();
    if (!token) return;
    setError(null);

    try {
      const res = await fetch(`/api/players/${playerId}/avatar`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'removeFailed'));
        return;
      }
      await onSaved?.();
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'removeFailed'));
    } finally {
      endSave(token);
    }
  }, [playerId, onSaved, beginSave, endSave]);

  return (
    <div>
      {/* Mode tabs */}
      <div role="tablist" aria-label={t('modes.label')} className="mb-6 flex flex-wrap gap-x-2 gap-y-2 px-1">
        {MODES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => selectMode(id)}
            disabled={tabsLocked}
            className={cn(PLATE, PLATE_SURFACE, mode === id ? cn('font-[550] text-fg', PLATE_UNDERSIDE) : 'text-fg-muted hover:text-fg')}
          >
            {t(`modes.${id}`)}
          </button>
        ))}
      </div>

      {/* Showdown Trainer Sprite Picker */}
      {mode === 'pick' && (
        <ShowdownPicker playerId={playerId} onSaved={onSaved} onBusyChange={onSiblingBusy} />
      )}

      {/* AI Generation Mode */}
      {mode === 'generate' && (
        <AiAvatarGenerator
          playerId={playerId}
          onSaved={onSaved}
          onBusyChange={onSiblingBusy}
        />
      )}

      {/* Photo Transform Mode */}
      {mode === 'transform' && (
        <PhotoTransformPanel
          playerId={playerId}
          onSaved={onSaved}
          onBusyChange={onSiblingBusy}
        />
      )}

      {/* Layer Builder Mode */}
      {mode === 'build' && (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Preview Panel */}
          <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24 lg:self-start">
            {/* Gender Toggle */}
            <div className="flex gap-1 rounded-poke-lg bg-sunken p-1">
              {(['male', 'female'] as const).map((gender) => (
                <button
                  key={gender}
                  type="button"
                  aria-pressed={config.gender === gender}
                  onClick={() => updateGender(gender)}
                  className={cn(
                    'min-h-9 rounded-poke-md px-4 text-body transition-colors duration-80 ease-out pointer-coarse:min-h-11',
                    config.gender === gender ? 'bg-surface font-[550] text-fg shadow-surface-1' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {t(`builder.${gender}`)}
                </button>
              ))}
            </div>

            <div className="rounded-poke-xl border border-hairline bg-elevated p-4">
              <AvatarCanvas config={config} size={192} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={randomize} disabled={saving} className={cn(PLATE, PLATE_SURFACE, 'font-[550] text-fg hover:brightness-95')}>
                {t('builder.randomize')}
              </button>
              <button type="button" onClick={save} disabled={saving} className={cn(PLATE, 'px-5 font-[550] text-tier-ink before:bg-accent-fill hover:brightness-95')}>
                {saving ? t('builder.saving') : t('builder.save')}
              </button>
            </div>

            {initialConfig && (
              <button
                type="button"
                onClick={removeAvatar}
                disabled={saving}
                className="min-h-11 text-caption text-fg-muted underline-offset-4 transition-colors duration-80 ease-out hover:text-loss hover:underline sm:min-h-0"
              >
                {t('builder.remove')}
              </button>
            )}

            {error && (
              <p role="alert" className="max-w-[220px] text-center text-body text-loss">{errorText(error)}</p>
            )}
          </div>

          {/* Category Tabs + Option Grid */}
          <div className="flex-1 min-w-0">
            <div className="mb-4 flex flex-wrap gap-1.5 border-b border-hairline pb-3">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id)}
                  type="button"
                  aria-pressed={activeTab === cat.id}
                  className={cn(
                    'min-h-9 rounded-poke-md border px-3 text-caption font-[550] transition-colors duration-80 ease-out pointer-coarse:min-h-11',
                    activeTab === cat.id
                      ? 'border-accent-fill bg-accent-subtle text-accent-ink'
                      : 'border-hairline bg-surface text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  {tw.dynamic(`categories.${avatarMessageKey(cat.id)}`, undefined, cat.label)}
                </button>
              ))}
            </div>

            {activeCategory && (
              <AvatarCategoryPicker
                gender={config.gender}
                category={activeCategory}
                selectedOptionId={config[activeTab]}
                onSelect={(id) => updateLayer(activeTab, id)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
