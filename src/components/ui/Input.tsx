import { forwardRef, type InputHTMLAttributes } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, type, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    const isDate = type === "date";
    const input = (
      <input
        ref={ref}
        id={inputId}
        type={type}
        className={cn(
          "flex h-10 w-full rounded-poke-md border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary shadow-sm transition-colors placeholder:text-poke-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-poke-danger" : "border-poke-border",
          isDate &&
            "pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          className
        )}
        {...props}
      />
    );
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-heading font-semibold text-poke-text-primary"
          >
            {label}
          </label>
        )}
        {isDate ? (
          <div className="relative">
            {input}
            <Calendar
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-poke-text-muted"
              aria-hidden="true"
            />
          </div>
        ) : (
          input
        )}
        {error && <p className="text-sm text-poke-danger">{error}</p>}
        {hint && !error && (
          <p className="text-sm text-poke-text-muted">{hint}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
