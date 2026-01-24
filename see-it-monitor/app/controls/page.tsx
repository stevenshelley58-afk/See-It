"use client";

import { Suspense, useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gauge,
  Cpu,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  Save,
  Plus,
  X,
  CheckCircle,
  Activity,
  FileText,
  AlertCircle,
  Settings2,
  Store,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardContent,
  Badge,
} from "@/components/layout/shell";
import { cn } from "@/lib/utils";
import {
  getRuntimeConfig,
  updateRuntimeConfig,
  getShops,
  queryKeys,
} from "@/lib/api";
import type {
  RuntimeConfigResponse,
  UpdateRuntimeConfigRequest,
} from "@/lib/types-prompt-control";
import { KNOWN_MODELS } from "@/lib/types-prompt-control";

// =============================================================================
// Constants
// =============================================================================

const AVAILABLE_PROMPTS = [
  "extractor",
  "prompt_builder",
  "global_render",
  "scene_analyzer",
];

// =============================================================================
// Types
// =============================================================================

interface LocalConfig {
  maxConcurrency: number;
  forceFallbackModel: string | null;
  modelAllowList: string[];
  maxTokensOutputCap: number;
  maxImageBytesCap: number;
  dailyCostCap: number;
  disabledPromptNames: string[];
}

interface ToastState {
  visible: boolean;
  type: "success" | "error";
  message: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

function configToLocal(config: RuntimeConfigResponse["config"]): LocalConfig {
  return {
    maxConcurrency: config.maxConcurrency,
    forceFallbackModel: config.forceFallbackModel,
    modelAllowList: config.modelAllowList,
    maxTokensOutputCap: config.maxTokensOutputCap,
    maxImageBytesCap: config.maxImageBytesCap,
    dailyCostCap: config.dailyCostCap,
    disabledPromptNames: config.disabledPromptNames,
  };
}

function hasChanges(local: LocalConfig, server: RuntimeConfigResponse["config"]): boolean {
  return (
    local.maxConcurrency !== server.maxConcurrency ||
    local.forceFallbackModel !== server.forceFallbackModel ||
    JSON.stringify([...local.modelAllowList].sort()) !== JSON.stringify([...server.modelAllowList].sort()) ||
    local.maxTokensOutputCap !== server.maxTokensOutputCap ||
    local.maxImageBytesCap !== server.maxImageBytesCap ||
    local.dailyCostCap !== server.dailyCostCap ||
    JSON.stringify([...local.disabledPromptNames].sort()) !== JSON.stringify([...server.disabledPromptNames].sort())
  );
}

function buildPatch(local: LocalConfig, server: RuntimeConfigResponse["config"]): UpdateRuntimeConfigRequest {
  const patch: UpdateRuntimeConfigRequest = {};

  if (local.maxConcurrency !== server.maxConcurrency) {
    patch.maxConcurrency = local.maxConcurrency;
  }
  if (local.forceFallbackModel !== server.forceFallbackModel) {
    patch.forceFallbackModel = local.forceFallbackModel;
  }
  if (JSON.stringify([...local.modelAllowList].sort()) !== JSON.stringify([...server.modelAllowList].sort())) {
    patch.modelAllowList = local.modelAllowList;
  }
  if (local.maxTokensOutputCap !== server.maxTokensOutputCap) {
    patch.maxTokensOutputCap = local.maxTokensOutputCap;
  }
  if (local.maxImageBytesCap !== server.maxImageBytesCap) {
    patch.maxImageBytesCap = local.maxImageBytesCap;
  }
  if (local.dailyCostCap !== server.dailyCostCap) {
    patch.dailyCostCap = local.dailyCostCap;
  }
  if (JSON.stringify([...local.disabledPromptNames].sort()) !== JSON.stringify([...server.disabledPromptNames].sort())) {
    patch.disabledPromptNames = local.disabledPromptNames;
  }

  return patch;
}

// =============================================================================
// Components
// =============================================================================

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    if (toast.visible) {
      const timer = setTimeout(onClose, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast.visible, onClose]);

