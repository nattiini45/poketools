"use client";

import { useRouter } from "next/navigation";
import ItemIcon from "@/components/ui/ItemIcon";
import SkewPlate from "@/components/ui/SkewPlate";
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

const PLATE_BUTTON =
  "inline-flex min-h-11 items-center text-body transition-transform duration-80 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none";

/** The body of every route error boundary (`error.tsx`). */
export default function ErrorState({ title, description, retryLabel, backLabel, onRetry, digest, detail }: ErrorStateProps) {
  const router = useRouter();
  const t = useT(shellMessages);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
      <ItemIcon item="dubious-disc" size={96} />
      <div>
        <h2 className="font-heading text-display text-balance text-fg">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-body text-fg-muted">{description}</p>
        {detail ? <p className="mx-auto mt-2 max-w-md break-words font-mono text-caption text-fg-muted">{detail}</p> : null}
        {digest ? <p className="mt-2 text-caption text-fg-muted">{t("errorPage.reference", { digest })}</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-4">
        <button type="button" onClick={onRetry} className={PLATE_BUTTON}>
          <SkewPlate variant="button" className="px-5 py-2.5">
            {retryLabel}
          </SkewPlate>
        </button>
        <button type="button" onClick={() => router.back()} className={PLATE_BUTTON}>
          <SkewPlate variant="button" tone="secondary" className="px-5 py-2.5">
            {backLabel}
          </SkewPlate>
        </button>
      </div>
    </div>
  );
}
