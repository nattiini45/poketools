'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { adminAssistantMessages } from '@/i18n/messages/admin-assistant';

export interface ComposerProps {
  /** The conversation cannot take a message (read-only role, archived, a turn running elsewhere). */
  disabled: boolean;
  sending: boolean;
  maxChars: number;
  /** A harness event waits for the model: offer Continue. */
  canContinue: boolean;
  onSend: (text: string, onAccepted: () => void) => Promise<boolean>;
  onContinue: () => void;
  /** A sentence to put in the box (a plan shortcut). A new `nonce` replaces what is typed; the admin still has to send it. */
  prefill?: { text: string; nonce: number } | null;
}

/** Characters left below which the counter shows. */
const COUNTER_FROM = 500;

/**
 * The message box (plan 5.3): Enter sends, Shift+Enter breaks the line, the text is capped at the server's limit and the
 * counter says how many characters are left. The text is cleared once the server has accepted the message, not before, so
 * a refusal (busy, rate limit) leaves it in the box.
 */
export default function Composer({ disabled, sending, maxChars, canContinue, onSend, onContinue, prefill = null }: ComposerProps) {
  const t = useT(adminAssistantMessages);
  const id = useId();
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // A new request replaces what is typed. State is adjusted while rendering (React's pattern for state that follows a prop);
  // only the focus, which is not state, waits for the effect.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  const nonce = prefill?.nonce ?? null;
  if (prefill !== null && nonce !== appliedNonce) {
    setAppliedNonce(nonce);
    setText(prefill.text);
  }
  useEffect(() => {
    if (nonce !== null) box.current?.focus();
  }, [nonce]);
  const length = Array.from(text).length;
  const left = maxChars - length;
  const tooLong = left < 0;
  const empty = text.trim() === '';
  const blocked = disabled || sending;

  const submit = () => {
    if (blocked || empty || tooLong) return;
    void onSend(text, () => setText(''));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t('composer.label')}
      </label>
      <textarea
        ref={box}
        id={id}
        value={text}
        rows={3}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        aria-invalid={tooLong}
        placeholder={t('composer.placeholder')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="block w-full resize-y rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary placeholder:text-poke-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p id={`${id}-hint`} className="min-w-0 flex-1 text-xs text-poke-text-muted">
          {tooLong ? <span className="text-poke-danger-ink">{t('composer.tooLong', { max: maxChars })}</span> : left <= COUNTER_FROM ? t('composer.charsLeft', { count: left }) : t('composer.hint')}
        </p>
        {canContinue && (
          <Button type="button" variant="secondary" size="sm" disabled={blocked} onClick={onContinue}>
            {t('composer.continue')}
          </Button>
        )}
        <Button type="submit" size="sm" disabled={blocked || empty || tooLong} loading={sending}>
          {sending ? t('composer.sending') : t('composer.send')}
        </Button>
      </div>
    </form>
  );
}
