'use client';

import { useRef, useEffect, useCallback } from 'react';

interface StatStepInputProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (val: number) => void;
  disabled?: boolean;
  /** Extra classes for the outer wrapper */
  className?: string;
}

/**
 * Number input with invisible top/bottom tap zones for step increment/decrement.
 * Hovering reveals faint ▲/▼ indicators; long-press repeats.
 */
export default function StatStepInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  className,
}: StatStepInputProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const latestVal = useRef(value);

  useEffect(() => {
    latestVal.current = value;
  }, [value]);

  const clamp = useCallback(
    (v: number) => Math.min(max, Math.max(min, v)),
    [min, max],
  );

  const bump = useCallback(
    (dir: 1 | -1) => {
      onChange(clamp(latestVal.current + dir * step));
    },
    [onChange, clamp, step],
  );

  // Start long-press: initial bump, then repeat after 400ms at 80ms interval
  const startHold = useCallback(
    (dir: 1 | -1) => {
      bump(dir);
      timerRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => bump(dir), 80);
      }, 400);
    },
    [bump],
  );

  const stopHold = useCallback(() => {
    clearTimeout(timerRef.current);
    clearInterval(intervalRef.current);
  }, []);

  // Clean up on unmount
  useEffect(() => stopHold, [stopHold]);

  if (disabled) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled
        className={`w-full bg-poke-elevated border border-poke-border rounded-poke-sm px-0.5 py-1.5
          text-center text-xs text-poke-text-primary tabular-nums opacity-50
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className ?? ''}`}
        value={value}
      />
    );
  }

  return (
    <div className={`relative group/step ${className ?? ''}`}>
      {/* Top tap zone — increment */}
      <div
        className="absolute inset-x-0 top-0 h-[38%] z-10 cursor-default select-none"
        onMouseDown={(e) => { e.preventDefault(); startHold(1); }}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={(e) => { e.preventDefault(); startHold(1); }}
        onTouchEnd={stopHold}
      />
      {/* Bottom tap zone — decrement */}
      <div
        className="absolute inset-x-0 bottom-0 h-[38%] z-10 cursor-default select-none"
        onMouseDown={(e) => { e.preventDefault(); startHold(-1); }}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={(e) => { e.preventDefault(); startHold(-1); }}
        onTouchEnd={stopHold}
      />
      {/* Hover indicators */}
      <div className="pointer-events-none absolute inset-x-0 top-px flex justify-center opacity-0 group-hover/step:opacity-50 transition-opacity text-[6px] text-poke-blue leading-none">
        ▲
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-px flex justify-center opacity-0 group-hover/step:opacity-50 transition-opacity text-[6px] text-poke-blue leading-none">
        ▼
      </div>
      {/* Input (center 24% is directly clickable for manual edit) */}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        className="w-full bg-poke-elevated border border-poke-border rounded-poke-sm px-0.5 py-1.5
          text-center text-xs text-poke-text-primary tabular-nums
          focus:ring-1 focus:ring-poke-focus/40 focus:border-poke-focus/40 transition-all
          [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        value={value}
        onChange={(e) => onChange(clamp(parseInt(e.target.value) || 0))}
        onFocus={(e) => e.target.select()}
      />
    </div>
  );
}
