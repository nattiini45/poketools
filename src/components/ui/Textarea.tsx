"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { FieldMessages, useFieldA11y } from "./field-a11y";
import FluidTextarea from "./fluid/textarea";

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
            className="block text-caption font-medium text-fg"
          >
            {label}
          </label>
        )}
        <FluidTextarea
          ref={ref}
          id={field.controlId}
          className={className}
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
