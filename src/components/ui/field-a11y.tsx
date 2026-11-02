import { useId } from "react";

interface FieldA11yInput {
  id?: string;
  error?: string;
  hint?: string;
  /** The caller's own `aria-describedby`; kept first, the field's message ids are appended. */
  describedBy?: string;
}

interface FieldA11y {
  controlId: string;
  errorId: string;
  hintId: string;
  /**
   * Spread on the control AFTER the caller's props (the control sets `id={controlId}` itself, first, so the attribute order stays stable), so the merged `aria-describedby` wins. `aria-invalid` is present
   * only for an `error`: a caller that passes its own `aria-invalid` keeps it.
   */
  controlProps: {
    "aria-invalid"?: true;
    "aria-describedby": string | undefined;
  };
}

/**
 * Ids and ARIA wiring shared by Input, Select and Textarea. The id comes from `useId` (never from the label text, which
 * collides when two fields share a label and changes with the language); the error or the hint becomes the control's
 * description.
 */
export function useFieldA11y({ id, error, hint, describedBy }: FieldA11yInput): FieldA11y {
  const autoId = useId();
  const controlId = id ?? autoId;
  const errorId = `${controlId}-error`;
  const hintId = `${controlId}-hint`;
  const describedByIds = [describedBy, error ? errorId : hint ? hintId : undefined].filter(Boolean).join(" ");
  return {
    controlId,
    errorId,
    hintId,
    controlProps: {
      ...(error ? { "aria-invalid": true as const } : {}),
      "aria-describedby": describedByIds || undefined,
    },
  };
}

/**
 * The error sits in a polite live region that is always in the DOM, so an error that appears after a submit is
 * announced; a `role="alert"` created together with the error would be missed by some readers, and one rendered with
 * the page would announce every initial error at once. The hint shows only while there is no error.
 */
export function FieldMessages({
  errorId,
  hintId,
  error,
  hint,
}: {
  errorId: string;
  hintId: string;
  error?: string;
  hint?: string;
}) {
  return (
    <>
      <div aria-live="polite" className="empty:!mt-0">
        {error && (
          <p id={errorId} className="text-sm text-poke-danger">
            {error}
          </p>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-sm text-poke-text-muted">
          {hint}
        </p>
      )}
    </>
  );
}
