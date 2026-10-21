"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { useT } from "@/i18n/client";
import { commonMessages } from "@/i18n/messages/common";
import { leaguesMessages } from "@/i18n/messages/leagues";

export default function LeagueError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const t = useT(leaguesMessages);
  const common = useT(commonMessages);

  useEffect(() => {
    console.error("[League] Unhandled error:", error);
  }, [error]);

  // The raw error message is logged, not shown: it is English (or, in
  // production, Next's generic digest text) whatever the viewer's language.
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
      <div className="text-5xl" aria-hidden="true">😵</div>
      <div>
        <h2 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
          {t("error.title")}
        </h2>
        <p className="text-sm text-poke-text-secondary max-w-md">{t("error.description")}</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          {common("actions.retry")}
        </button>
        <button
          onClick={() => router.back()}
          className={buttonVariants({ variant: "secondary", size: "md" })}
        >
          {t("error.goBack")}
        </button>
      </div>
    </div>
  );
}
