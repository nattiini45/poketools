import Skeleton from "@/components/ui/Skeleton";
import PageContainer from "@/components/ui/PageContainer";

export default function TournamentsLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      <Skeleton width="200px" height="32px" rounded="md" />
      <div className="mt-2">
        <Skeleton width="300px" height="16px" rounded="sm" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} height="140px" rounded="lg" />
        ))}
      </div>
    </PageContainer>
  );
}
