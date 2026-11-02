import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { FieldMessages, useFieldA11y } from "./field-a11y";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options?: { value: string; label: string }[];
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    { label, error, hint, options, children, className, id, "aria-describedby": describedBy, ...props },
    ref
  ) => {
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
        <div className="relative">
          <select
            ref={ref}
            id={field.controlId}
            className={cn(
              "flex h-10 w-full appearance-none rounded-poke-md border bg-poke-surface px-3 py-2 pr-9 text-sm text-poke-text-primary shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              error ? "border-poke-danger" : "border-poke-border",
              className
            )}
            {...props}
            {...field.controlProps}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-poke-text-muted"
            aria-hidden="true"
          />
        </div>
        <FieldMessages errorId={field.errorId} hintId={field.hintId} error={error} hint={hint} />
      </div>
    );
  }
);

Select.displayName = "Select";
export default Select;
