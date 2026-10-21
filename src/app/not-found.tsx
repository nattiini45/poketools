import Link from "next/link";
import { getButtonClasses } from "@/components/ui/buttonStyles";
import { getT } from "@/i18n/server";
import { shellMessages } from "@/i18n/messages/shell";

export default async function NotFound() {
  const t = await getT(shellMessages);
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center">
      <div className="text-5xl">🔍</div>
      <div>
        <h2 className="text-xl font-heading font-bold text-poke-text-primary mb-2">
          {t("notFound.title")}
        </h2>
        <p className="text-sm text-poke-text-secondary max-w-md">
          {t("notFound.body")}
        </p>
      </div>
      <Link
        href="/"
        className={getButtonClasses("primary", "sm")}
      >
        {t("notFound.home")}
      </Link>
    </div>
  );
}
