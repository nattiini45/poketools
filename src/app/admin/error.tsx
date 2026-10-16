"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { buttonVariants } from "@/components/ui/buttonStyles";
import { useT } from "@/i18n/client";
import { adminCoreMessages } from "@/i18n/messages/admin-core";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const t = useT(adminCoreMessages);

  useEffect(() => {
    console.error("[Admin] Unhandled error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
      <div className="text-5xl">😵</div>
      <div>
        <h2 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
          {t("error.title")}
        </h2>
        <p className="text-sm text-poke-text-secondary max-w-md">
          {error.message || t("error.fallback")}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className={buttonVariants({ variant: "primary", size: "md" })}
        >
          {t("error.tryAgain")}
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
