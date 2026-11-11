import Link from "next/link";
import ItemIcon from "@/components/ui/ItemIcon";
import SkewPlate from "@/components/ui/SkewPlate";
import { getT } from "@/i18n/server";
import { shellMessages } from "@/i18n/messages/shell";

export default async function NotFound() {
  const t = await getT(shellMessages);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
      <ItemIcon item="poke-doll" size={96} />
      <div>
        <h1 className="font-heading text-display text-balance text-fg">{t("notFound.title")}</h1>
        <p className="mx-auto mt-2 max-w-md text-body text-fg-muted">{t("notFound.body")}</p>
      </div>
      <Link href="/" className="inline-flex min-h-11 items-center text-body transition-transform duration-80 ease-out hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transform-none">
        <SkewPlate variant="button" className="px-5 py-2.5">
          {t("notFound.home")}
        </SkewPlate>
      </Link>
    </div>
  );
}
