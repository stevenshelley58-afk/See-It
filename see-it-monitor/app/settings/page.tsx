"use client";

import { useState, useCallback } from "react";
import type { ComponentType } from "react";
import {
  Settings,
  Key,
  Cpu,
  FileText,
  Database,
  Shield,
  Bell,
  Palette,
  RefreshCw,
  Save,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  Copy,
  ChevronRight,
  Zap,
  Clock,
  DollarSign,
  TrendingUp,
  Server,
  Lock,
  Unlock,
  RotateCcw,
  Download,
  Upload,
  Terminal,
  Sparkles,
  Layers,
  Sliders,
  Activity,
  BarChart3,
  Gauge,
} from "lucide-react";
import {
  Shell,
  PageHeader,
  Card,
  CardHeader,
  CardContent,
  Badge,
} from "@/components/layout/shell";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  isActive: boolean;
  isPrimary: boolean;
}

interface PromptVersion {
  version: number;
  name: string;
  createdAt: string;
  isActive: boolean;
  description: string;
  successRate?: number;
  avgLatency?: number;
}

interface ApiKeyConfig {
  id: string;
  name: string;
  provider: string;
  lastUsed: string | null;
  createdAt: string;
  isActive: boolean;
  usageThisMonth: number;
  limit: number | null;
}

interface ThresholdConfig {
  failureRateWarning: number;
  failureRateCritical: number;
  latencyP95Warning: number;
  latencyP95Critical: number;
  errorBurstThreshold: number;
  errorBurstWindow: number;
}

// =============================================================================
// Mock Data (would come from API in production)
// =============================================================================

const MOCK_MODELS: ModelConfig[] = [
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    contextWindow: 128000,
    maxTokens: 4096,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    isActive: true,
    isPrimary: true,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    contextWindow: 128000,
    maxTokens: 16384,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
    isActive: true,
    isPrimary: false,
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    contextWindow: 200000,
    maxTokens: 8192,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    isActive: false,
    isPrimary: false,
  },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    contextWindow: 1000000,
    maxTokens: 8192,
    costPer1kInput: 0.000075,
    costPer1kOutput: 0.0003,
    isActive: false,
    isPrimary: false,
  },
];

const MOCK_PROMPTS: PromptVersion[] = [
  {
    version: 7,
    name: "Photorealistic Enhancement v2",
    createdAt: "2026-01-20T10:30:00Z",
    isActive: true,
    description: "Improved lighting and shadow handling with material-aware processing",
    successRate: 94.2,
    avgLatency: 3420,
  },
  {
    version: 6,
    name: "Photorealistic Enhancement v1",
    createdAt: "2026-01-15T14:20:00Z",
    isActive: false,
    description: "Initial photorealistic mode with environment mapping",
    successRate: 89.7,
    avgLatency: 3180,
  },
  {
    version: 5,
    name: "Production Stable",
    createdAt: "2026-01-10T09:15:00Z",
    isActive: false,
    description: "Stable production prompt with balanced quality/speed",
    successRate: 91.3,
    avgLatency: 2890,
  },
  {
    version: 4,
    name: "Fast Mode Experiment",
    createdAt: "2026-01-05T16:45:00Z",
    isActive: false,
    description: "Experimental fast mode with reduced quality",
    successRate: 87.1,
    avgLatency: 1940,
  },
];

const MOCK_API_KEYS: ApiKeyConfig[] = [
  {
    id: "key-1",
    name: "Production Primary",
    provider: "OpenAI",
    lastUsed: "2026-01-23T08:45:00Z",
    createdAt: "2025-12-01T10:00:00Z",
    isActive: true,
    usageThisMonth: 847250,
    limit: 2000000,
  },
  {
    id: "key-2",
    name: "Production Backup",
    provider: "OpenAI",
    lastUsed: "2026-01-22T14:30:00Z",
    createdAt: "2025-12-01T10:05:00Z",
    isActive: true,
    usageThisMonth: 12400,
    limit: 500000,
  },
  {
    id: "key-3",
    name: "Anthropic Primary",
    provider: "Anthropic",
    lastUsed: null,
    createdAt: "2026-01-10T09:00:00Z",
    isActive: false,
    usageThisMonth: 0,
    limit: null,
  },
];

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  failureRateWarning: 5,
  failureRateCritical: 15,
  latencyP95Warning: 5000,
  latencyP95Critical: 10000,
  errorBurstThreshold: 10,
  errorBurstWindow: 60,
};

