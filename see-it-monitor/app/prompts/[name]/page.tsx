"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  RefreshCw,
  FileText,
  CheckCircle,
  AlertCircle,
  PowerOff,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Calendar,
  XCircle,
  Activity,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Badge,
  CopyButton,
  Modal,
} from "@/components/layout/shell";
import { cn, formatRelativeTime, formatDateTime, formatLatency } from "@/lib/utils";
import { DraftEditor } from "@/components/prompts/draft-editor";
import { VersionTimeline, VersionDetailModal } from "@/components/prompts/version-timeline";
import { TestPanel } from "@/components/prompts/test-panel";
import type {
  PromptDetailResponse,
  VersionDetail,
  CreateVersionRequest,
  TestPromptRequest,
  TestPromptResponse,
  PromptOverride,
  PromptMetrics,
} from "@/lib/types-prompt-control";

// =============================================================================
// API Functions (will be moved to lib/api.ts)
// =============================================================================

const INTERNAL_API_BASE = "/api";

async function getPromptDetail(shopId: string, promptName: string): Promise<PromptDetailResponse> {
  const url = new URL(
    `${INTERNAL_API_BASE}/shops/${shopId}/prompts/${promptName}`,
    window.location.origin
  );
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch prompt: ${response.status}`);
  }
  return response.json();
}

async function createVersion(
  shopId: string,
  promptName: string,
  data: CreateVersionRequest
): Promise<VersionDetail> {
  const url = new URL(
    `${INTERNAL_API_BASE}/shops/${shopId}/prompts/${promptName}/versions`,
    window.location.origin
  );
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create version: ${response.status}`);
  }
  return response.json();
}

async function activateVersion(
  shopId: string,
  promptName: string,
  versionId: string
): Promise<{ success: boolean; previousActiveId: string | null; newActiveId: string }> {
  const url = new URL(
    `${INTERNAL_API_BASE}/shops/${shopId}/prompts/${promptName}/activate`,
    window.location.origin
  );
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to activate version: ${response.status}`);
  }
  return response.json();
}

async function rollbackVersion(
  shopId: string,
  promptName: string
): Promise<{ previousActiveVersion: number; newActiveVersion: number }> {
  const url = new URL(
    `${INTERNAL_API_BASE}/shops/${shopId}/prompts/${promptName}/rollback`,
    window.location.origin
  );
  const response = await fetch(url.toString(), {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Failed to rollback: ${response.status}`);
  }
  return response.json();
}

async function runTest(
  shopId: string,
  promptName: string,
  request: TestPromptRequest,
  options?: { signal?: AbortSignal }
): Promise<TestPromptResponse> {
  const url = new URL(
    `${INTERNAL_API_BASE}/shops/${shopId}/prompts/${promptName}/test`,
    window.location.origin
  );
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options?.signal,
  });
  if (!response.ok) {
    throw new Error(`Test failed: ${response.status}`);
  }
  return response.json();
}

// =============================================================================
// Mock Data (replace with API)
// =============================================================================

