'use client';

import type { ApiErrorLike } from '@/i18n/api-errors';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { errorsMatches } from '@/i18n/messages/errors/matches';

interface TrackerWarningBannerViewProps {
  /** The warning, already in the viewer's language. */
  text: string;
  /** Accessible name of the dismiss control, already in the viewer's language. */
  dismissLabel: string;
  onDismiss: () => void;
}

/**
 * The banner itself, hook-free so its dismiss wiring is testable without a DOM.
 * `role="status"`: the game was recorded; this is news, not a failure.
 */
export function TrackerWarningBannerView({ text, dismissLabel, onDismiss }: TrackerWarningBannerViewProps) {
  return (
    <div
      role="status"
      className="px-4 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-sm text-poke-amber-ink"
    >
      {text}
      <button
        type="button"
        onClick={onDismiss}
        className="ml-2 text-poke-amber-ink hover:opacity-80"
        aria-label={dismissLabel}
      >
        ✕
      </button>
    </div>
  );
}

interface TrackerWarningBannerProps {
  /** A warning the server sent with a recorded game (e.g. its moments were not saved). */
  warning: ApiErrorLike;
  onDismiss: () => void;
}

/** The battle tracker's warning banner: the game counts, something attached to it was not saved. */
export default function TrackerWarningBanner({ warning, onDismiss }: TrackerWarningBannerProps) {
  const t = useT(broadcastCasterMessages);
  const errorText = useApiErrorText(errorsMatches);
  return <TrackerWarningBannerView text={errorText(warning)} dismissLabel={t('tracker.dismissError')} onDismiss={onDismiss} />;
}
