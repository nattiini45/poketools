"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FieldMessages, useFieldA11y } from "./field-a11y";
import FluidInput from "./fluid/input";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, type, "aria-describedby": describedBy, ...props }, ref) => {
    const field = useFieldA11y({ id, error, hint, describedBy });
    const isDate = type === "date";
    const input = (
      <FluidInput
        ref={ref}
        id={field.controlId}
        type={type}
        className={cn(
          isDate &&
            "pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          className
        )}
        {...props}
        {...field.controlProps}
      />
    );
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
        {isDate ? (
          <div className="relative">
            {input}
            <Calendar
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
              aria-hidden="true"
            />
          </div>
        ) : (
          input
        )}
        <FieldMessages errorId={field.errorId} hintId={field.hintId} error={error} hint={hint} />
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