const MOCK_PROMPT_DETAIL: PromptDetailResponse = {
  definition: {
    id: "def_1",
    name: "extractor",
    description: "LLM #1: Extract product placement facts from images and text",
    defaultModel: "gemini-2.5-flash",
    defaultParams: { temperature: 0.2, max_tokens: 4096 },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-22T14:00:00Z",
  },
  activeVersion: {
    id: "ver_1a",
    version: 3,
    status: "ACTIVE",
    systemTemplate: `You are an expert product analyst specializing in home decor and furniture.
Your task is to extract detailed placement information from product images.

Always respond in valid JSON format.`,
    developerTemplate: null,
    userTemplate: `Analyze the following product:

Product Title: {{product.title}}
Product Type: {{product.type}}
Description: {{product.description}}

Extract:
1. Primary product category
2. Typical room placements (living room, bedroom, etc.)
3. Style attributes (modern, rustic, etc.)
4. Material composition
5. Size category (small, medium, large)`,
    model: "gemini-2.5-flash",
    params: { temperature: 0.2, max_tokens: 4096 },
    templateHash: "abc123def456789",
    changeNotes: "Improved extraction accuracy for furniture",
    createdAt: "2026-01-18T10:00:00Z",
    createdBy: "steven@labcast.com.au",
    activatedAt: "2026-01-20T10:30:00Z",
    activatedBy: "steven@labcast.com.au",
  },
  draftVersion: {
    id: "ver_1b",
    version: 4,
    status: "DRAFT",
    systemTemplate: `You are an expert product analyst specializing in home decor and furniture.
Your task is to extract detailed placement information from product images.

IMPORTANT: Be specific about room placements and provide confidence scores.

Always respond in valid JSON format.`,
    developerTemplate: null,
    userTemplate: `Analyze the following product:

Product Title: {{product.title}}
Product Type: {{product.type}}
Description: {{product.description}}

Extract with confidence scores (0-1):
1. Primary product category (confidence: X)
2. Typical room placements with confidence
3. Style attributes with confidence
4. Material composition
5. Size category (small, medium, large)
6. Price range estimate`,
    model: "gemini-2.5-flash",
    params: { temperature: 0.3, max_tokens: 4096 },
    templateHash: "xyz789abc123456",
    changeNotes: "Added confidence scores and price range",
    createdAt: "2026-01-22T14:00:00Z",
    createdBy: "steven@labcast.com.au",
    activatedAt: null,
    activatedBy: null,
  },
  versions: [
    {
      id: "ver_1b",
      version: 4,
      model: "gemini-2.5-flash",
      templateHash: "xyz789abc123456",
      createdAt: "2026-01-22T14:00:00Z",
      activatedAt: null,
    },
    {
      id: "ver_1a",
      version: 3,
      model: "gemini-2.5-flash",
      templateHash: "abc123def456789",
      createdAt: "2026-01-18T10:00:00Z",
      activatedAt: "2026-01-20T10:30:00Z",
    },
    {
      id: "ver_1c",
      version: 2,
      model: "gemini-2.5-flash",
      templateHash: "def456ghi789012",
      createdAt: "2026-01-10T09:00:00Z",
      activatedAt: "2026-01-12T11:00:00Z",
    },
    {
      id: "ver_1d",
      version: 1,
      model: "gemini-2.5-flash",
      templateHash: "ghi789jkl012345",
      createdAt: "2026-01-01T00:00:00Z",
      activatedAt: "2026-01-01T12:00:00Z",
    },
  ],
  metrics: {
    calls24h: 1247,
    successRate24h: 97.2,
    latencyP50: 2340,
    latencyP95: 4120,
    avgCost: 0.0023,
  },
};

// =============================================================================
// Status Badge Component
// =============================================================================

