"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Clock,
  Archive,
  FileText,
  RotateCcw,
  Hash,
  Calendar,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  CopyButton,
  Modal,
} from "@/components/layout/shell";
import { cn, formatRelativeTime, formatDateTime } from "@/lib/utils";
import type { VersionSummary, VersionDetail, PromptStatus } from "@/lib/types-prompt-control";

// =============================================================================
// Types
// =============================================================================

interface VersionTimelineProps {
  versions: VersionSummary[];
  activeVersionId: string | null;
  draftVersionId: string | null;
  onActivate: (versionId: string) => Promise<void>;
  onViewDetail: (versionId: string) => void;
  activating?: boolean;
  activatingVersionId?: string | null;
}

interface VersionDetailModalProps {
  version: VersionDetail;
  isActive: boolean;
  isDraft: boolean;
  onClose: () => void;
  onActivate: (versionId: string) => Promise<void>;
  activating?: boolean;
}

// =============================================================================
// Status Badge Component
// =============================================================================

function VersionStatusBadge({
  status,
  isActive,
  isDraft,
}: {
  status: PromptStatus;
  isActive: boolean;
  isDraft: boolean;
}) {
  if (isActive) {
    return (
      <Badge variant="success" className="flex items-center gap-1">
        <CheckCircle className="h-3 w-3" />
        Active
      </Badge>
    );
  }
  if (isDraft) {
    return (
      <Badge variant="warning" className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Draft
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="flex items-center gap-1">
      <Archive className="h-3 w-3" />
      Archived
    </Badge>
  );
}

// =============================================================================
// Version Row Component
// =============================================================================

function VersionRow({
  version,
  isActive,
  isDraft,
  onActivate,
  onViewDetail,
  activating,
  isActivating,
}: {
  version: VersionSummary;
  isActive: boolean;
  isDraft: boolean;
  onActivate: (versionId: string) => Promise<void>;
  onViewDetail: (versionId: string) => void;
  activating?: boolean;
  isActivating?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0 transition-colors",
        isActive && "bg-emerald-50/50",
        isDraft && "bg-amber-50/50",
        !isActive && !isDraft && "hover:bg-gray-50"
      )}
    >
      {/* Timeline Indicator */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "w-3 h-3 rounded-full border-2",
            isActive && "bg-emerald-500 border-emerald-500",
            isDraft && "bg-amber-500 border-amber-500",
            !isActive && !isDraft && "bg-white border-gray-300"
          )}
        />
        <div className="w-0.5 h-full bg-gray-200 mt-1" />
      </div>

      {/* Version Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-gray-900">
            v{version.version}
          </span>
          <VersionStatusBadge
            status={version.activatedAt ? "ACTIVE" : isDraft ? "DRAFT" : "ARCHIVED"}
            isActive={isActive}
            isDraft={isDraft}
          />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatRelativeTime(version.createdAt)}
          </span>
          {version.model && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {version.model}
            </span>
          )}
          <span className="flex items-center gap-1 font-mono text-gray-400">
            <Hash className="h-3 w-3" />
            {version.templateHash.slice(0, 8)}
          </span>
        </div>
        {version.activatedAt && (
          <div className="text-xs text-emerald-600 mt-1">
            Activated {formatRelativeTime(version.activatedAt)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onViewDetail(version.id)}
          className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          View
        </button>
        {!isActive && !isDraft && (
          <button
            onClick={() => onActivate(version.id)}
            disabled={activating}
            className="px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50 flex items-center gap-1"
            title="Rollback to this version"
          >
            {isActivating ? (
              <span className="animate-spin">...</span>
            ) : (
              <>
                <RotateCcw className="h-3 w-3" />
                Activate
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Version Detail Modal
// =============================================================================

export function VersionDetailModal({
  version,
  isActive,
  isDraft,
  onClose,
  onActivate,
  activating,
}: VersionDetailModalProps) {
  return (
    <Modal open={true} onClose={onClose} title={`Version ${version.version}`}>
      <div className="space-y-4">
        {/* Status & Metadata */}
        <div className="flex items-center justify-between">
          <VersionStatusBadge
            status={version.status}
            isActive={isActive}
            isDraft={isDraft}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-mono">
              {version.templateHash.slice(0, 16)}
            </span>
            <CopyButton value={version.templateHash} />
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-4 py-3 border-y border-gray-100">
          <div>
            <p className="text-xs text-gray-500 uppercase">Created</p>
            <p className="text-sm font-medium">{formatDateTime(version.createdAt)}</p>
            <p className="text-xs text-gray-500">{version.createdBy}</p>
          </div>
          {version.activatedAt && (
            <div>
              <p className="text-xs text-gray-500 uppercase">Activated</p>
              <p className="text-sm font-medium">{formatDateTime(version.activatedAt)}</p>
              <p className="text-xs text-gray-500">{version.activatedBy}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 uppercase">Model</p>
            <p className="text-sm font-medium font-mono">{version.model || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Status</p>
            <p className="text-sm font-medium">{version.status}</p>
          </div>
        </div>

        {/* Change Notes */}
        {version.changeNotes && (
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Change Notes</p>
            <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded">
              {version.changeNotes}
            </p>
          </div>
        )}

        {/* Templates */}
        <div className="space-y-3">
          {version.systemTemplate && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">System Template</p>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32 font-mono">
                {version.systemTemplate}
              </pre>
            </div>
          )}
          {version.developerTemplate && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Developer Template</p>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32 font-mono">
                {version.developerTemplate}
              </pre>
            </div>
          )}
          {version.userTemplate && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">User Template</p>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-32 font-mono">
                {version.userTemplate}
              </pre>
            </div>
          )}
        </div>

        {/* Parameters */}
        {version.params && Object.keys(version.params).length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Parameters</p>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-24 font-mono">
              {JSON.stringify(version.params, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        {!isActive && !isDraft && (
          <div className="flex justify-end pt-3 border-t border-gray-100">
            <button
              onClick={() => onActivate(version.id)}
              disabled={activating}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Rollback to This Version
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =============================================================================
// Main Version Timeline Component
// =============================================================================

export function VersionTimeline({
  versions,
  activeVersionId,
  draftVersionId,
  onActivate,
  onViewDetail,
  activating,
  activatingVersionId,
}: VersionTimelineProps) {
  const [expanded, setExpanded] = useState(true);

  // Sort versions by version number descending
  const sortedVersions = [...versions].sort((a, b) => b.version - a.version);

  return (
    <Card>
      <CardHeader
        title="Versions Timeline"
        description={`${versions.length} version${versions.length !== 1 ? "s" : ""}`}
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
        <CardContent className="p-0">
          {sortedVersions.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <Archive className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No versions yet</p>
            </div>
          ) : (
            <div>
              {sortedVersions.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  isActive={version.id === activeVersionId}
                  isDraft={version.id === draftVersionId}
                  onActivate={onActivate}
                  onViewDetail={onViewDetail}
                  activating={activating}
                  isActivating={activatingVersionId === version.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
