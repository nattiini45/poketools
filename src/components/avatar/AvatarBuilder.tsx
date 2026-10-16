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
import AvatarCanvas from './AvatarCanvas';
import AvatarCategoryPicker from './AvatarCategoryPicker';
import AiAvatarGenerator from './AiAvatarGenerator';
import ShowdownPicker from './ShowdownPicker';
import PhotoTransformPanel from './PhotoTransformPanel';

type BuilderMode = 'build' | 'pick' | 'generate' | 'transform';

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
      if (!cat.required && Math.random() < 0.3) {
        newConfig[cat.id] = null;
      } else {
        // Pick a random style, then a random color variant
        const randomStyle = cat.styles[Math.floor(Math.random() * cat.styles.length)];
        const randomVariant = randomStyle.variants[Math.floor(Math.random() * randomStyle.variants.length)];
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
      {/* Mode Toggle */}
      <div className="flex gap-1 mb-6 p-1 bg-poke-elevated rounded-poke-lg w-fit">
        <button
          onClick={() => selectMode('build')}
          disabled={tabsLocked}
          className={`
            px-4 py-2 text-sm font-heading font-semibold rounded-poke-md transition-colors
            ${mode === 'build'
              ? 'bg-poke-surface text-poke-text-primary shadow-poke-sm'
              : 'text-poke-text-muted hover:text-poke-text-secondary'
            }
          `}
        >
          {t('modes.build')}
        </button>
        <button
          onClick={() => selectMode('pick')}
          disabled={tabsLocked}
          className={`
            px-4 py-2 text-sm font-heading font-semibold rounded-poke-md transition-colors
            ${mode === 'pick'
              ? 'bg-poke-surface text-poke-text-primary shadow-poke-sm'
              : 'text-poke-text-muted hover:text-poke-text-secondary'
            }
          `}
        >
          {t('modes.pick')}
        </button>
        <button
          onClick={() => selectMode('generate')}
          disabled={tabsLocked}
          className={`
            px-4 py-2 text-sm font-heading font-semibold rounded-poke-md transition-colors
            ${mode === 'generate'
              ? 'bg-poke-surface text-poke-text-primary shadow-poke-sm'
              : 'text-poke-text-muted hover:text-poke-text-secondary'
            }
          `}
        >
          {t('modes.generate')}
        </button>
        <button
          onClick={() => selectMode('transform')}
          disabled={tabsLocked}
          className={`
            px-4 py-2 text-sm font-heading font-semibold rounded-poke-md transition-colors
            ${mode === 'transform'
              ? 'bg-poke-surface text-poke-text-primary shadow-poke-sm'
              : 'text-poke-text-muted hover:text-poke-text-secondary'
            }
          `}
        >
          {t('modes.transform')}
        </button>
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
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Preview Panel */}
          <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24 lg:self-start">
            {/* Gender Toggle */}
            <div className="flex gap-1 p-1 bg-poke-elevated rounded-poke-lg">
              <button
                onClick={() => updateGender('male')}
                className={`
                  px-4 py-1.5 text-xs font-heading font-semibold rounded-poke-md transition-colors
                  ${config.gender === 'male'
                    ? 'bg-blue-500 text-white shadow-poke-sm'
                    : 'text-poke-text-muted hover:text-poke-text-secondary'
                  }
                `}
              >
                {t('builder.male')}
              </button>
              <button
                onClick={() => updateGender('female')}
                className={`
                  px-4 py-1.5 text-xs font-heading font-semibold rounded-poke-md transition-colors
                  ${config.gender === 'female'
                    ? 'bg-pink-500 text-white shadow-poke-sm'
                    : 'text-poke-text-muted hover:text-poke-text-secondary'
                  }
                `}
              >
                {t('builder.female')}
              </button>
            </div>

            <div className="bg-poke-elevated rounded-poke-xl p-4 shadow-poke-card">
              <AvatarCanvas config={config} size={192} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={randomize}
                disabled={saving}
                className="px-4 py-2 text-sm font-heading font-semibold rounded-poke-md
                         bg-poke-elevated text-poke-text-secondary hover:bg-poke-border
                         transition-colors disabled:opacity-50"
              >
                {t('builder.randomize')}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-6 py-2 text-sm font-heading font-bold rounded-poke-md
                         bg-poke-accent text-poke-surface hover:bg-poke-accent/90
                         transition-colors disabled:opacity-50"
              >
                {saving ? t('builder.saving') : t('builder.save')}
              </button>
            </div>

            {initialConfig && (
              <button
                onClick={removeAvatar}
                disabled={saving}
                className="text-xs text-poke-text-muted hover:text-poke-accent transition-colors"
              >
                {t('builder.remove')}
              </button>
            )}

            {error && (
              <p className="text-sm text-poke-danger-ink text-center max-w-[200px]">{errorText(error)}</p>
            )}
          </div>

          {/* Category Tabs + Option Grid */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1 mb-4 pb-3 border-b border-poke-border">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveTab(cat.id)}
                  className={`
                    px-3 py-1.5 text-xs font-heading font-semibold rounded-poke-md
                    transition-colors
                    ${activeTab === cat.id
                      ? 'bg-poke-accent text-poke-surface'
                      : 'bg-poke-elevated text-poke-text-secondary hover:bg-poke-border'
                    }
                  `}
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