// =============================================================================
// Tab Configuration
// =============================================================================

type TabId = "models" | "prompts" | "api-keys" | "thresholds" | "advanced";

interface TabConfig {
  id: TabId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
}

const TABS: TabConfig[] = [
  {
    id: "models",
    label: "Models",
    icon: Cpu,
    description: "Configure AI models and providers",
  },
  {
    id: "prompts",
    label: "Prompt Pack",
    icon: FileText,
    description: "Manage prompt versions and A/B testing",
  },
  {
    id: "api-keys",
    label: "API Keys",
    icon: Key,
    description: "Manage provider credentials",
  },
  {
    id: "thresholds",
    label: "Thresholds",
    icon: Gauge,
    description: "Alert and health thresholds",
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Sliders,
    description: "System configuration and debugging",
  },
];

// =============================================================================
// Utility Components
// =============================================================================

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full",
        active ? "bg-emerald-500" : "bg-gray-300"
      )}
    />
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
        checked ? "bg-primary-600" : "bg-gray-200",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

function ProgressBar({
  value,
  max,
  warning,
  critical,
}: {
  value: number;
  max: number;
  warning?: number;
  critical?: number;
}) {
  const percent = Math.min((value / max) * 100, 100);
  const warningThreshold = warning ? (warning / max) * 100 : 80;
  const criticalThreshold = critical ? (critical / max) * 100 : 95;

  let color = "bg-emerald-500";
  if (percent >= criticalThreshold) color = "bg-red-500";
  else if (percent >= warningThreshold) color = "bg-amber-500";

  return (
    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-500", color)}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// =============================================================================
// Models Panel
// =============================================================================

function ModelsPanel() {
  const [models, setModels] = useState<ModelConfig[]>(MOCK_MODELS);
  const [saving, setSaving] = useState(false);

  const toggleModel = (id: string) => {
    setModels((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isActive: !m.isActive } : m))
    );
  };

  const setPrimary = (id: string) => {
    setModels((prev) =>
      prev.map((m) => ({
        ...m,
        isPrimary: m.id === id,
        isActive: m.id === id ? true : m.isActive,
      }))
    );
  };

  const handleSave = async () => {
    setSaving(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {/* Model Cards */}
      <div className="grid gap-4">
        {models.map((model) => (
          <div
            key={model.id}
            className={cn(
              "relative p-5 rounded-xl border-2 transition-all duration-200",
              model.isPrimary
                ? "border-primary-500 bg-primary-50/50"
                : model.isActive
                ? "border-gray-200 bg-white hover:border-gray-300"
                : "border-gray-100 bg-gray-50/50 opacity-60"
            )}
          >
            {model.isPrimary && (
              <div className="absolute -top-3 left-4">
                <Badge variant="success" className="text-xs font-medium">
                  <Zap className="h-3 w-3 mr-1" />
                  Primary Model
                </Badge>
              </div>
            )}

            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <StatusDot active={model.isActive} />
                  <h3 className="text-lg font-semibold text-gray-900">
                    {model.name}
                  </h3>
                  <Badge variant="default" className="text-xs">
                    {model.provider}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Context Window
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {(model.contextWindow / 1000).toFixed(0)}K tokens
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Max Output
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {(model.maxTokens / 1000).toFixed(0)}K tokens
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Input Cost
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      ${model.costPer1kInput}/1K
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Output Cost
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      ${model.costPer1kOutput}/1K
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-3">
                <ToggleSwitch
                  checked={model.isActive}
                  onChange={() => toggleModel(model.id)}
                  disabled={model.isPrimary}
                />
                {!model.isPrimary && model.isActive && (
                  <button
                    onClick={() => setPrimary(model.id)}
                    className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Set as Primary
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Model Button */}
      <button className="w-full p-4 border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700">
        <Plus className="h-5 w-5" />
        <span className="font-medium">Add Custom Model</span>
      </button>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Prompts Panel
// =============================================================================

function PromptsPanel() {
  const [prompts, setPrompts] = useState<PromptVersion[]>(MOCK_PROMPTS);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);

  const activatePrompt = (version: number) => {
    setPrompts((prev) =>
      prev.map((p) => ({
        ...p,
        isActive: p.version === version,
      }))
    );
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      {/* Active Version Highlight */}
      {prompts.find((p) => p.isActive) && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-900">
                Active: {prompts.find((p) => p.isActive)?.name}
              </p>
              <p className="text-xs text-emerald-700">
                Version {prompts.find((p) => p.isActive)?.version} •{" "}
                {prompts.find((p) => p.isActive)?.successRate}% success rate
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Version Timeline */}
      <div className="relative">
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

        <div className="space-y-4">
          {prompts.map((prompt, index) => (
            <div
              key={prompt.version}
              className={cn(
                "relative pl-14 transition-all duration-200",
                prompt.isActive ? "opacity-100" : "opacity-75 hover:opacity-100"
              )}
            >
              {/* Timeline Node */}
              <div
                className={cn(
                  "absolute left-4 w-4 h-4 rounded-full border-2 bg-white",
                  prompt.isActive
                    ? "border-emerald-500 bg-emerald-500"
                    : "border-gray-300"
                )}
              />

              {/* Card */}
              <div
                className={cn(
                  "p-4 rounded-xl border transition-all cursor-pointer",
                  prompt.isActive
                    ? "border-emerald-200 bg-white shadow-sm"
                    : "border-gray-200 hover:border-gray-300"
                )}
                onClick={() =>
                  setExpandedVersion(
                    expandedVersion === prompt.version ? null : prompt.version
                  )
                }
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-gray-900">{prompt.name}</h4>
                      <Badge
                        variant={prompt.isActive ? "success" : "default"}
                        className="text-xs"
                      >
                        v{prompt.version}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {prompt.description}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      {formatDate(prompt.createdAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    {prompt.successRate !== undefined && (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Success</p>
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            prompt.successRate >= 90
                              ? "text-emerald-600"
                              : prompt.successRate >= 80
                              ? "text-amber-600"
                              : "text-red-600"
                          )}
                        >
                          {prompt.successRate}%
                        </p>
                      </div>
                    )}
                    {prompt.avgLatency !== undefined && (
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Avg Latency</p>
                        <p className="text-sm font-semibold text-gray-700">
                          {(prompt.avgLatency / 1000).toFixed(1)}s
                        </p>
                      </div>
                    )}
                    <ChevronRight
                      className={cn(
                        "h-5 w-5 text-gray-400 transition-transform",
                        expandedVersion === prompt.version && "rotate-90"
                      )}
                    />
                  </div>
                </div>

                {/* Expanded Actions */}
                {expandedVersion === prompt.version && (
                  <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-3">
                    {!prompt.isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          activatePrompt(prompt.version);
                        }}
                        className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
                      >
                        <Zap className="h-4 w-4" />
                        Activate This Version
                      </button>
                    )}
                    <button className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      View Prompt
                    </button>
                    <button className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                      <Copy className="h-4 w-4" />
                      Clone
                    </button>
                    <button className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      View Stats
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create New Version */}
      <button className="w-full p-4 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-300 hover:bg-primary-50/50 transition-colors flex items-center justify-center gap-2 text-gray-500 hover:text-primary-600">
        <Sparkles className="h-5 w-5" />
        <span className="font-medium">Create New Prompt Version</span>
      </button>
    </div>
  );
}

// =============================================================================
// API Keys Panel
// =============================================================================

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyConfig[]>(MOCK_API_KEYS);
  const [showAddModal, setShowAddModal] = useState(false);

  const toggleKey = (id: string) => {
    setKeys((prev) =>
      prev.map((k) => (k.id === id ? { ...k, isActive: !k.isActive } : k))
    );
  };

  const deleteKey = (id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatUsage = (usage: number) => {
    if (usage >= 1000000) return `${(usage / 1000000).toFixed(1)}M`;
    if (usage >= 1000) return `${(usage / 1000).toFixed(0)}K`;
    return usage.toString();
  };

  return (
    <div className="space-y-6">
      {/* Security Notice */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <Shield className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-900">
            API keys are encrypted and never exposed to the client
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Keys are stored server-side and proxied through your API layer.
            Actual key values are not retrievable after initial setup.
          </p>
        </div>
      </div>

      {/* Key Cards */}
      <div className="space-y-4">
        {keys.map((key) => (
          <div
            key={key.id}
            className={cn(
              "p-5 rounded-xl border-2 transition-all",
              key.isActive
                ? "border-gray-200 bg-white"
                : "border-gray-100 bg-gray-50/50 opacity-60"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <StatusDot active={key.isActive} />
                  <h4 className="font-medium text-gray-900">{key.name}</h4>
                  <Badge variant="default" className="text-xs">
                    {key.provider}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Last Used
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(key.lastUsed)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Created
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {formatDate(key.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Usage This Month
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {formatUsage(key.usageThisMonth)} tokens
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Limit
                    </p>
                    <p className="text-sm font-medium text-gray-900">
                      {key.limit ? formatUsage(key.limit) : "Unlimited"}
                    </p>
                  </div>
                </div>

                {/* Usage Progress */}
                {key.limit && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-gray-500">
                        {((key.usageThisMonth / key.limit) * 100).toFixed(1)}% of
                        limit used
                      </p>
                    </div>
                    <ProgressBar
                      value={key.usageThisMonth}
                      max={key.limit}
                      warning={key.limit * 0.8}
                      critical={key.limit * 0.95}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <ToggleSwitch
                  checked={key.isActive}
                  onChange={() => toggleKey(key.id)}
                />
                <button
                  onClick={() => deleteKey(key.id)}
                  className="p-2 hover:bg-red-50 rounded-lg transition-colors text-gray-400 hover:text-red-500"
                  title="Delete key"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Key Button */}
      <button
        onClick={() => setShowAddModal(true)}
        className="w-full p-4 border-2 border-dashed border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-gray-500 hover:text-gray-700"
      >
        <Plus className="h-5 w-5" />
        <span className="font-medium">Add API Key</span>
      </button>
    </div>
  );
}

// =============================================================================
// Thresholds Panel
// =============================================================================

function ThresholdsPanel() {
  const [thresholds, setThresholds] = useState<ThresholdConfig>(DEFAULT_THRESHOLDS);
  const [saving, setSaving] = useState(false);

  const handleChange = (key: keyof ThresholdConfig, value: number) => {
    setThresholds((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  const handleReset = () => {
    setThresholds(DEFAULT_THRESHOLDS);
  };

  return (
    <div className="space-y-6">
      {/* Failure Rate Thresholds */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Failure Rate Thresholds</h4>
            <p className="text-sm text-gray-500">
              Trigger alerts when failure rate exceeds these values
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Warning Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="25"
                value={thresholds.failureRateWarning}
                onChange={(e) =>
                  handleChange("failureRateWarning", parseInt(e.target.value))
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <span className="w-16 text-right font-mono text-sm text-amber-600">
                {thresholds.failureRateWarning}%
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Critical Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="5"
                max="50"
                value={thresholds.failureRateCritical}
                onChange={(e) =>
                  handleChange("failureRateCritical", parseInt(e.target.value))
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <span className="w-16 text-right font-mono text-sm text-red-600">
                {thresholds.failureRateCritical}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Latency Thresholds */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Latency Thresholds (P95)</h4>
            <p className="text-sm text-gray-500">
              95th percentile response time limits
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Warning Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1000"
                max="15000"
                step="500"
                value={thresholds.latencyP95Warning}
                onChange={(e) =>
                  handleChange("latencyP95Warning", parseInt(e.target.value))
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <span className="w-20 text-right font-mono text-sm text-amber-600">
                {(thresholds.latencyP95Warning / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Critical Threshold
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="2000"
                max="30000"
                step="1000"
                value={thresholds.latencyP95Critical}
                onChange={(e) =>
                  handleChange("latencyP95Critical", parseInt(e.target.value))
                }
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <span className="w-20 text-right font-mono text-sm text-red-600">
                {(thresholds.latencyP95Critical / 1000).toFixed(1)}s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error Burst Detection */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <TrendingUp className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Error Burst Detection</h4>
            <p className="text-sm text-gray-500">
              Alert when errors spike within a time window
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Error Count Threshold
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={thresholds.errorBurstThreshold}
              onChange={(e) =>
                handleChange("errorBurstThreshold", parseInt(e.target.value))
              }
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Number of errors to trigger alert
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Time Window (seconds)
            </label>
            <input
              type="number"
              min="10"
              max="600"
              value={thresholds.errorBurstWindow}
              onChange={(e) =>
                handleChange("errorBurstWindow", parseInt(e.target.value))
              }
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Rolling window for burst detection
            </p>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleReset}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Thresholds"}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Advanced Panel
// =============================================================================

function AdvancedPanel() {
  const [debugMode, setDebugMode] = useState(false);
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);
  const [samplingRate, setSamplingRate] = useState(100);

  return (
    <div className="space-y-6">
      {/* Debug & Logging */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-gray-100 rounded-lg">
            <Terminal className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Debug & Logging</h4>
            <p className="text-sm text-gray-500">
              Enable additional debugging features
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Debug Mode</p>
              <p className="text-sm text-gray-500">
                Exposes additional diagnostic data in API responses
              </p>
            </div>
            <ToggleSwitch checked={debugMode} onChange={setDebugMode} />
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">Verbose Logging</p>
              <p className="text-sm text-gray-500">
                Log all requests and responses (impacts performance)
              </p>
            </div>
            <ToggleSwitch checked={verboseLogging} onChange={setVerboseLogging} />
          </div>
        </div>
      </div>

      {/* Data Retention */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Database className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Data Retention</h4>
            <p className="text-sm text-gray-500">
              Configure how long to keep monitoring data
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Retention Period
            </label>
            <select
              value={retentionDays}
              onChange={(e) => setRetentionDays(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Telemetry Sampling Rate
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="10"
                max="100"
                step="10"
                value={samplingRate}
                onChange={(e) => setSamplingRate(parseInt(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-500"
              />
              <span className="w-16 text-right font-mono text-sm text-gray-600">
                {samplingRate}%
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Percentage of requests to capture detailed telemetry
            </p>
          </div>
        </div>
      </div>

      {/* Import/Export */}
      <div className="p-5 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Layers className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Configuration Backup</h4>
            <p className="text-sm text-gray-500">
              Export or import all settings
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button className="flex-1 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-gray-700">
            <Download className="h-4 w-4" />
            Export Config
          </button>
          <button className="flex-1 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-gray-700">
            <Upload className="h-4 w-4" />
            Import Config
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="p-5 rounded-xl border-2 border-red-200 bg-red-50/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h4 className="font-medium text-red-900">Danger Zone</h4>
            <p className="text-sm text-red-700">
              Irreversible actions - proceed with caution
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <button className="w-full px-4 py-3 border border-red-200 bg-white text-red-700 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-2 font-medium">
            <Trash2 className="h-4 w-4" />
            Purge All Monitoring Data
          </button>
          <button className="w-full px-4 py-3 border border-red-200 bg-white text-red-700 rounded-lg hover:bg-red-50 transition-colors flex items-center justify-center gap-2 font-medium">
            <RotateCcw className="h-4 w-4" />
            Reset All Settings to Default
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Settings Page
// =============================================================================

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("models");

  const renderPanel = () => {
    switch (activeTab) {
      case "models":
        return <ModelsPanel />;
      case "prompts":
        return <PromptsPanel />;
      case "api-keys":
        return <ApiKeysPanel />;
      case "thresholds":
        return <ThresholdsPanel />;
      case "advanced":
        return <AdvancedPanel />;
      default:
        return null;
    }
  };

  return (
    <Shell className="max-w-6xl mx-auto">
      <PageHeader
        title="Settings"
        description="Configure models, prompts, API keys, and system thresholds"
      />

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar Navigation */}
        <nav className="lg:w-64 shrink-0">
          <div className="sticky top-6 space-y-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full flex items-start gap-3 p-3 rounded-xl transition-all text-left",
                    isActive
                      ? "bg-primary-50 border border-primary-200"
                      : "hover:bg-gray-50 border border-transparent"
                  )}
                >
                  <div
                    className={cn(
                      "p-2 rounded-lg shrink-0",
                      isActive
                        ? "bg-primary-100 text-primary-600"
                        : "bg-gray-100 text-gray-500"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p
                      className={cn(
                        "font-medium text-sm",
                        isActive ? "text-primary-900" : "text-gray-700"
                      )}
                    >
                      {tab.label}
                    </p>
                    <p
                      className={cn(
                        "text-xs mt-0.5",
                        isActive ? "text-primary-600" : "text-gray-500"
                      )}
                    >
                      {tab.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Main Content */}
        <main className="flex-1 min-w-0">{renderPanel()}</main>
      </div>
    </Shell>
  );
}
