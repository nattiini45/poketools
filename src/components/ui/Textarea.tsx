import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
import { FieldMessages, useFieldA11y } from "./field-a11y";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, className, id, "aria-describedby": describedBy, ...props }, ref) => {
    const field = useFieldA11y({ id, error, hint, describedBy });
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={field.controlId}
            className="block text-sm font-heading font-semibold text-poke-text-primary"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={field.controlId}
          className={cn(
            "flex min-h-[80px] w-full rounded-poke-md border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary shadow-sm transition-colors placeholder:text-poke-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-poke-danger" : "border-poke-border",
            className
          )}
          {...props}
          {...field.controlProps}
        />
        <FieldMessages errorId={field.errorId} hintId={field.hintId} error={error} hint={hint} />
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
export default Textarea;