function PromptStatusBadge({
  activeVersion,
  draftVersion,
  isDisabled,
}: {
  activeVersion: VersionDetail | null;
  draftVersion: VersionDetail | null;
  isDisabled: boolean;
}) {
  if (isDisabled) {
    return (
      <Badge variant="error" className="flex items-center gap-1">
        <PowerOff className="h-3 w-3" />
        Disabled
      </Badge>
    );
  }
  if (!activeVersion) {
    return (
      <Badge variant="warning" className="flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        No Active Version
      </Badge>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge variant="success" className="flex items-center gap-1">
        <CheckCircle className="h-3 w-3" />
        Active v{activeVersion.version}
      </Badge>
      {draftVersion && (
        <Badge variant="warning" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Draft v{draftVersion.version}
        </Badge>
      )}
    </div>
  );
}

// =============================================================================
// Active Version Card Component
// =============================================================================

function ActiveVersionCard({ version }: { version: VersionDetail }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Active Version"
        description={`v${version.version} - Activated ${formatRelativeTime(version.activatedAt!)}`}
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-mono">
              {version.templateHash.slice(0, 12)}
            </span>
            <CopyButton value={version.templateHash} />
          </div>
        }
      />
      <CardContent>
        {/* Metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-gray-500 uppercase">Model</p>
            <p className="text-sm font-medium font-mono">{version.model}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Activated</p>
            <p className="text-sm font-medium">{formatDateTime(version.activatedAt!)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Activated By</p>
            <p className="text-sm font-medium">{version.activatedBy}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Created</p>
            <p className="text-sm font-medium">{formatDateTime(version.createdAt)}</p>
          </div>
        </div>

        {/* Parameters */}
        {version.params && Object.keys(version.params).length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 uppercase mb-1">Parameters</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(version.params).map(([key, value]) => (
                <span key={key} className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                  {key}: {String(value)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Change Notes */}
        {version.changeNotes && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500 uppercase mb-1">Change Notes</p>
            <p className="text-sm text-gray-700">{version.changeNotes}</p>
          </div>
        )}

        {/* Template Preview (collapsible) */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="text-sm font-medium text-gray-700">Template Preview</span>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-500" />
            )}
          </button>
          {expanded && (
            <div className="divide-y divide-gray-100">
              {version.systemTemplate && (
                <div className="p-3">
                  <Badge className="mb-2">System</Badge>
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-48 overflow-auto">
                    {version.systemTemplate}
                  </pre>
                </div>
              )}
              {version.developerTemplate && (
                <div className="p-3">
                  <Badge className="mb-2">Developer</Badge>
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-48 overflow-auto">
                    {version.developerTemplate}
                  </pre>
                </div>
              )}
              {version.userTemplate && (
                <div className="p-3">
                  <Badge className="mb-2">User</Badge>
                  <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-48 overflow-auto">
                    {version.userTemplate}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Metrics Sidebar Component
// =============================================================================

function MetricsSidebar({ metrics }: { metrics: PromptMetrics }) {
  const errorRate = metrics.successRate24h > 0 ? 100 - metrics.successRate24h : 0;

  return (
    <Card>
      <CardHeader title="Metrics" description="Last 24 hours" />
      <CardContent className="space-y-4">
        {/* Calls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Activity className="h-4 w-4" />
            Calls
          </div>
          <span className="text-lg font-semibold text-gray-900">
            {metrics.calls24h.toLocaleString()}
          </span>
        </div>

        {/* Success Rate */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp className="h-4 w-4" />
              Success Rate
            </div>
            <span
              className={cn(
                "text-lg font-semibold",
                metrics.successRate24h >= 95
                  ? "text-emerald-600"
                  : metrics.successRate24h >= 90
                  ? "text-amber-600"
                  : "text-red-600"
              )}
            >
              {metrics.successRate24h.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                metrics.successRate24h >= 95
                  ? "bg-emerald-500"
                  : metrics.successRate24h >= 90
                  ? "bg-amber-500"
                  : "bg-red-500"
              )}
              style={{ width: `${metrics.successRate24h}%` }}
            />
          </div>
        </div>

        {/* Latency */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
              <Clock className="h-3 w-3" />
              p50 Latency
            </div>
            <p className="text-sm font-semibold text-gray-900">
              {metrics.latencyP50 ? formatLatency(metrics.latencyP50) : "—"}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
              <Clock className="h-3 w-3" />
              p95 Latency
            </div>
            <p
              className={cn(
                "text-sm font-semibold",
                metrics.latencyP95 && metrics.latencyP95 > 5000
                  ? "text-amber-600"
                  : "text-gray-900"
              )}
            >
              {metrics.latencyP95 ? formatLatency(metrics.latencyP95) : "—"}
            </p>
          </div>
        </div>

        {/* Cost */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <DollarSign className="h-4 w-4" />
            Avg Cost
          </div>
          <span className="text-lg font-semibold text-gray-900">
            ${metrics.avgCost?.toFixed(4) || "—"}
          </span>
        </div>

        {/* Error Breakdown */}
        {errorRate > 0 && (
          <div className="pt-3 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
              <AlertTriangle className="h-4 w-4" />
              Error Rate
            </div>
            <p
              className={cn(
                "text-lg font-semibold",
                errorRate > 5 ? "text-red-600" : "text-amber-600"
              )}
            >
              {errorRate.toFixed(1)}%
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Loading Skeletons
// =============================================================================

function HeaderSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-96" />
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card>
      <CardContent>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function PromptDetailPage() {
  const params = useParams();
  const promptName = params.name as string;
  const queryClient = useQueryClient();

  // TODO: Get shopId from context or session
  const shopId = "shop_123";

  // State for version detail modal
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [activatingVersionId, setActivatingVersionId] = useState<string | null>(null);

  // Query for prompt detail
  const {
    data: promptData,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["prompts", shopId, promptName],
    queryFn: async () => {
      // Simulate API delay - replace with actual API call
      await new Promise((r) => setTimeout(r, 500));
      return MOCK_PROMPT_DETAIL;
      // return getPromptDetail(shopId, promptName);
    },
  });

  // Mutation for creating/updating draft
  const saveDraftMutation = useMutation({
    mutationFn: (data: CreateVersionRequest) => createVersion(shopId, promptName, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts", shopId, promptName] });
    },
  });

  // Mutation for activating version
  const activateMutation = useMutation({
    mutationFn: (versionId: string) => activateVersion(shopId, promptName, versionId),
    onMutate: (versionId) => {
      setActivatingVersionId(versionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts", shopId, promptName] });
      setSelectedVersionId(null);
    },
    onSettled: () => {
      setActivatingVersionId(null);
    },
  });

  // Handler for save draft
  const handleSaveDraft = async (data: CreateVersionRequest) => {
    await saveDraftMutation.mutateAsync(data);
  };

  // Handler for discard draft
  const handleDiscardDraft = async () => {
    // TODO: Implement discard draft API
    console.log("Discard draft");
    await refetch();
  };

  // Handler for activate draft
  const handleActivateDraft = async (versionId: string) => {
    await activateMutation.mutateAsync(versionId);
  };

  // Handler for run test
  const handleRunTest = async (
    request: TestPromptRequest,
    options?: { signal?: AbortSignal }
  ): Promise<TestPromptResponse> => {
    // Simulate test run - replace with actual API call
    // Support cancellation in mock mode by racing with abort signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 2000);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    return {
      testRunId: "test_123",
      status: "succeeded",
      output: {
        category: "Coffee Table",
        placements: ["Living Room", "Study"],
        styles: ["Modern", "Minimalist"],
        materials: ["Teak", "Metal"],
        size: "medium",
      },
      latencyMs: 2340,
      tokensIn: 1250,
      tokensOut: 340,
      costEstimate: 0.0023,
      providerRequestId: "req_abc123def456",
      providerModel: "gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: "You are an expert product analyst...",
        },
        {
          role: "user",
          content: "Analyze the following product:\n\nProduct Title: Teak Coffee Table...",
        },
      ],
      resolutionHash: "hash123456",
    };
    // return runTest(shopId, promptName, request, options);
  };

  // Handler for promote to draft
  const handlePromoteToDraft = async (overrides: PromptOverride) => {
    console.log("Promote to draft with overrides:", overrides);
    // TODO: Create new draft with overrides
  };

  // Handler for view version detail
  const handleViewVersionDetail = (versionId: string) => {
    setSelectedVersionId(versionId);
  };

  // Get selected version for modal
  const selectedVersion = selectedVersionId
    ? promptData?.versions.find((v) => v.id === selectedVersionId)
    : null;

  // Get full version detail for modal (would need separate query in real app)
  const selectedVersionDetail: VersionDetail | null = selectedVersion
    ? {
        ...selectedVersion,
        status:
          selectedVersion.id === promptData?.activeVersion?.id
            ? "ACTIVE"
            : selectedVersion.id === promptData?.draftVersion?.id
            ? "DRAFT"
            : "ARCHIVED",
        systemTemplate: promptData?.activeVersion?.systemTemplate || null,
        developerTemplate: promptData?.activeVersion?.developerTemplate || null,
        userTemplate: promptData?.activeVersion?.userTemplate || null,
        params: promptData?.activeVersion?.params || null,
        changeNotes: null,
        createdBy: "user@example.com",
        activatedBy: selectedVersion.activatedAt ? "user@example.com" : null,
      }
    : null;

  return (
    <Shell>
      {/* Back Link */}
      <div className="mb-4">
        <Link
          href="/prompts"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Prompts
        </Link>
      </div>

      {/* Header */}
      {isLoading ? (
        <HeaderSkeleton />
      ) : promptData ? (
        <PageHeader
          title={promptData.definition.name}
          description={promptData.definition.description || "No description"}
        >
          <div className="flex items-center gap-4">
            <PromptStatusBadge
              activeVersion={promptData.activeVersion}
              draftVersion={promptData.draftVersion}
              isDisabled={false}
            />
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className={cn(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors",
                isFetching && "animate-spin"
              )}
            >
              <RefreshCw className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </PageHeader>
      ) : null}

      {/* Error State */}
      {isError && (
        <Card className="mb-6">
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <XCircle className="h-8 w-8 text-red-500 mb-3" />
              <p className="text-sm text-gray-600 mb-4">
                Failed to load prompt: {(error as Error)?.message || "Unknown error"}
              </p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700"
              >
                Retry
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content */}
      {promptData && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Column */}
          <div className="lg:col-span-3 space-y-6">
            {/* Header Info */}
            <Card>
              <CardContent className="py-3">
                <div className="flex items-center gap-6 text-sm text-gray-600">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    Default Model: <strong>{promptData.definition.defaultModel}</strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                    Created: {formatRelativeTime(promptData.definition.createdAt)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    Updated: {formatRelativeTime(promptData.definition.updatedAt)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Active Version */}
            {promptData.activeVersion ? (
              <ActiveVersionCard version={promptData.activeVersion} />
            ) : (
              <Card>
                <CardContent>
                  <div className="flex flex-col items-center justify-center py-8 text-center text-gray-500">
                    <AlertCircle className="h-8 w-8 mb-2 text-amber-500" />
                    <p className="text-sm">No active version</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Create and activate a version to start using this prompt
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Draft Editor */}
            <DraftEditor
              promptName={promptName}
              draftVersion={promptData.draftVersion}
              activeVersion={promptData.activeVersion}
              defaultModel={promptData.definition.defaultModel}
              defaultParams={promptData.definition.defaultParams}
              modelAllowList={[]} // TODO: Get from runtime config
              onSaveDraft={handleSaveDraft}
              onDiscardDraft={handleDiscardDraft}
              onActivateDraft={handleActivateDraft}
              saving={saveDraftMutation.isPending}
              activating={activateMutation.isPending}
            />

            {/* Version Timeline */}
            <VersionTimeline
              versions={promptData.versions}
              activeVersionId={promptData.activeVersion?.id || null}
              draftVersionId={promptData.draftVersion?.id || null}
              onActivate={handleActivateDraft}
              onViewDetail={handleViewVersionDetail}
              activating={activateMutation.isPending}
              activatingVersionId={activatingVersionId}
            />

            {/* Test Panel */}
            <TestPanel
              promptName={promptName}
              activeVersionId={promptData.activeVersion?.id || null}
              draftVersionId={promptData.draftVersion?.id || null}
              defaultVariables={{
                "product.title": "Reclaimed Teak Coffee Table",
                "product.type": "Coffee Table",
                "product.description": "Handcrafted from reclaimed teak wood...",
              }}
              onRunTest={handleRunTest}
              onPromoteToDraft={handlePromoteToDraft}
            />
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            <MetricsSidebar metrics={promptData.metrics} />
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <div className="lg:col-span-1">
            <CardSkeleton />
          </div>
        </div>
      )}

      {/* Version Detail Modal */}
      {selectedVersionDetail && (
        <VersionDetailModal
          version={selectedVersionDetail}
          isActive={selectedVersionDetail.id === promptData?.activeVersion?.id}
          isDraft={selectedVersionDetail.id === promptData?.draftVersion?.id}
          onClose={() => setSelectedVersionId(null)}
          onActivate={handleActivateDraft}
          activating={activateMutation.isPending}
        />
      )}
    </Shell>
  );
}
