'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { AI_AVATAR_DAILY_LIMIT } from '@/types/avatar';
import {
  PHOTO_TRANSFORM_CONSENT_VERSION,
  PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS,
} from '@/lib/avatar/consent';
import { useT } from '@/i18n/client';
import { avatarMessages } from '@/i18n/messages/avatar';
import {
  avatarErrorFromBody,
  avatarErrorFromCatch,
  avatarLocalError,
  useAvatarErrorText,
  type AvatarError,
} from './avatar-error';

interface PhotoTransformPanelProps {
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
 * Photo → Pokemon trainer sprite transform panel.
 * Handles file selection, client-side EXIF stripping, consent, and preview.
 */
export default function PhotoTransformPanel({
  playerId,
  onSaved,
  onBusyChange,
}: PhotoTransformPanelProps) {
  const t = useT(avatarMessages);
  const errorText = useAvatarErrorText();
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<AvatarError | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  // Index into PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS (a key, never translated text, in state).
  const [loadingIndex, setLoadingIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cleanedBase64Ref = useRef<string | null>(null);
  // Single-flight slots, claimed synchronously before each POST: the `transforming` / `saving`
  // state only lands on the next render, so a second click in the same tick would still see it
  // false. Transform and save exclude each other, as their buttons' disabled rules do.
  const transformingRef = useRef(false);
  const savingRef = useRef(false);

  // Rotate loading messages during transform
  useEffect(() => {
    if (!transforming) return;

    let idx = 0;
    setLoadingIndex(0);

    const interval = setInterval(() => {
      idx = (idx + 1) % PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS.length;
      setLoadingIndex(idx);
    }, 3000);

    return () => clearInterval(interval);
  }, [transforming]);

  // ── Client-side EXIF strip via Canvas ──────────────────────

  const processFile = useCallback((file: File) => {
    setError(null);
    setResultImage(null);

    if (file.size > 10 * 1024 * 1024) {
      setError(avatarLocalError('photoTooLarge'));
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(avatarLocalError('photoType'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        // Canvas redraw strips all EXIF metadata (GPS, camera info, etc.)
        // Fit within 512px on the longest side, preserving aspect ratio
        const maxDim = 512;
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;

        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        setPhotoPreview(dataUrl);
        cleanedBase64Ref.current = dataUrl;
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // ── Transform ──────────────────────────────────────────────

  const transform = useCallback(async () => {
    if (!cleanedBase64Ref.current || !consentChecked) return;
    if (transformingRef.current || savingRef.current) return;
    transformingRef.current = true;

    setTransforming(true);
    setError(null);

    try {
      const res = await fetch('/api/avatar/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: cleanedBase64Ref.current,
          consentAccepted: true,
          consentVersion: PHOTO_TRANSFORM_CONSENT_VERSION,
        }),
      });

      const result = await res.json();
      if (!result.success) {
        setError(avatarErrorFromBody(result, 'transformFailed'));
        return;
      }

      setResultImage(result.data.image);
      setRemaining(result.data.remaining);
    } catch (err) {
      setError(avatarErrorFromCatch(err, 'transformFailed'));
    } finally {
      transformingRef.current = false;
      setTransforming(false);
    }
  }, [consentChecked]);

  // ── Save as avatar ─────────────────────────────────────────

  const saveAsAvatar = useCallback(async () => {
    if (!resultImage || savingRef.current || transformingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError(null);

    try {
      const res = await fetch(`/api/players/${playerId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: resultImage,
          config: {}, // Photo transforms don't use the layer config
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
  }, [resultImage, playerId, onSaved, onBusyChange]);

  // ── Reset ──────────────────────────────────────────────────

  const reset = useCallback(() => {
    setPhotoPreview(null);
    setResultImage(null);
    setConsentChecked(false);
    setError(null);
    cleanedBase64Ref.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ── Render ─────────────────────────────────────────────────

  const canTransform = photoPreview && consentChecked && !transforming && !saving;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Preview Panel ──────────────────────────────────── */}
      <div className="flex flex-col items-center gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="bg-poke-elevated rounded-poke-xl p-4 shadow-poke-card w-[224px] h-[224px] flex items-center justify-center">
          {resultImage ? (
            <Image
              src={resultImage}
              alt={t('transform.resultAlt')}
              width={192}
              height={192}
              className="rounded-poke-lg object-cover"
              unoptimized
            />
          ) : transforming ? (
            <div className="flex flex-col items-center gap-3 text-poke-text-muted">
              <div className="w-10 h-10 border-3 border-poke-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-heading text-center px-2">
                {t(`transform.loading.${PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS[loadingIndex] ?? PHOTO_TRANSFORM_LOADING_MESSAGE_KEYS[0]}`)}
              </span>
            </div>
          ) : photoPreview ? (
            <Image
              src={photoPreview}
              alt={t('transform.previewAlt')}
              width={192}
              height={192}
              className="rounded-poke-lg object-cover opacity-80"
              unoptimized
            />
          ) : (
            <div className="text-center text-poke-text-muted">
              <p className="text-sm font-heading">{t('transform.uploadPrompt')}</p>
              <p className="text-xs mt-1">{t('transform.uploadPromptSub')}</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          {!resultImage ? (
            <button
              onClick={transform}
              disabled={!canTransform}
              className="px-5 py-2 text-sm font-heading font-bold rounded-poke-md
                       bg-poke-accent text-poke-surface hover:bg-poke-accent/90
                       transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {transforming ? t('transform.transforming') : t('transform.transform')}
            </button>
          ) : (
            <>
              <button
                onClick={saveAsAvatar}
                disabled={saving || transforming}
                className="px-5 py-2 text-sm font-heading font-bold rounded-poke-md
                         bg-poke-green text-poke-on-green hover:bg-poke-green/90
                         transition-colors disabled:opacity-50"
              >
                {saving ? t('transform.saving') : t('transform.useAsAvatar')}
              </button>
              <button
                onClick={reset}
                disabled={saving}
                className="px-4 py-2 text-sm font-heading font-semibold rounded-poke-md
                         bg-poke-elevated text-poke-text-secondary hover:bg-poke-border
                         transition-colors disabled:opacity-50"
              >
                {t('transform.tryAgain')}
              </button>
            </>
          )}
        </div>

        {/* Remaining counter */}
        <p className="text-xs text-poke-text-muted font-heading">
          {remaining !== null
            ? t('transform.remainingToday', { remaining, limit: AI_AVATAR_DAILY_LIMIT })
            : t('transform.perDay', { limit: AI_AVATAR_DAILY_LIMIT })}
        </p>

        {error && (
          <p className="text-sm text-poke-danger-ink text-center max-w-[220px]">{errorText(error)}</p>
        )}
      </div>

      {/* ── Right Panel: Upload + Consent ──────────────────── */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Drop zone / file picker */}
        <section>
          <h3 className="text-sm font-heading font-bold text-poke-text-primary mb-2">
            {t('transform.uploadHeading')}
          </h3>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-poke-border rounded-poke-lg p-8
                     flex flex-col items-center justify-center gap-3
                     cursor-pointer hover:border-poke-accent hover:bg-poke-elevated/50
                     transition-colors"
          >
            {photoPreview ? (
              <div className="flex items-center gap-3">
                <Image
                  src={photoPreview}
                  alt={t('transform.selectedAlt')}
                  width={64}
                  height={64}
                  className="rounded-poke-md object-cover"
                  unoptimized
                />
                <div>
                  <p className="text-sm font-heading text-poke-text-primary">
                    {t('transform.selected')}
                  </p>
                  <p className="text-xs text-poke-text-muted">
                    {t('transform.change')}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <svg
                  className="w-10 h-10 text-poke-text-muted"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-heading text-poke-text-secondary">
                    {t('transform.dropHint')}
                  </p>
                  <p className="text-xs text-poke-text-muted mt-1">
                    {t('transform.formats')}
                  </p>
                </div>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </section>

        {/* Consent checkbox */}
        {photoPreview && !resultImage && (
          <section className="bg-poke-elevated/50 border border-poke-border rounded-poke-lg p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={() => setConsentChecked((prev) => !prev)}
                className="mt-0.5 w-4 h-4 rounded border-poke-border text-poke-accent
                         focus:ring-poke-accent focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-xs text-poke-text-secondary leading-relaxed">
                {t('transform.consent')}
              </span>
            </label>
          </section>
        )}

        {/* How it works */}
        {!resultImage && (
          <section>
            <h3 className="text-sm font-heading font-bold text-poke-text-primary mb-2">
              {t('transform.howItWorks')}
            </h3>
            <ol className="space-y-2 text-xs text-poke-text-muted">
              <li className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-poke-elevated flex items-center justify-center text-poke-text-secondary font-heading font-bold">
                  1
                </span>
                <span>{t('transform.steps.upload')}</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-poke-elevated flex items-center justify-center text-poke-text-secondary font-heading font-bold">
                  2
                </span>
                <span>{t('transform.steps.memory')}</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-poke-elevated flex items-center justify-center text-poke-text-secondary font-heading font-bold">
                  3
                </span>
                <span>{t('transform.steps.ai')}</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-poke-elevated flex items-center justify-center text-poke-text-secondary font-heading font-bold">
                  4
                </span>
                <span>{t('transform.steps.preview')}</span>
              </li>
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}
