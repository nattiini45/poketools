"use client";

import { type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useT } from "@/i18n/client";
import { uiMessages } from "@/i18n/messages/ui";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizeStyles = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export default function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: ModalProps) {
  const t = useT(uiMessages);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-poke-inverse/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 rounded-poke-xl border border-poke-border bg-poke-surface p-0 shadow-poke-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
            sizeStyles[size]
          )}
        >
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-poke-border">
            <Dialog.Title
              className={
                title
                  ? "text-lg font-heading font-bold text-poke-text-primary"
                  : "sr-only"
              }
            >
              {title ?? t("modal.untitled")}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-poke-sm p-1 text-poke-text-muted hover:text-poke-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-ring shrink-0 ml-auto"
              aria-label={t("modal.close")}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
