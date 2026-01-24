"use client";

import { useState, useMemo } from "react";
import {
  FileText,
  Code,
  User,
  Save,
  Trash2,
  Play,
  RefreshCw,
  Diff,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
} from "@/components/layout/shell";
import { cn } from "@/lib/utils";
import type {
  VersionDetail,
  CreateVersionRequest,
} from "@/lib/types-prompt-control";

// =============================================================================
// Types
// =============================================================================

interface DraftEditorProps {
  promptName: string;
  draftVersion: VersionDetail | null;
  activeVersion: VersionDetail | null;
  defaultModel: string;
  defaultParams: Record<string, unknown>;
  modelAllowList: string[];
  onSaveDraft: (data: CreateVersionRequest) => Promise<void>;
  onDiscardDraft: () => Promise<void>;
  onActivateDraft: (versionId: string) => Promise<void>;
  saving?: boolean;
  activating?: boolean;
}

type TemplateTab = "system" | "developer" | "user";

// =============================================================================
// Template Editor Component
// =============================================================================

function TemplateEditor({
  value,
  onChange,
  placeholder,
  label,
  readonly,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  readonly?: boolean;
}) {
  // Extract variables from template
  const variables = useMemo(() => {
    const matches = value.match(/\{\{([\w.]+)\}\}/g) || [];
    return [...new Set(matches.map((m) => m.slice(2, -2)))];
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {variables.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Variables:</span>
            {variables.slice(0, 5).map((v) => (
              <Badge key={v} className="text-xs font-mono">
                {v}
              </Badge>
            ))}
            {variables.length > 5 && (
              <span className="text-xs text-gray-400">
                +{variables.length - 5} more
              </span>
            )}
          </div>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readonly}
        className={cn(
          "w-full h-64 px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg",
          "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent",
          "resize-y min-h-[200px]",
          readonly && "bg-gray-50 text-gray-600 cursor-not-allowed"
        )}
        spellCheck={false}
      />
    </div>
  );
}

// =============================================================================
// JSON Editor Component
// =============================================================================

function JsonEditor({
  value,
  onChange,
  label,
  readonly,
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  label: string;
  readonly?: boolean;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (newText: string) => {
    setText(newText);
    try {
      const parsed = JSON.parse(newText);
      onChange(parsed);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        readOnly={readonly}
        className={cn(
          "w-full h-32 px-3 py-2 text-sm font-mono border rounded-lg",
          "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent",
          error ? "border-red-300 bg-red-50" : "border-gray-200",
          readonly && "bg-gray-50 text-gray-600 cursor-not-allowed"
        )}
        spellCheck={false}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// =============================================================================
// Diff View Component
// =============================================================================

function DiffView({
  activeTemplate,
  draftTemplate,
  label,
}: {
  activeTemplate: string | null;
  draftTemplate: string;
  label: string;
}) {
  const activeLines = (activeTemplate || "").split("\n");
  const draftLines = draftTemplate.split("\n");

  // Simple line-by-line diff
  const maxLines = Math.max(activeLines.length, draftLines.length);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-gray-200 bg-gray-50 text-xs font-medium text-gray-500">
          <div className="px-3 py-1.5">Active Version</div>
          <div className="px-3 py-1.5">Draft</div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-gray-200 max-h-64 overflow-auto">
          <div className="font-mono text-xs">
            {activeLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "px-3 py-0.5",
                  line !== draftLines[i] && "bg-red-50 text-red-700"
                )}
              >
                {line || "\u00A0"}
              </div>
            ))}
          </div>
          <div className="font-mono text-xs">
            {draftLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  "px-3 py-0.5",
                  line !== activeLines[i] && "bg-green-50 text-green-700"
                )}
              >
                {line || "\u00A0"}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Draft Editor Component
// =============================================================================

export function DraftEditor({
  promptName,
  draftVersion,
  activeVersion,
  defaultModel,
  defaultParams,
  modelAllowList,
  onSaveDraft,
  onDiscardDraft,
  onActivateDraft,
  saving = false,
  activating = false,
}: DraftEditorProps) {
  // State for editing
  const [activeTab, setActiveTab] = useState<TemplateTab>("system");
  const [showDiff, setShowDiff] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Form state - initialized from draft or defaults
  const [systemTemplate, setSystemTemplate] = useState(
    draftVersion?.systemTemplate || activeVersion?.systemTemplate || ""
  );
  const [developerTemplate, setDeveloperTemplate] = useState(
    draftVersion?.developerTemplate || activeVersion?.developerTemplate || ""
  );
  const [userTemplate, setUserTemplate] = useState(
    draftVersion?.userTemplate || activeVersion?.userTemplate || ""
  );
  const [model, setModel] = useState(
    draftVersion?.model || activeVersion?.model || defaultModel
  );
  const [params, setParams] = useState<Record<string, unknown>>(
    draftVersion?.params || activeVersion?.params || defaultParams
  );
  const [changeNotes, setChangeNotes] = useState(draftVersion?.changeNotes || "");

  // Available models (filtered by allow list if provided)
  const availableModels =
    modelAllowList.length > 0
      ? modelAllowList
      : ["gemini-2.5-flash", "gemini-2.5-flash-image", "gpt-4o", "gpt-4o-mini", "claude-sonnet-4-20250514"];

  // Handle field changes
  const handleChange = (
    setter: (value: string) => void,
    value: string
  ) => {
    setter(value);
    setHasChanges(true);
  };

  const handleParamsChange = (value: Record<string, unknown>) => {
    setParams(value);
    setHasChanges(true);
  };

  // Save draft
  const handleSave = async () => {
    await onSaveDraft({
      systemTemplate: systemTemplate || undefined,
      developerTemplate: developerTemplate || undefined,
      userTemplate: userTemplate || undefined,
      model: model || undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
      changeNotes: changeNotes || undefined,
    });
    setHasChanges(false);
  };

  // Discard draft
  const handleDiscard = async () => {
    if (window.confirm("Are you sure you want to discard this draft?")) {
      await onDiscardDraft();
      // Reset to active version
      setSystemTemplate(activeVersion?.systemTemplate || "");
      setDeveloperTemplate(activeVersion?.developerTemplate || "");
      setUserTemplate(activeVersion?.userTemplate || "");
      setModel(activeVersion?.model || defaultModel);
      setParams(activeVersion?.params || defaultParams);
      setChangeNotes("");
      setHasChanges(false);
    }
  };

  // Activate draft
  const handleActivate = async () => {
    if (!draftVersion) return;
    if (
      window.confirm(
        "Are you sure you want to activate this draft? It will become the new active version."
      )
    ) {
      await onActivateDraft(draftVersion.id);
    }
  };

  const tabs: { id: TemplateTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "system", label: "System", icon: FileText },
    { id: "developer", label: "Developer", icon: Code },
    { id: "user", label: "User", icon: User },
  ];

  return (
    <Card>
      <CardHeader
        title={draftVersion ? `Draft v${draftVersion.version}` : "New Draft"}
        description={
          draftVersion
            ? `Created ${new Date(draftVersion.createdAt).toLocaleString()} by ${draftVersion.createdBy}`
            : "Create a new draft version"
        }
        action={
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Badge variant="warning" className="text-xs">
                Unsaved changes
              </Badge>
            )}
            <button
              onClick={() => setShowDiff(!showDiff)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showDiff
                  ? "bg-primary-100 text-primary-600"
                  : "hover:bg-gray-100 text-gray-500"
              )}
              title={showDiff ? "Hide diff" : "Show diff vs active"}
            >
              <Diff className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <CardContent className="p-0">
        {/* Template Tabs */}
        <div className="border-b border-gray-100">
          <div className="flex">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                    activeTab === tab.id
                      ? "border-primary-500 text-primary-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Template Content */}
        <div className="p-4 space-y-4">
          {showDiff ? (
            <DiffView
              activeTemplate={
                activeTab === "system"
                  ? activeVersion?.systemTemplate || null
                  : activeTab === "developer"
                  ? activeVersion?.developerTemplate || null
                  : activeVersion?.userTemplate || null
              }
              draftTemplate={
                activeTab === "system"
                  ? systemTemplate
                  : activeTab === "developer"
                  ? developerTemplate
                  : userTemplate
              }
              label={`${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Template Diff`}
            />
          ) : (
            <>
              {activeTab === "system" && (
                <TemplateEditor
                  value={systemTemplate}
                  onChange={(v) => handleChange(setSystemTemplate, v)}
                  label="System Template"
                  placeholder="Enter system instructions..."
                />
              )}
              {activeTab === "developer" && (
                <TemplateEditor
                  value={developerTemplate}
                  onChange={(v) => handleChange(setDeveloperTemplate, v)}
                  label="Developer Template"
                  placeholder="Enter developer context (optional)..."
                />
              )}
              {activeTab === "user" && (
                <TemplateEditor
                  value={userTemplate}
                  onChange={(v) => handleChange(setUserTemplate, v)}
                  label="User Template"
                  placeholder="Enter user message template with {{variables}}..."
                />
              )}
            </>
          )}

          {/* Model & Params */}
          <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setHasChanges(true);
                }}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <JsonEditor
              value={params}
              onChange={handleParamsChange}
              label="Parameters (JSON)"
            />
          </div>

          {/* Change Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Change Notes
            </label>
            <input
              type="text"
              value={changeNotes}
              onChange={(e) => {
                setChangeNotes(e.target.value);
                setHasChanges(true);
              }}
              placeholder="Brief description of changes..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center gap-2">
            {draftVersion && (
              <button
                onClick={handleDiscard}
                disabled={saving || activating}
                className="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 inline-block mr-1" />
                Discard Draft
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving || activating || !hasChanges}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Draft
            </button>
            {draftVersion && (
              <button
                onClick={handleActivate}
                disabled={saving || activating || hasChanges}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                title={hasChanges ? "Save draft first before activating" : "Activate this draft"}
              >
                {activating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Activate Draft
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
