"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  isValidElement,
  type ReactNode,
} from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "@/components/shared/motion";
import { cn } from "@/lib/utils/cn";

type PopoverSide = "top" | "bottom" | "left" | "right";
type PopoverAlign = "start" | "center" | "end";
type PopoverTrigger = "hover" | "click";

interface PopoverProps {
  content: ReactNode;
  children: ReactNode;
  side?: PopoverSide;
  align?: PopoverAlign;
  trigger?: PopoverTrigger;
  maxWidth?: number;
  className?: string;
  contentClassName?: string;
}

const OFFSET = 8;

function getPosition(
  rect: DOMRect,
  pop: DOMRect,
  preferred: PopoverSide,
  align: PopoverAlign
): { top: number; left: number; side: PopoverSide } {
  function alignOffset(
    anchorStart: number,
    anchorSize: number,
    popSize: number
  ): number {
    if (align === "start") return anchorStart;
    if (align === "end") return anchorStart + anchorSize - popSize;
    return anchorStart + anchorSize / 2 - popSize / 2;
  }

  const positions: Record<PopoverSide, { top: number; left: number }> = {
    top: {
      top: rect.top - pop.height - OFFSET,
      left: alignOffset(rect.left, rect.width, pop.width),
    },
    bottom: {
      top: rect.bottom + OFFSET,
      left: alignOffset(rect.left, rect.width, pop.width),
    },
    left: {
      top: alignOffset(rect.top, rect.height, pop.height),
      left: rect.left - pop.width - OFFSET,
    },
    right: {
      top: alignOffset(rect.top, rect.height, pop.height),
      left: rect.right + OFFSET,
    },
  };

  const pos = positions[preferred];

  if (pos.top < 4 && preferred === "top") return { ...positions.bottom, side: "bottom" };
  if (pos.top + pop.height > window.innerHeight - 4 && preferred === "bottom")
    return { ...positions.top, side: "top" };
  if (pos.left < 4 && preferred === "left") return { ...positions.right, side: "right" };
  if (pos.left + pop.width > window.innerWidth - 4 && preferred === "right")
    return { ...positions.left, side: "left" };

  return {
    top: Math.max(4, Math.min(pos.top, window.innerHeight - pop.height - 4)),
    left: Math.max(4, Math.min(pos.left, window.innerWidth - pop.width - 4)),
    side: preferred,
  };
}

export default function Popover({
  content,
  children,
  side = "bottom",
  align = "center",
  trigger = "click",
  maxWidth = 320,
  className,
  contentClassName,
}: PopoverProps) {
  if (trigger === "click") {
    return (
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          {isValidElement(children) ? (
            children
          ) : (
            <button
              type="button"
              className={cn(
                "inline-flex cursor-pointer border-0 bg-transparent p-0 font-inherit",
                className
              )}
            >
              {children}
            </button>
          )}
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            side={side}
            align={align}
            sideOffset={8}
            style={{ maxWidth }}
            className={cn(
              "z-[9998] rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-lg overflow-hidden outline-none animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              contentClassName
            )}
          >
            {content}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    );
  }

  return (
    <HoverPopover
      content={content}
      side={side}
      align={align}
      maxWidth={maxWidth}
      className={className}
      contentClassName={contentClassName}
    >
      {children}
    </HoverPopover>
  );
}

function HoverPopover({
  content,
  children,
  side,
  align,
  maxWidth,
  className,
  contentClassName,
}: Omit<PopoverProps, "trigger"> & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const reposition = useCallback(() => {
    if (!triggerRef.current || !popRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const pop = popRef.current.getBoundingClientRect();
    const pos = getPosition(rect, pop, side ?? "bottom", align ?? "center");
    setCoords({ top: pos.top, left: pos.left });
  }, [side, align]);

  useEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setOpen(true);
        }}
        onMouseLeave={() => {
          hoverTimerRef.current = setTimeout(() => setOpen(false), 150);
        }}
      >
        {children}
      </span>
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={popRef}
                initial={{ opacity: 0, scale: 0.96, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 4 }}
                transition={{ type: "spring", damping: 25, stiffness: 400 }}
                className={cn(
                  "fixed z-[9998] rounded-poke-lg bg-poke-surface border border-poke-border shadow-poke-lg overflow-hidden",
                  contentClassName
                )}
                style={{
                  maxWidth,
                  ...(coords
                    ? { top: coords.top, left: coords.left }
                    : { top: -9999, left: -9999 }),
                }}
                onMouseEnter={() => {
                  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                }}
                onMouseLeave={() => {
                  hoverTimerRef.current = setTimeout(() => setOpen(false), 150);
                }}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
