'use client';

/**
 * The pick screen's single pair of `aria-live` regions (FR-12; the old arena
 * had two competing ones). Callers pass already-translated text, derived
 * during render from keyed state.
 *
 * The text sits in a child keyed by `politeKey` / `assertiveKey`: a new key
 * replaces the node, so the same sentence is read again (for example "You are
 * on the clock." on the viewer's next turn), which a plain text update with
 * an unchanged string would not trigger.
 */
export interface LiveAnnouncerProps {
  polite: string;
  assertive: string;
  /** Bump to re-read the polite text even when it is unchanged. */
  politeKey?: number;
  /** Bump to re-read the assertive text even when it is unchanged. */
  assertiveKey?: number;
}

export default function LiveAnnouncer({ polite, assertive, politeKey = 0, assertiveKey = 0 }: LiveAnnouncerProps) {
  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite ? <span key={politeKey}>{polite}</span> : null}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive ? <span key={assertiveKey}>{assertive}</span> : null}
      </div>
    </>
  );
}
