"use client";

import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { useT } from "@/i18n/client";
import { shellMessages } from "@/i18n/messages/shell";

interface ErrorStateProps {
  title: string;
  /** The translated fallback. Never `error.message`: it is English whatever the viewer's language. */
  description: string;
  retryLabel: string;
  backLabel: string;
  onRetry: () => void;
  /** Next's `error.digest`: shown as a muted reference line, the one thing a viewer can report. */
  digest?: string;
  /** Raw text for a viewer who may read it (an admin outside production). Never the main text. */
  detail?: string;
}

/** The body of every route error boundary (`error.tsx`). */
export default function ErrorState({ title, description, retryLabel, backLabel, onRetry, digest, detail }: ErrorStateProps) {
  const router = useRouter();
  const t = useT(shellMessages);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
      <div className="text-5xl" aria-hidden="true">😵</div>
      <div>
        <h2 className="text-xl font-heading font-bold text-poke-text-primary mb-2">{title}</h2>
        <p className="text-sm text-poke-text-secondary max-w-md">{description}</p>
        {detail ? <p className="mt-2 text-xs font-mono text-poke-text-muted max-w-md break-words">{detail}</p> : null}
        {digest ? (
          <p className="mt-2 text-xs text-poke-text-muted">{t("errorPage.reference", { digest })}</p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <button onClick={onRetry} className={buttonVariants({ variant: "primary", size: "md" })}>
          {retryLabel}
        </button>
        <button onClick={() => router.back()} className={buttonVariants({ variant: "secondary", size: "md" })}>
          {backLabel}
        </button>
      </div>
    </div>
  );
}
