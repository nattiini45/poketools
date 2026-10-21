import Skeleton from "@/components/ui/Skeleton";
import PokeballSpinner from "@/components/shared/PokeballSpinner";
import PageContainer from "@/components/ui/PageContainer";

export default function AdminMatchesLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      <PokeballSpinner className="py-6" />
      <Skeleton width="200px" height="32px" rounded="md" />
      <div className="mt-4 flex gap-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} width="80px" height="32px" rounded="sm" />
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} height="72px" rounded="lg" />
        ))}
      </div>
    </PageContainer>
  );
}
