'use client';

import { useState, useCallback, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { captureNodeAsDataUrl } from '@/lib/utils/capture-node';
import { withDefaultSitePalette } from '@/lib/design/site-palette-store';
import { I18nProvider, useDataLocale, useLocale, useRequestTime, useT } from '@/i18n/client';
import { LEAGUE_TIME_ZONE, type Locale } from '@/i18n/config';
import { matchMessages } from '@/i18n/messages/match';

type Status = 'idle' | 'capturing' | 'uploading' | 'done' | 'error';

interface CreateSocialImageButtonProps {
  targetId: string;
  matchId: string;
  existingUrl?: string | null;
  /**
   * The league's content language (`resolveContentLocale`, i18n-core §6.3).
   * The stored image is served to every viewer, so it is captured in this
   * language, not the admin's own.
   */
  contentLocale?: Locale;
  /**
   * A copy of the card to capture when `contentLocale` differs from the
   * viewer's UI language or Pokémon-name language. It is mounted off-screen inside a nested provider in
   * `contentLocale`, captured by `contentTargetId`, and unmounted again.
   */
  contentCard?: ReactNode;
  /** The element id of the card inside `contentCard`. */
  contentTargetId?: string;
}

/**
 * Which node the social image is captured from: the on-screen card when the
 * viewer already reads the league's language for both UI text and Pokémon
 * names (or no copy was supplied), else the off-screen copy rendered in the
 * content language. A viewer with "keep Pokémon terms in English" in a German
 * league sees English names on screen, so the stored PNG must come from the copy.
 */
export function socialCaptureTarget(input: {
  targetId: string;
  viewerLocale: Locale;
  /** The viewer's Pokémon-name locale (`useDataLocale`); defaults to `viewerLocale`. */
  viewerDataLocale?: Locale;
  contentLocale?: Locale;
  hasContentCard: boolean;
  contentTargetId?: string;
}): { id: string; viaCopy: boolean } {
  const { targetId, viewerLocale, contentLocale, hasContentCard, contentTargetId } = input;
  const viewerDataLocale = input.viewerDataLocale ?? viewerLocale;
  const differs = contentLocale !== undefined && (contentLocale !== viewerLocale || contentLocale !== viewerDataLocale);
  if (differs && hasContentCard && contentTargetId) {
    return { id: contentTargetId, viaCopy: true };
  }
  return { id: targetId, viaCopy: false };
}

/** How long the off-screen copy may take to mount before the capture fails. */
export const MOUNT_COPY_TIMEOUT_MS = 5000;

/** Resolves after the browser has laid out the freshly mounted copy (two frames). */
function afterLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function CreateSocialImageButton({
  targetId,
  matchId,
  existingUrl,
  contentLocale,
  contentCard,
  contentTargetId,
}: CreateSocialImageButtonProps) {
  const router = useRouter();
  const t = useT(matchMessages);
  const locale = useLocale();
  const dataLocale = useDataLocale();
  const requestTime = useRequestTime();
  const [status, setStatus] = useState<Status>('idle');
  // Width of the on-screen card while its content-language copy is mounted; null = not mounted.
  const [copyWidth, setCopyWidth] = useState<number | null>(null);
  const copyMounted = useRef<(() => void) | null>(null);

  const capture = socialCaptureTarget({
    targetId,
    viewerLocale: locale,
    viewerDataLocale: dataLocale,
    contentLocale,
    hasContentCard: contentCard != null,
    contentTargetId,
  });

  /**
   * Mounts the content-language copy and resolves once it is in the DOM and
   * laid out. Rejects after MOUNT_COPY_TIMEOUT_MS so the button can never stay
   * 'capturing' when the copy never mounts.
   */
  const mountCopy = useCallback(async () => {
    const width = document.getElementById(targetId)?.offsetWidth ?? 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        copyMounted.current = null;
        reject(new Error('Content-language card copy did not mount in time'));
      }, MOUNT_COPY_TIMEOUT_MS);
      copyMounted.current = () => {
        clearTimeout(timer);
        resolve();
      };
      setCopyWidth(width);
    });
    await afterLayout();
  }, [targetId]);

  const handleClick = useCallback(async () => {
    if (status === 'capturing' || status === 'uploading') return;

    setStatus('capturing');
    try {
      // The stored image is served to every viewer: capture it in the default
      // palette, never the admin's own (docs/design.md § Site palettes), and in
      // the league's language, never the admin's own (i18n-core §6.3).
      let dataUrl: string;
      if (capture.viaCopy) {
        try {
          await mountCopy();
          dataUrl = await withDefaultSitePalette(() => captureNodeAsDataUrl(capture.id));
        } finally {
          setCopyWidth(null);
        }
      } else {
        dataUrl = await withDefaultSitePalette(() => captureNodeAsDataUrl(capture.id));
      }

      setStatus('uploading');
      const response = await fetch(`/api/matches/${matchId}/social-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });

      const result = await response.json() as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error ?? 'Upload failed');
      }

      // Each upload is stored under a new immutable URL: re-render the page so
      // it carries that URL and the label reads 'Update Social Image'.
      router.refresh();
      setStatus('done');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to create social image:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [status, matchId, router, capture.viaCopy, capture.id, mountCopy]);

  const label = status === 'capturing'
    ? t('socialImage.capturing')
    : status === 'uploading'
      ? t('socialImage.uploading')
      : status === 'done'
        ? t('socialImage.uploaded')
        : status === 'error'
          ? t('socialImage.failed')
          : existingUrl
            ? t('socialImage.update')
            : t('socialImage.create');

  const isWorking = status === 'capturing' || status === 'uploading';

  const copy =
    capture.viaCopy && contentLocale && copyWidth !== null && typeof document !== 'undefined'
      ? createPortal(
          <div
            aria-hidden="true"
            ref={(el) => {
              if (el && copyMounted.current) {
                const resolve = copyMounted.current;
                copyMounted.current = null;
                resolve();
              }
            }}
            className="pointer-events-none"
            style={{ position: 'fixed', top: 0, left: -10_000, width: copyWidth || undefined }}
          >
            <I18nProvider
              locale={contentLocale}
              dataLocale={contentLocale}
              timeZone={LEAGUE_TIME_ZONE}
              pinTimeZone
              requestTime={requestTime}
            >
              {contentCard}
            </I18nProvider>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        data-export-hide
        onClick={handleClick}
        disabled={isWorking}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-poke-md text-xs font-heading transition-colors disabled:opacity-50 ${
          status === 'done'
            ? 'text-poke-green bg-poke-green/10'
            : status === 'error'
              ? 'text-poke-accent bg-poke-accent/10'
              : 'text-poke-text-muted hover:text-poke-text-secondary hover:bg-poke-muted'
        }`}
        title={existingUrl ? t('socialImage.titleUpdate') : t('socialImage.titleCreate')}
      >
        {isWorking ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : status === 'done' ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        )}
        {label}
      </button>
      {copy}
    </>
  );
}
