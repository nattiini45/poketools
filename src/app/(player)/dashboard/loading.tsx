import Skeleton from "@/components/ui/Skeleton";
import PageContainer from "@/components/ui/PageContainer";

export default function DashboardLoading() {
  return (
    <PageContainer title="" maxWidth="lg">
      {/* Greeting banner skeleton */}
      <Skeleton height="100px" rounded="lg" />

      {/* Action cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Skeleton height="140px" rounded="lg" />
        <Skeleton height="140px" rounded="lg" />
      </div>

      {/* Recent matches */}
      <div className="mt-6">
        <Skeleton width="160px" height="24px" rounded="sm" />
        <div className="mt-3 space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} height="64px" rounded="lg" />
          ))}
        </div>
      </div>

      {/* Teams */}
      <div className="mt-6">
        <Skeleton width="120px" height="24px" rounded="sm" />
        <div className="mt-3 flex gap-4 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} width="200px" height="100px" rounded="lg" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
