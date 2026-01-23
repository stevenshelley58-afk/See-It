import Link from "next/link";
import { ArrowLeft, Play } from "lucide-react";
import { Shell, PageHeader, Card, CardContent } from "@/components/layout/shell";

interface RunDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;

  return (
    <Shell>
      <div className="mb-4">
        <Link
          href="/runs"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Runs
        </Link>
      </div>

      <PageHeader
        title={`Run ${id}`}
        description="Run details and timeline"
      />

      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Play className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              Run Details
            </h3>
            <p className="text-sm text-gray-500">
              This feature will be available in Stage 2
            </p>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
