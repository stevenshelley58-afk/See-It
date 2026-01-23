import { Store } from "lucide-react";
import { Shell, PageHeader, Card, CardContent } from "@/components/layout/shell";

export default function ShopsPage() {
  return (
    <Shell>
      <PageHeader
        title="Shops"
        description="View and manage connected shops"
      />

      <Card>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Store className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              Shops List
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
