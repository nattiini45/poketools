import Skeleton from "@/components/ui/Skeleton";
import PokeballSpinner from "@/components/shared/PokeballSpinner";
import PageContainer from "@/components/ui/PageContainer";

export default function AdminLeaguesLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      <PokeballSpinner className="py-6" />
      <Skeleton width="180px" height="32px" rounded="md" />
      <div className="mt-6 space-y-3">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} height="80px" rounded="lg" />
        ))}
      </div>
    </PageContainer>
  );
}
