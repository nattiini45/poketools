import Skeleton from "@/components/ui/Skeleton";
import PokeballSpinner from "@/components/shared/PokeballSpinner";
import PageContainer from "@/components/ui/PageContainer";

/** The matches list while its route loads: the filter console, then the list frame with a few rows. */
export default function AdminMatchesLoading() {
  return (
    <PageContainer>
      <PokeballSpinner className="py-2" />
      <Skeleton width="220px" height="34px" rounded="md" />
      <div className="flex flex-col gap-4 rounded-poke-lg border border-hairline bg-surface p-4">
        <Skeleton height="36px" rounded="md" />
        <div className="flex gap-2 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} width="96px" height="32px" rounded="sm" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-poke-lg border border-hairline bg-surface">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} height="64px" rounded="sm" />
        ))}
      </div>
    </PageContainer>
  );
}
