import { Shell, PageHeader, Card, CardContent } from "@/components/layout/shell";

function SkeletonBox({ className }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className ?? ""}`} />;
}

export default function RunDetailLoading() {
  return (
    <Shell>
      {/* Back Link */}
      <div className="mb-4">
        <SkeletonBox className="h-5 w-24" />
      </div>

      {/* Header */}
      <PageHeader title="Run Details" description="Loading run information...">
        <div className="flex items-center gap-4">
          <SkeletonBox className="h-8 w-20" />
          <SkeletonBox className="h-8 w-24" />
        </div>
      </PageHeader>

      {/* Run Info Card Skeleton */}
      <Card className="mb-6">
        <CardContent>
          <div className="space-y-4">
            {/* Top row */}
            <div className="flex justify-between">
              <SkeletonBox className="h-6 w-48" />
              <SkeletonBox className="h-6 w-20" />
            </div>

            {/* Metadata Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <SkeletonBox className="h-3 w-12" />
                  <SkeletonBox className="h-5 w-24" />
                </div>
              ))}
            </div>

            {/* IDs Row */}
            <div className="flex flex-wrap gap-4 pt-4 border-t border-gray-100">
              <SkeletonBox className="h-4 w-32" />
              <SkeletonBox className="h-4 w-32" />
              <SkeletonBox className="h-4 w-32" />
            </div>

            {/* Model/Version Row */}
            <div className="flex flex-wrap gap-4 pt-4 border-t border-gray-100">
              <SkeletonBox className="h-5 w-24" />
              <SkeletonBox className="h-5 w-20" />
              <SkeletonBox className="h-5 w-28" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Waterfall Panel Skeleton */}
      <Card className="mb-6">
        <CardContent>
          <div className="space-y-4">
            <SkeletonBox className="h-5 w-32" />
            <SkeletonBox className="h-6 w-full" />
            <div className="flex gap-4">
              {[...Array(4)].map((_, i) => (
                <SkeletonBox key={i} className="h-4 w-20" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Skeleton */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex space-x-6">
          {[...Array(5)].map((_, i) => (
            <SkeletonBox key={i} className="h-10 w-24" />
          ))}
        </div>
      </div>

      {/* Variants Grid Skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-3">
              <div className="space-y-3">
                <SkeletonBox className="aspect-square w-full" />
                <SkeletonBox className="h-5 w-20" />
                <SkeletonBox className="h-4 w-16" />
                <SkeletonBox className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </Shell>
  );
}
