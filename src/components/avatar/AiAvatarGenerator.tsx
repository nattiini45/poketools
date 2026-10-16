'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import type { AiAvatarChoices, AiGalleryItem, AiChoiceCategory } from '@/types/avatar';
import { AI_AVATAR_DAILY_LIMIT } from '@/types/avatar';
import { AI_CHOICE_CATEGORIES, getDefaultAiChoices } from '@/lib/avatar/prompt-template';
import { avatarThumbUrl, supabasePublicOrigin } from '@/lib/avatar/thumbnail-path';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import { avatarAiChoicesMessages } from '@/i18n/messages/avatar/ai-choices';
import {
  avatarErrorFromBody,
  avatarErrorFromCatch,
  useAvatarErrorText,
  type AvatarError,
} from './avatar-error';

interface AiAvatarGeneratorProps {
  playerId: string;
  /** Awaited before the buttons re-enable, as in AvatarBuilder (no second save racing the page's follow-up). */
  onSaved?: () => void | Promise<void>;
  /**
   * Reports a save's start (true) and end (false), spanning the POST and the awaited onSaved, so
   * AvatarBuilder can keep its mode tabs locked for the whole save, not only its follow-up.
   */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Gallery grid source: the 256 px WebP thumbnail stored next to the original,
 * or the original when there is no thumbnail URL or the thumbnail failed to
 * load (items created before the thumbnail backfill).
 */
export function galleryImageSrc(imageUrl: string, thumbFailed: boolean): string {
  if (thumbFailed) return imageUrl;
  return avatarThumbUrl(imageUrl, supabasePublicOrigin()) ?? imageUrl;
}

/** One gallery tile image. Loads the thumbnail and falls back to the original once. */
export function GalleryThumb({
  imageUrl,
  alt,
  size,
}: {
  imageUrl: string;
  alt: string;
  size: number;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const src = galleryImageSrc(imageUrl, thumbFailed);

  return (
    <Image
      key={src}
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="w-full h-full object-cover"
      loading="lazy"
      unoptimized
      onError={src !== imageUrl ? () => setThumbFailed(true) : undefined}
    />
  );
}

/**
 * AI avatar generation panel with expanded customization,
 * personal gallery, and community showcase.
 */
export default function AiAvatarGenerator({
  playerId,
  onSaved,
  onBusyChange,
}: AiAvatarGeneratorProps) {
  const t = useT(avatarMessages);
  const tc = useT(avatarAiChoicesMessages);
  const errorText = useAvatarErrorText();
  const [choices, setChoices] = useState<AiAvatarChoices>(getDefaultAiChoices);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AvatarError | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // Single-flight slots, claimed synchronously before each POST: the `generating` / `saving` state
  // only lands on the next render, so a second click in the same tick would still see it false.
  // They mirror the buttons' disabled rules: Generate and "Use This" exclude each other and any
  // save; a gallery pick excludes only another save.
  const generatingRef = useRef(false);
  const savingRef = useRef(false);

  // Accordion state — which category is expanded (null = all collapsed)
  const [openCategory, setOpenCategory] = useState<AiChoiceCategory | null>(null);

  // Gallery state
  const [personalGallery, setPersonalGallery] = useState<AiGalleryItem[]>([]);
  const [communityAvatars, setCommunityAvatars] = useState<AiGalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);

  // Separate art_style category from the rest for special rendering
  const artStyleCategory = AI_CHOICE_CATEGORIES.find((c) => c.id === 'art_style')!;
  const otherCategories = AI_CHOICE_CATEGORIES.filter((c) => c.id !== 'art_style');

  // ── Fetch gallery on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchGallery() {
      try {
        const [personalRes, communityRes] = await Promise.all([
          fetch('/api/avatar/gallery?scope=personal'),
          fetch('/api/avatar/gallery?scope=community'),
        ]);

        if (cancelled) return;

        const personalData = await personalRes.json();
        const communityData = await communityRes.json();

        if (personalData.success) setPersonalGallery(personalData.data.items);
        if (communityData.success) setCommunityAvatars(communityData.data.items);
      } catch {
        // Gallery fetch is non-critical — silently fail
      } finally {
        if (!cancelled) setGalleryLoading(false);
      }
    }

