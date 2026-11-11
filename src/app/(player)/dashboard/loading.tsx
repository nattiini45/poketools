import Skeleton from "@/components/ui/Skeleton";
import PageContainer from "@/components/ui/PageContainer";

export default function DashboardLoading() {
  return (
    <PageContainer maxWidth="lg">
      <div className="flex flex-col gap-6">
        {/* Greeting slab */}
        <Skeleton height="132px" rounded="lg" />

        {/* "Now" queue */}
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton height="148px" rounded="lg" />
          <Skeleton height="148px" rounded="lg" />
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} width="112px" height="60px" rounded="sm" />
          ))}
        </div>

        {/* Leagues and tournaments */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton height="220px" rounded="lg" />
          <Skeleton height="220px" rounded="lg" />
        </div>

        {/* History */}
        <Skeleton height="72px" rounded="lg" />
      </div>
    </PageContainer>
  );
}
