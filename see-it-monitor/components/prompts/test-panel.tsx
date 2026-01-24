"use client";

import { useState, useRef, useEffect } from "react";
import {
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Zap,
  FileText,
  Plus,
  X,
  ArrowUp,
  Hash,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  CopyButton,
} from "@/components/layout/shell";
import { cn, formatLatency } from "@/lib/utils";
import type {
  TestPromptRequest,
  TestPromptResponse,
  PromptOverride,
  PromptMessage,
} from "@/lib/types-prompt-control";

// =============================================================================
// Types
// =============================================================================

interface TestPanelProps {
  promptName: string;
  activeVersionId: string | null;
  draftVersionId: string | null;
  defaultVariables?: Record<string, string>;
  onRunTest: (
    request: TestPromptRequest,
    options?: { signal?: AbortSignal }
  ) => Promise<TestPromptResponse>;
  onPromoteToDraft?: (overrides: PromptOverride) => Promise<void>;
}

// =============================================================================
// Variables Editor Component
// =============================================================================

function VariablesEditor({
  variables,
  onChange,
}: {
  variables: Record<string, string>;
  onChange: (variables: Record<string, string>) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState(JSON.stringify(variables, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleAddVariable = () => {
    if (newKey && !variables[newKey]) {
      onChange({ ...variables, [newKey]: "" });
      setNewKey("");
    }
  };

  const handleRemoveVariable = (key: string) => {
    const { [key]: _, ...rest } = variables;
    onChange(rest);
  };

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...variables, [key]: value });
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      onChange(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const toggleMode = () => {
    if (jsonMode) {
      // Switching to key-value mode
      setJsonMode(false);
    } else {
      // Switching to JSON mode
      setJsonText(JSON.stringify(variables, null, 2));
      setJsonMode(true);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          Variables
        </label>
        <button
          onClick={toggleMode}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {jsonMode ? "Key-Value Mode" : "JSON Mode"}
        </button>
      </div>

      {jsonMode ? (
        <div>
          <textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            className={cn(
              "w-full h-32 px-3 py-2 text-sm font-mono border rounded-lg",
              "focus:outline-none focus:ring-2 focus:ring-primary-500",
              jsonError ? "border-red-300 bg-red-50" : "border-gray-200"
            )}
            placeholder='{"variable": "value"}'
          />
          {jsonError && <p className="text-xs text-red-600 mt-1">{jsonError}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {Object.entries(variables).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="text"
                value={key}
                readOnly
                className="w-1/3 px-2 py-1.5 text-sm font-mono bg-gray-50 border border-gray-200 rounded"
              />
              <input
                type="text"
                value={value}
                onChange={(e) => handleValueChange(key, e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Value..."
              />
              <button
                onClick={() => handleRemoveVariable(key)}
                className="p-1.5 text-gray-400 hover:text-red-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddVariable()}
              className="w-1/3 px-2 py-1.5 text-sm font-mono border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="New variable..."
            />
            <button
              onClick={handleAddVariable}
              disabled={!newKey || !!variables[newKey]}
              className="px-2 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded disabled:opacity-50 flex items-center gap-1"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Image Refs Editor Component
// =============================================================================

function ImageRefsEditor({
  imageRefs,
  onChange,
}: {
  imageRefs: string[];
  onChange: (refs: string[]) => void;
}) {
  const [newRef, setNewRef] = useState("");

  const handleAdd = () => {
    if (newRef && !imageRefs.includes(newRef)) {
      onChange([...imageRefs, newRef]);
      setNewRef("");
    }
  };

  const handleRemove = (ref: string) => {
    onChange(imageRefs.filter((r) => r !== ref));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">
        Image References
      </label>
      <div className="space-y-2">
        {imageRefs.map((ref, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-xs text-gray-400 text-right">{i + 1}.</span>
            <input
              type="text"
              value={ref}
              onChange={(e) => {
                const newRefs = [...imageRefs];
                newRefs[i] = e.target.value;
                onChange(newRefs);
              }}
              className="flex-1 px-2 py-1.5 text-sm font-mono border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={() => handleRemove(ref)}
              className="p-1.5 text-gray-400 hover:text-red-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-6" />
          <input
            type="text"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 px-2 py-1.5 text-sm font-mono border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="gs://bucket/path/image.png"
          />
          <button
            onClick={handleAdd}
            disabled={!newRef}
            className="px-2 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded disabled:opacity-50 flex items-center gap-1"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Override Toggle Component
// =============================================================================

function OverrideSection({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const contentId = `override-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => onToggle(!enabled)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
        aria-expanded={enabled}
        aria-controls={contentId}
      >
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          {enabled && <Badge variant="warning" className="text-xs">Override</Badge>}
          {enabled ? (
            <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden="true" />
          )}
        </div>
      </button>
      {enabled && (
        <div id={contentId} className="p-3 border-t border-gray-200">
          {children}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Test Results Component
// =============================================================================

function TestResults({
  result,
  onPromoteToDraft,
}: {
  result: TestPromptResponse;
  onPromoteToDraft?: () => void;
}) {
  const [showMessages, setShowMessages] = useState(false);
  const [showOutput, setShowOutput] = useState(true);

  const isSuccess = result.status === "succeeded";

  return (
    <div className="space-y-4">
      {/* Status & Metrics */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <CheckCircle className="h-5 w-5 text-emerald-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <Badge variant={isSuccess ? "success" : "error"}>
            {result.status}
          </Badge>
        </div>
        {onPromoteToDraft && isSuccess && (
          <button
            onClick={onPromoteToDraft}
            className="px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50 rounded-lg transition-colors flex items-center gap-1"
          >
            <ArrowUp className="h-4 w-4" />
            Promote to Draft
          </button>
        )}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-3">
        <div className="px-3 py-2 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Clock className="h-3 w-3" />
            Latency
          </div>
          <p className="font-mono font-medium text-gray-900">
            {formatLatency(result.latencyMs)}
          </p>
        </div>
        <div className="px-3 py-2 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Zap className="h-3 w-3" />
            Tokens In
          </div>
          <p className="font-mono font-medium text-gray-900">
            {result.tokensIn.toLocaleString()}
          </p>
        </div>
        <div className="px-3 py-2 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <Zap className="h-3 w-3" />
            Tokens Out
          </div>
          <p className="font-mono font-medium text-gray-900">
            {result.tokensOut.toLocaleString()}
          </p>
        </div>
        <div className="px-3 py-2 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
            <DollarSign className="h-3 w-3" />
            Cost
          </div>
          <p className="font-mono font-medium text-gray-900">
            ${result.costEstimate.toFixed(4)}
          </p>
        </div>
      </div>

      {/* Provider Info */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {result.providerModel}
        </span>
        {result.providerRequestId && (
          <span className="flex items-center gap-1 font-mono">
            <Hash className="h-3 w-3" />
            {result.providerRequestId.slice(0, 16)}...
            <CopyButton value={result.providerRequestId} />
          </span>
        )}
        <span className="flex items-center gap-1 font-mono">
          <Hash className="h-3 w-3" />
          {result.resolutionHash.slice(0, 8)}
        </span>
      </div>

      {/* Messages (collapsible) */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowMessages(!showMessages)}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">
            Rendered Messages ({result.messages.length})
          </span>
          {showMessages ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
        </button>
        {showMessages && (
          <div className="divide-y divide-gray-100 max-h-64 overflow-auto">
            {result.messages.map((msg, i) => (
              <div key={i} className="p-3">
                <Badge className="mb-2">{msg.role}</Badge>
                <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap">
                  {msg.content}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Output (collapsible) */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowOutput(!showOutput)}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">Output</span>
          {showOutput ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
        </button>
        {showOutput && (
          <div className="p-3 max-h-64 overflow-auto">
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap">
              {typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Test Panel Component
// =============================================================================

export function TestPanel({
  promptName,
  activeVersionId,
  draftVersionId,
  defaultVariables = {},
  onRunTest,
  onPromoteToDraft,
}: TestPanelProps) {
  // State
  const [expanded, setExpanded] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestPromptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref for request cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup: abort any in-flight request on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Test inputs
  const [variables, setVariables] = useState<Record<string, string>>(defaultVariables);
  const [imageRefs, setImageRefs] = useState<string[]>([]);
  const [useVersionId, setUseVersionId] = useState<"active" | "draft" | null>(null);

  // Overrides
  const [overrideModel, setOverrideModel] = useState(false);
  const [modelOverride, setModelOverride] = useState("");
  const [overrideParams, setOverrideParams] = useState(false);
  const [paramsOverride, setParamsOverride] = useState<Record<string, unknown>>({});
  const [overrideTemplate, setOverrideTemplate] = useState(false);
  const [templateOverride, setTemplateOverride] = useState({
    system: "",
    developer: "",
    user: "",
  });

  // Build request
  const buildRequest = (): TestPromptRequest => {
    const request: TestPromptRequest = {};

    if (Object.keys(variables).length > 0) {
      request.variables = variables;
    }

    if (imageRefs.length > 0) {
      request.imageRefs = imageRefs;
    }

    if (useVersionId === "active" && activeVersionId) {
      request.versionId = activeVersionId;
    } else if (useVersionId === "draft" && draftVersionId) {
      request.versionId = draftVersionId;
    }

    // Build overrides
    const overrides: PromptOverride = {};
    if (overrideModel && modelOverride) {
      overrides.model = modelOverride;
    }
    if (overrideParams && Object.keys(paramsOverride).length > 0) {
      overrides.params = paramsOverride;
    }
    if (overrideTemplate) {
      if (templateOverride.system) overrides.systemTemplate = templateOverride.system;
      if (templateOverride.developer) overrides.developerTemplate = templateOverride.developer;
      if (templateOverride.user) overrides.userTemplate = templateOverride.user;
    }
    if (Object.keys(overrides).length > 0) {
      request.overrides = overrides;
    }

    return request;
  };

  // Run test
  const handleRunTest = async () => {
    // Cancel any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await onRunTest(buildRequest(), {
        signal: abortControllerRef.current.signal,
      });
      setResult(response);
    } catch (e) {
      // Don't show error for aborted requests (user cancelled or navigated away)
      if ((e as Error).name === "AbortError") {
        return;
      }
      setError((e as Error).message || "Test failed");
    } finally {
      setRunning(false);
    }
  };

  // Promote to draft
  const handlePromoteToDraft = async () => {
    if (!onPromoteToDraft || !result) return;

    const overrides: PromptOverride = {};
    if (overrideModel && modelOverride) {
      overrides.model = modelOverride;
    }
    if (overrideParams && Object.keys(paramsOverride).length > 0) {
      overrides.params = paramsOverride;
    }
    if (overrideTemplate) {
      if (templateOverride.system) overrides.systemTemplate = templateOverride.system;
      if (templateOverride.developer) overrides.developerTemplate = templateOverride.developer;
      if (templateOverride.user) overrides.userTemplate = templateOverride.user;
    }

    await onPromoteToDraft(overrides);
  };

  return (
    <Card>
      <CardHeader
        title="Live Test Panel"
        description="Test prompts with custom variables and overrides"
        action={
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-gray-500" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-500" />
            )}
          </button>
        }
      />
      {expanded && (
        <CardContent className="space-y-4">
          {/* Version Selection */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              Version to Test
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseVersionId(null)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                  useVersionId === null
                    ? "border-primary-500 bg-primary-50 text-primary-700"
                    : "border-gray-200 hover:bg-gray-50"
                )}
              >
                Latest
              </button>
              {activeVersionId && (
                <button
                  onClick={() => setUseVersionId("active")}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                    useVersionId === "active"
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 hover:bg-gray-50"
                  )}
                >
                  Active
                </button>
              )}
              {draftVersionId && (
                <button
                  onClick={() => setUseVersionId("draft")}
                  className={cn(
                    "px-3 py-1.5 text-sm rounded-lg border transition-colors",
                    useVersionId === "draft"
                      ? "border-amber-500 bg-amber-50 text-amber-700"
                      : "border-gray-200 hover:bg-gray-50"
                  )}
                >
                  Draft
                </button>
              )}
            </div>
          </div>

          {/* Variables */}
          <VariablesEditor variables={variables} onChange={setVariables} />

          {/* Image Refs */}
          <ImageRefsEditor imageRefs={imageRefs} onChange={setImageRefs} />

          {/* Overrides */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 block">
              Overrides (optional)
            </label>
            <OverrideSection
              label="Model Override"
              enabled={overrideModel}
              onToggle={setOverrideModel}
            >
              <select
                value={modelOverride}
                onChange={(e) => setModelOverride(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select model...</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
              </select>
            </OverrideSection>

            <OverrideSection
              label="Parameters Override"
              enabled={overrideParams}
              onToggle={setOverrideParams}
            >
              <textarea
                value={JSON.stringify(paramsOverride, null, 2)}
                onChange={(e) => {
                  try {
                    setParamsOverride(JSON.parse(e.target.value));
                  } catch {}
                }}
                className="w-full h-24 px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder='{"temperature": 0.7, "max_tokens": 4096}'
              />
            </OverrideSection>

            <OverrideSection
              label="Template Override"
              enabled={overrideTemplate}
              onToggle={setOverrideTemplate}
            >
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">System</label>
                  <textarea
                    value={templateOverride.system}
                    onChange={(e) =>
                      setTemplateOverride({ ...templateOverride, system: e.target.value })
                    }
                    className="w-full h-20 px-2 py-1.5 text-xs font-mono border border-gray-200 rounded"
                    placeholder="Override system template..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Developer</label>
                  <textarea
                    value={templateOverride.developer}
                    onChange={(e) =>
                      setTemplateOverride({ ...templateOverride, developer: e.target.value })
                    }
                    className="w-full h-20 px-2 py-1.5 text-xs font-mono border border-gray-200 rounded"
                    placeholder="Override developer template..."
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">User</label>
                  <textarea
                    value={templateOverride.user}
                    onChange={(e) =>
                      setTemplateOverride({ ...templateOverride, user: e.target.value })
                    }
                    className="w-full h-20 px-2 py-1.5 text-xs font-mono border border-gray-200 rounded"
                    placeholder="Override user template with {{variables}}..."
                  />
                </div>
              </div>
            </OverrideSection>
          </div>

          {/* Run Button */}
          <div className="pt-2">
            <button
              onClick={handleRunTest}
              disabled={running}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {running ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Running Test...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Test
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-700">Test Failed</p>
                <p className="text-xs text-red-600 mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Results</h4>
              <TestResults
                result={result}
                onPromoteToDraft={onPromoteToDraft ? handlePromoteToDraft : undefined}
              />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
