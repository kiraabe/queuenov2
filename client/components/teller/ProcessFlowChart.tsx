import type { Ticket, CaseHold } from "@shared/api";
import { useState, useEffect } from "react";
import { X, ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/api";
import {
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "./status-tones";

interface ProcessStep {
  id: string;
  number: number;
  employeeId?: string | null;
  employeeName: string;
  jobTitle?: string;
  action: "Started" | "Proceeded" | "Completed" | "Serving" | "On Hold" | "Skipped";
  duration: string;
  durationSeconds: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  windowId?: number | null;
  isTeller?: boolean;
  isArchiver?: boolean;
  remark?: string;
  skippedByWindow?: number | null;
}

interface ProcessFlowChartProps {
  ticket: Ticket;
  steps: ProcessStep[];
  userMap?: Map<string, string>;
}

export function ProcessFlowChart({
  ticket,
  steps,
  userMap,
}: ProcessFlowChartProps) {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [holds, setHolds] = useState<CaseHold[]>([]);
  const [holdsLoading, setHoldsLoading] = useState(false);

  const selectedStep = steps.find((s) => s.id === selectedStepId);
  const stepHolds = selectedStep?.employeeId
    ? holds.filter((hold) => hold.heldByUserId === selectedStep.employeeId)
    : [];

  // Fetch holds for this ticket
  useEffect(() => {
    const fetchHolds = async () => {
      try {
        setHoldsLoading(true);
        const data = await apiFetch<{ holds: CaseHold[] }>(
          `/api/employee/holds?ticketId=${ticket.id}`,
        );
        setHolds(data.holds || []);
      } catch (error) {
        console.error("Failed to fetch holds:", error);
      } finally {
        setHoldsLoading(false);
      }
    };

    fetchHolds();
  }, [ticket.id]);

  if (!steps || steps.length === 0) {
    return null;
  }

  const totalDuration = steps.reduce((sum, step) => {
    return sum + (!step.isTeller ? step.durationSeconds || 0 : 0);
  }, 0);

  const formatTotalTime = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes}m`;
    }
    const hours = Math.round(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDateTime = (timestamp: number | null | undefined) => {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case "Completed":
        return toneSuccess;
      case "Proceeded":
      case "Serving":
        return toneInfo;
      case "On Hold":
        return toneWarning;
      case "Skipped":
        return toneDanger;
      default:
        return toneNeutral;
    }
  };

  const formatTime = (timestamp: number | null | undefined) => {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDuration = (seconds: number | null | undefined) => {
    if (!seconds) return "—";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes}m`;
    }
    const hours = Math.round(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  };

  return (
    <div className="mt-3 bg-card rounded-lg border border-border p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground">
          Process Flow ({steps.length} steps • {formatTotalTime(totalDuration)} employee time)
        </span>
      </div>

      {/* Horizontal Flow */}
      <div className="overflow-x-auto">
        <div className="flex items-center gap-3 min-w-min pb-1">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-3">
              {/* Step Card - Clickable */}
              <button
                onClick={() =>
                  setSelectedStepId(selectedStepId === step.id ? null : step.id)
                }
                className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedStepId === step.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
              >
                <span className="font-semibold text-muted-foreground">
                  {step.number}.
                </span>
                <span className="font-medium text-foreground max-w-[120px] truncate">
                  {step.employeeName}
                </span>
                <span className="text-muted-foreground">{step.duration}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getActionBadgeColor(step.action)}`}
                >
                  {step.action}
                </span>
              </button>

              {/* Arrow (except last step) */}
              {index < steps.length - 1 && (
                <span className="text-muted-foreground/60 text-lg flex-shrink-0">
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Details Panel */}
      {selectedStep && (
        <div className="rounded-md border border-border bg-muted/30 p-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-semibold text-foreground">
                Step {selectedStep.number} - {selectedStep.employeeName}
              </h4>
              {selectedStep.jobTitle && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedStep.jobTitle}
                </p>
              )}
            </div>
            <button
              onClick={() => setSelectedStepId(null)}
              className="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground font-semibold mb-1">Status</p>
              <p
                className={`inline-block rounded-full border px-2 py-0.5 font-medium ${getActionBadgeColor(selectedStep.action)}`}
              >
                {selectedStep.action}
              </p>
            </div>

            <div>
              <p className="text-muted-foreground font-semibold mb-1">
                Duration
              </p>
              <p className="font-medium text-foreground">
                {selectedStep.duration}
              </p>
            </div>

            <div>
              <p className="text-muted-foreground font-semibold mb-1">
                Started At
              </p>
              <p className="font-medium text-foreground">
                {formatDateTime(selectedStep.startedAt)}
              </p>
            </div>

            {selectedStep.endedAt && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">
                  Ended At
                </p>
                <p className="font-medium text-foreground">
                  {formatDateTime(selectedStep.endedAt)}
                </p>
              </div>
            )}

            {selectedStep.isTeller && selectedStep.windowId && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">
                  Window
                </p>
                <p className="font-medium text-foreground">
                  Window {selectedStep.windowId}
                </p>
              </div>
            )}

            {selectedStep.isArchiver && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">Role</p>
                <p className="font-medium text-foreground">Archiever</p>
              </div>
            )}

            {selectedStep.action === "Skipped" && selectedStep.skippedByWindow && (
              <div>
                <p className="text-muted-foreground font-semibold mb-1">
                  Skipped By
                </p>
                <p className="font-medium text-foreground">
                  Window {selectedStep.skippedByWindow}
                </p>
              </div>
            )}
          </div>

          {/* Skip Reason Section */}
          {selectedStep.action === "Skipped" && selectedStep.remark && (
            <div className={`mt-3 rounded-md border p-3 ${toneDanger}`}>
              <p className="mb-2 text-xs font-semibold">
                Skip Reason / Remark
              </p>
              <p className="whitespace-pre-wrap break-words text-xs">
                {selectedStep.remark}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Actions Section - Accordion */}
      {stepHolds.length > 0 && (
        <div className="border-t border-border pt-3">
          <button
            onClick={() => setActionsExpanded(!actionsExpanded)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-xs font-semibold text-foreground">
              Actions ({stepHolds.length})
            </span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                actionsExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* Actions Table */}
          {actionsExpanded && (
            <div className="mt-3 overflow-hidden rounded-md border border-border bg-background animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Table Header */}
              <div className="grid grid-cols-5 gap-4 px-4 py-3 bg-muted/50 border-b border-border text-xs font-semibold text-foreground sticky top-0">
                <div>Held By</div>
                <div>Subject</div>
                <div className="text-center">Start</div>
                <div className="text-center">End</div>
                <div className="text-right">Duration</div>
              </div>

              {/* Table Rows */}
              <div className="divide-y divide-border/30">
                {holdsLoading ? (
                  <div className="col-span-5 px-4 py-4 text-xs text-muted-foreground text-center">
                    Loading actions...
                  </div>
                ) : (
                  stepHolds.map((hold) => (
                    <div
                      key={hold.id}
                      className="grid grid-cols-5 gap-4 px-4 py-3 text-xs hover:bg-muted/40 transition-colors"
                    >
                      <div className="font-medium text-foreground truncate">
                        {userMap?.get(hold.heldByUserId) ||
                          hold.heldByUserName ||
                          selectedStep?.employeeName ||
                          "—"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {hold.subject || "—"}
                      </div>
                      <div className="text-center text-muted-foreground">
                        {formatTime(hold.heldAt)}
                      </div>
                      <div className="text-center text-muted-foreground">
                        {hold.resumedAt ? formatTime(hold.resumedAt) : "—"}
                      </div>
                      <div className="text-right font-medium text-foreground">
                        {formatDuration(hold.holdDurationSeconds)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
