import Link from "next/link";
import { ArrowLeft, Store } from "lucide-react";
import { Shell, PageHeader, Card, CardContent } from "@/components/layout/shell";

interface ShopDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ShopDetailPage({ params }: ShopDetailPageProps) {
  const { id } = await params;

  return (
    <Shell>
      <div className="mb-4">
        <Link
          href="/shops"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Shops
        </Link>
      </div>

      <PageHeader
        title={`Shop ${id}`}
        description="Shop details and activity"
      />

      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Store className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              Shop Details
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