  if (!toast.visible) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-2">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg",
          toast.type === "success"
            ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
            : "bg-red-50 border border-red-200 text-red-800"
        )}
      >
        {toast.type === "success" ? (
          <CheckCircle className="h-5 w-5 text-emerald-500" />
        ) : (
          <AlertCircle className="h-5 w-5 text-red-500" />
        )}
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={onClose} className="ml-2 hover:opacity-70">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function TagList({
  values,
  onChange,
  options,
  label,
  emptyMessage,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
  label: string;
  emptyMessage?: string;
}) {
  const [adding, setAdding] = useState(false);
  const available = options.filter((o) => !values.includes(o));

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2 p-3 border border-gray-200 rounded-lg min-h-[48px] bg-white">
        {values.length === 0 && emptyMessage && (
          <span className="text-sm text-gray-400 italic">{emptyMessage}</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-full text-sm"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:text-red-500 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {adding ? (
          <select
            autoFocus
            onChange={(e) => {
              if (e.target.value) {
                onChange([...values, e.target.value]);
              }
              setAdding(false);
            }}
            onBlur={() => setAdding(false)}
            className="text-sm border border-gray-200 rounded-md px-2 py-1"
          >
            <option value="">Select...</option>
            {available.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          available.length > 0 && (
            <button
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  label,
  showPercent = true,
}: {
  value: number;
  max: number;
  label?: string;
  showPercent?: boolean;
}) {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  let color = "bg-emerald-500";
  if (percent >= 90) color = "bg-red-500";
  else if (percent >= 75) color = "bg-amber-500";

  return (
    <div className="space-y-1">
      {(label || showPercent) && (
        <div className="flex justify-between text-xs text-gray-500">
          {label && <span>{label}</span>}
          {showPercent && <span>{percent.toFixed(1)}%</span>}
        </div>
      )}
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ShopSelector({
  selectedShopId,
  onSelect,
}: {
  selectedShopId: string;
  onSelect: (shopId: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.shops.list({ limit: 100 }),
    queryFn: () => getShops({ limit: 100 }),
  });

  const shops = data?.shops ?? [];

  return (
    <div className="flex items-center gap-3">
      <Store className="h-5 w-5 text-gray-400" />
      <select
        value={selectedShopId}
        onChange={(e) => onSelect(e.target.value)}
        disabled={isLoading}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-[200px]"
      >
        <option value="">Select a shop...</option>
        {shops.map((shop) => (
          <option key={shop.shopId} value={shop.shopId}>
            {shop.shopDomain?.replace(".myshopify.com", "") || shop.shopId}
          </option>
        ))}
      </select>
      {isLoading && <RefreshCw className="h-4 w-4 animate-spin text-gray-400" />}
    </div>
  );
}

// =============================================================================
// Loading Fallback
// =============================================================================

function ControlsPageLoading() {
  return (
    <Shell className="max-w-4xl mx-auto">
      <PageHeader
        title="Runtime Controls"
        description="Per-shop runtime configuration for the prompt control plane"
      />

      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="h-10 w-64 bg-gray-200 rounded animate-pulse" />
        </CardContent>
      </Card>

      <div className="space-y-6">
        {[...Array(5)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-4" />
              <div className="h-20 bg-gray-100 rounded animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </Shell>
  );
}

// =============================================================================
// No Shop Selected State
// =============================================================================

function NoShopSelected({
  selectedShopId,
  onSelectShop,
}: {
  selectedShopId: string;
  onSelectShop: (shopId: string) => void;
}) {
  return (
    <Shell className="max-w-4xl mx-auto">
      <PageHeader
        title="Runtime Controls"
        description="Per-shop runtime configuration for the prompt control plane"
      />

      <Card>
        <CardContent className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="p-4 bg-gray-100 rounded-full mb-4">
              <Settings2 className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Select a Shop
            </h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md">
              Runtime controls are configured per shop. Select a shop to view and
              edit its runtime configuration.
            </p>
            <ShopSelector
              selectedShopId={selectedShopId}
              onSelect={onSelectShop}
            />
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}

// =============================================================================
// Main Page Component
// =============================================================================

export default function ControlsPage() {
  return (
    <Suspense fallback={<ControlsPageLoading />}>
      <ControlsPageContent />
    </Suspense>
  );
}

function ControlsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Shop ID from URL
  const shopId = searchParams.get("shopId") || "";

  // Local config state
  const [localConfig, setLocalConfig] = useState<LocalConfig | null>(null);

  // Toast state
  const [toast, setToast] = useState<ToastState>({
    visible: false,
    type: "success",
    message: "",
  });

  // Fetch runtime config
  const {
    data: runtimeData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.shops.runtimeConfig(shopId),
    queryFn: () => getRuntimeConfig(shopId),
    enabled: !!shopId,
  });

  // Initialize local config when server data loads
  useEffect(() => {
    if (runtimeData?.config) {
      setLocalConfig(configToLocal(runtimeData.config));
    }
  }, [runtimeData?.config]);

  // Mutation for saving
  const saveMutation = useMutation({
    mutationFn: (data: UpdateRuntimeConfigRequest) =>
      updateRuntimeConfig(shopId, data),
    onSuccess: (newData) => {
      // Update cache
      queryClient.setQueryData(queryKeys.shops.runtimeConfig(shopId), newData);
      // Update local config
      setLocalConfig(configToLocal(newData.config));
      // Show success toast
      setToast({
        visible: true,
        type: "success",
        message: "Runtime configuration saved successfully",
      });
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Failed to save configuration";
      setToast({
        visible: true,
        type: "error",
        message,
      });
    },
  });

  // Handle shop selection
  const handleSelectShop = useCallback(
    (newShopId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newShopId) {
        params.set("shopId", newShopId);
      } else {
        params.delete("shopId");
      }
      router.replace(`/controls?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // Update handlers
  const updateConfig = useCallback(
    <K extends keyof LocalConfig>(key: K, value: LocalConfig[K]) => {
      setLocalConfig((prev) => (prev ? { ...prev, [key]: value } : null));
    },
    []
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (!localConfig || !runtimeData?.config) return;
    const patch = buildPatch(localConfig, runtimeData.config);
    if (Object.keys(patch).length > 0) {
      saveMutation.mutate(patch);
    }
  }, [localConfig, runtimeData?.config, saveMutation]);

  // Hide toast
  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  // Check for unsaved changes
  const unsavedChanges = useMemo(() => {
    if (!localConfig || !runtimeData?.config) return false;
    return hasChanges(localConfig, runtimeData.config);
  }, [localConfig, runtimeData?.config]);

  // No shop selected
  if (!shopId) {
    return <NoShopSelected selectedShopId={shopId} onSelectShop={handleSelectShop} />;
  }

  // Loading state
  if (isLoading) {
    return <ControlsPageLoading />;
  }

  // Error state
  if (isError) {
    return (
      <Shell className="max-w-4xl mx-auto">
        <PageHeader
          title="Runtime Controls"
          description="Per-shop runtime configuration for the prompt control plane"
        >
          <ShopSelector selectedShopId={shopId} onSelect={handleSelectShop} />
        </PageHeader>

        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center text-center">
              <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Failed to Load Configuration
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <button
                onClick={() => refetch()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // No data yet
  if (!runtimeData || !localConfig) {
    return <ControlsPageLoading />;
  }

  const { config, status } = runtimeData;

  return (
    <Shell className="max-w-4xl mx-auto">
      <PageHeader
        title="Runtime Controls"
        description="Per-shop runtime configuration for the prompt control plane"
      >
        <div className="flex items-center gap-3">
          <ShopSelector selectedShopId={shopId} onSelect={handleSelectShop} />
          {unsavedChanges && <Badge variant="warning">Unsaved changes</Badge>}
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || !unsavedChanges}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saveMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveMutation.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </PageHeader>

      {/* Status Bar */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  Concurrency:{" "}
                  <strong>
                    {status.currentConcurrency}/{localConfig.maxConcurrency}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-gray-400" />
                <span className="text-sm text-gray-600">
                  Daily Cost:{" "}
                  <strong>
                    ${status.dailyCostUsed.toFixed(2)}/${localConfig.dailyCostCap.toFixed(2)}
                  </strong>
                </span>
              </div>
            </div>
            <span className="text-xs text-gray-400">
              Last updated by {config.updatedBy} on{" "}
              {new Date(config.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {/* Concurrency */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Concurrency</h3>
                <p className="text-sm text-gray-500">
                  Control parallel processing capacity for this shop
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Concurrency
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={localConfig.maxConcurrency}
                  onChange={(e) =>
                    updateConfig("maxConcurrency", parseInt(e.target.value))
                  }
                  className="flex-1 accent-primary-500"
                />
                <span className="w-12 text-right font-mono text-sm">
                  {localConfig.maxConcurrency}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                <Activity className="h-3.5 w-3.5" />
                <span>
                  Current active: {status.currentConcurrency} /{" "}
                  {localConfig.maxConcurrency}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Model Controls */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Model Controls</h3>
                <p className="text-sm text-gray-500">
                  Restrict and override model usage
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Force Fallback Model
                </label>
                <select
                  value={localConfig.forceFallbackModel || ""}
                  onChange={(e) =>
                    updateConfig(
                      "forceFallbackModel",
                      e.target.value || null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">None (use prompt defaults)</option>
                  {KNOWN_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Override all model selections with this model
                </p>
              </div>

              <TagList
                values={localConfig.modelAllowList}
                onChange={(v) => updateConfig("modelAllowList", v)}
                options={KNOWN_MODELS.map((m) => m.id)}
                label="Model Allow List"
                emptyMessage="All models allowed (no restrictions)"
              />
            </div>
          </CardContent>
        </Card>

        {/* Caps */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-amber-100 rounded-lg text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Output Caps</h3>
                <p className="text-sm text-gray-500">
                  Limit token and file sizes for safety
                </p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Output Tokens
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1000"
                    max="16000"
                    step="500"
                    value={localConfig.maxTokensOutputCap}
                    onChange={(e) =>
                      updateConfig("maxTokensOutputCap", parseInt(e.target.value))
                    }
                    className="flex-1 accent-primary-500"
                  />
                  <span className="w-16 text-right font-mono text-sm">
                    {localConfig.maxTokensOutputCap.toLocaleString()}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Image Size
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1000000"
                    max="50000000"
                    step="1000000"
                    value={localConfig.maxImageBytesCap}
                    onChange={(e) =>
                      updateConfig("maxImageBytesCap", parseInt(e.target.value))
                    }
                    className="flex-1 accent-primary-500"
                  />
                  <span className="w-16 text-right font-mono text-sm">
                    {(localConfig.maxImageBytesCap / 1000000).toFixed(0)}MB
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Budget */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                <DollarSign className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Budget</h3>
                <p className="text-sm text-gray-500">
                  Daily spending limits for this shop
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Daily Cost Cap
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    min="0.01"
                    max="10000"
                    step="0.01"
                    value={localConfig.dailyCostCap}
                    onChange={(e) =>
                      updateConfig("dailyCostCap", parseFloat(e.target.value) || 0)
                    }
                    className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Current Daily Usage</span>
                  <span className="text-sm font-semibold text-gray-900">
                    ${status.dailyCostUsed.toFixed(2)} / ${localConfig.dailyCostCap.toFixed(2)}
                  </span>
                </div>
                <ProgressBar
                  value={status.dailyCostUsed}
                  max={localConfig.dailyCostCap}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disabled Prompts */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-gray-100 rounded-lg text-gray-600">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Disabled Prompts</h3>
                <p className="text-sm text-gray-500">
                  Prompts that are blocked from execution for this shop
                </p>
              </div>
            </div>

            <TagList
              values={localConfig.disabledPromptNames}
              onChange={(v) => updateConfig("disabledPromptNames", v)}
              options={AVAILABLE_PROMPTS}
              label="Disabled Prompt Names"
              emptyMessage="No prompts disabled (all active)"
            />
          </CardContent>
        </Card>
      </div>

      {/* Toast */}
      <Toast toast={toast} onClose={hideToast} />
    </Shell>
  );
}