    fetchGallery();
    return () => { cancelled = true; };
  }, []);

  // ── Handlers ────────────────────────────────────────────────

  const updateChoice = useCallback((category: string, value: string) => {
    setChoices((prev) => ({ ...prev, [category]: value }));
  }, []);

  const generate = useCallback(async () => {
    if (generatingRef.current || savingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/avatar/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices }),
      });

      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'generateFailed'));
        return;
      }

      setGeneratedImage(result.data.image);
      setRemaining(result.data.remaining);

      // Optimistically prepend to personal gallery
      if (result.data.gallery_id && result.data.gallery_url) {
        const newItem: AiGalleryItem = {
          id: result.data.gallery_id,
          player_id: playerId,
          image_url: result.data.gallery_url,
          choices: { ...choices },
          style: choices.art_style,
          created_at: new Date().toISOString(),
        };
        setPersonalGallery((prev) => [newItem, ...prev]);
      }
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'generateFailed'));
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [choices, playerId]);

  const saveAsAvatar = useCallback(async () => {
    if (!generatedImage || savingRef.current || generatingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);

    try {
      const res = await fetch(`/api/players/${playerId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: generatedImage,
          config: {}, // AI-generated avatars don't use the layer config
        }),
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
      savingRef.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }, [generatedImage, playerId, onSaved, onBusyChange]);

  const applyGalleryItem = useCallback(async (item: AiGalleryItem) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);

    try {
      const res = await fetch(`/api/players/${playerId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gallery_id: item.id }),
      });

      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'setFailed'));
        return;
      }

      await onSaved?.();
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'setFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }, [playerId, onSaved, onBusyChange]);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const removeGalleryItem = useCallback(async (item: AiGalleryItem) => {
    if (!window.confirm(t('ai.deleteConfirm'))) return;

    setDeletingId(item.id);
    setError(null);

    try {
      const res = await fetch(`/api/avatar/gallery/${item.id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'deleteFailed'));
        return;
      }

      setPersonalGallery((prev) => prev.filter((galleryItem) => galleryItem.id !== item.id));
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'deleteFailed'));
    } finally {
      setDeletingId(null);
    }
  }, [t]);

  const toggleCategory = useCallback((catId: AiChoiceCategory) => {
    setOpenCategory((prev) => (prev === catId ? null : catId));
  }, []);

  // Labels by id from `avatar/ai-choices`; the English labels of AI_CHOICE_CATEGORIES are the fallback.
  const categoryLabel = (catId: AiChoiceCategory, english: string): string =>
    tc.dynamic(`categories.${catId}`, undefined, english);
  const optionLabel = (catId: AiChoiceCategory, optionId: string, english: string): string =>
    tc.dynamic(`options.${catId}.${optionId}`, undefined, english);

  // Helper to get the label for a selected option
  const getSelectedLabel = (catId: AiChoiceCategory): string => {
    const cat = AI_CHOICE_CATEGORIES.find((c) => c.id === catId);
    if (!cat) return '';
    const value = choices[catId];
    const option = cat.options.find((o) => o.id === value);
    return option ? optionLabel(catId, option.id, option.label) : value;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Preview Panel ────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="bg-poke-elevated rounded-poke-xl p-4 shadow-poke-card w-[224px] h-[224px] flex items-center justify-center">
          {generatedImage ? (
            <Image
              src={generatedImage}
              alt={t('ai.generatedAlt')}
              width={192}
              height={192}
              className="rounded-poke-lg object-cover"
              unoptimized
            />
          ) : generating ? (
            <div className="flex flex-col items-center gap-3 text-poke-text-muted">
              <div className="w-10 h-10 border-3 border-poke-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-heading">{t('ai.generating')}</span>
            </div>
          ) : (
            <div className="text-center text-poke-text-muted">
              <p className="text-sm font-heading">{t('ai.pickChoices')}</p>
              <p className="text-xs mt-1">{t('ai.thenGenerate')}</p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={generate}
            disabled={generating || saving}
            className="px-5 py-2 text-sm font-heading font-bold rounded-poke-md
                     bg-poke-accent text-poke-surface hover:bg-poke-accent/90
                     transition-colors disabled:opacity-50"
          >
            {generating ? t('ai.generating') : generatedImage ? t('ai.regenerate') : t('ai.generate')}
          </button>
          {generatedImage && (
            <button
              onClick={saveAsAvatar}
              disabled={saving || generating}
              className="px-5 py-2 text-sm font-heading font-bold rounded-poke-md
                       bg-poke-green text-poke-on-green hover:bg-poke-green/90
                       transition-colors disabled:opacity-50"
            >
              {saving ? t('ai.saving') : t('ai.useThis')}
            </button>
          )}
        </div>

        {/* Remaining counter */}
        <p className="text-xs text-poke-text-muted font-heading">
          {remaining !== null
            ? t('ai.remainingToday', { remaining, limit: AI_AVATAR_DAILY_LIMIT })
            : t('ai.perDay', { limit: AI_AVATAR_DAILY_LIMIT })}
        </p>

        {error && (
          <p className="text-sm text-poke-danger-ink text-center max-w-[200px]">{errorText(error)}</p>
        )}
      </div>

      {/* ── Right Panel: Gallery + Choices ────────────────────── */}
      <div className="flex-1 min-w-0 space-y-6">

        {/* ── Your Gallery ──────────────────────────────────── */}
        {personalGallery.length > 0 && (
          <section>
            <h3 className="text-sm font-heading font-bold text-poke-text-primary mb-2">
              {t('ai.previousHeading')}
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2 -mb-2">
              {personalGallery.map((item) => (
                <div key={item.id} className="shrink-0 flex flex-col items-center gap-1">
                  <button
                    onClick={() => applyGalleryItem(item)}
                    disabled={saving}
                    title={t('ai.useAsAvatarHint')}
                    className="w-16 h-16 rounded-poke-md border-2 border-transparent
                             hover:border-poke-accent overflow-hidden bg-poke-surface
                             transition-all hover:scale-105 disabled:opacity-50"
                  >
                    <GalleryThumb
                      imageUrl={item.image_url}
                      alt={t('ai.previousAlt')}
                      size={64}
                    />
                  </button>
                  <button
                    onClick={() => removeGalleryItem(item)}
                    disabled={deletingId === item.id}
                    className="text-[10px] font-heading text-poke-text-muted hover:text-poke-accent transition-colors disabled:opacity-50"
                  >
                    {deletingId === item.id ? t('ai.deleting') : t('ai.delete')}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {galleryLoading && personalGallery.length === 0 && (
          <p className="text-xs text-poke-text-muted">{t('ai.loadingGallery')}</p>
        )}

        {/* ── Art Style Selector (prominent, outside accordion) ── */}
        <section>
          <h3 className="text-sm font-heading font-bold text-poke-text-primary mb-2">
            {categoryLabel(artStyleCategory.id, artStyleCategory.label)}
          </h3>
          <div className="flex gap-2">
            {artStyleCategory.options.map((opt) => {
              const isSelected = choices.art_style === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => updateChoice('art_style', opt.id)}
                  className={`
                    flex-1 px-4 py-2.5 text-sm font-heading font-semibold rounded-poke-md
                    border-2 transition-all duration-150
                    ${isSelected
                      ? 'border-poke-accent bg-poke-accent-light text-poke-accent shadow-poke-sm'
                      : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-text-muted'
                    }
                  `}
                >
                  {optionLabel(artStyleCategory.id, opt.id, opt.label)}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Choice Categories (accordion) ─────────────────── */}
        <section className="space-y-1">
          {otherCategories.map((cat) => {
            const isOpen = openCategory === cat.id;
            const selectedLabel = getSelectedLabel(cat.id);

            return (
              <div
                key={cat.id}
                className="border border-poke-border rounded-poke-md overflow-hidden"
              >
                {/* Accordion header */}
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5
                           bg-poke-surface hover:bg-poke-elevated transition-colors"
                >
                  <span className="text-sm font-heading font-semibold text-poke-text-primary">
                    {categoryLabel(cat.id, cat.label)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-heading text-poke-accent font-medium">
                      {selectedLabel}
                    </span>
                    <svg
                      className={`w-4 h-4 text-poke-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Accordion body */}
                {isOpen && (
                  <div className="px-3 py-3 border-t border-poke-border bg-poke-elevated/50">
                    <div className="flex flex-wrap gap-1.5">
                      {cat.options.map((opt) => {
                        const isSelected = choices[cat.id] === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => updateChoice(cat.id, opt.id)}
                            className={`
                              px-3 py-1.5 text-xs font-heading rounded-poke-md border-2 transition-all duration-150
                              ${isSelected
                                ? 'border-poke-accent bg-poke-accent-light text-poke-accent font-bold shadow-poke-sm'
                                : 'border-poke-border bg-poke-surface text-poke-text-secondary hover:border-poke-text-muted'
                              }
                            `}
                          >
                            {optionLabel(cat.id, opt.id, opt.label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ── Community Showcase ─────────────────────────────── */}
        {communityAvatars.length > 0 && (
          <section>
            <h3 className="text-sm font-heading font-bold text-poke-text-primary mb-1">
              {t('ai.communityHeading')}
            </h3>
            <p className="text-xs text-poke-text-muted mb-3">
              {t('ai.communityHint')}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {communityAvatars.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="w-14 h-14 rounded-poke-md overflow-hidden bg-poke-surface border border-poke-border">
                    <GalleryThumb
                      imageUrl={item.image_url}
                      alt={item.player_name ? t('ai.playerAvatarAlt', { name: item.player_name }) : t('ai.communityAlt')}
                      size={56}
                    />
                  </div>
                  {item.player_name && (
                    <span className="text-[10px] text-poke-text-muted truncate max-w-[56px]">
                      {item.player_name}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
