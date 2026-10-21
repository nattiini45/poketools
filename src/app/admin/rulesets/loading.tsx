import Skeleton from "@/components/ui/Skeleton";
import PokeballSpinner from "@/components/shared/PokeballSpinner";
import PageContainer from "@/components/ui/PageContainer";

export default function AdminRulesetsLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      <PokeballSpinner className="py-6" />
      <Skeleton width="180px" height="32px" rounded="md" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} height="120px" rounded="lg" />
        ))}
      </div>
    </PageContainer>
  );
}
