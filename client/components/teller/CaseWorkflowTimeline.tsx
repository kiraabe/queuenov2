import type { Ticket } from "@shared/api";
import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  User,
  Briefcase,
  CheckCircle2,
  AlertCircle,
  Monitor,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "./status-tones";

interface EmployeeStep {
  id: string;
  employeeName: string;
  jobTitle: string;
  status: "Started" | "Proceeded" | "Completed" | "Retrieved";
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number | null;
  windowId?: number | null;
  isTeller?: boolean;
  isArchiver?: boolean;
}

interface CaseWorkflowResponse {
  items?: EmployeeStep[];
}

interface CaseWorkflowTimelineProps {
  ticket: Ticket;
  compact?: boolean;
}

export function CaseWorkflowTimeline({
  ticket,
  compact = false,
}: CaseWorkflowTimelineProps) {
  const { data: performanceData, isPending } = useQuery({
    queryKey: ["case-workflow", ticket.id],
    queryFn: async () => {
      const response = await apiFetch<CaseWorkflowResponse>(
        `/api/employee/case-workflow?ticketId=${encodeURIComponent(ticket.id)}`,
      );
      return response;
    },
    enabled: ticket.status === "done",
  });

  if (ticket.status !== "done") {
    return null;
  }

  if (isPending) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Case Workflow Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <p className="text-sm text-muted-foreground">Loading workflow...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const items = performanceData?.items || [];

  if (!items || items.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Case Workflow Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`rounded-md border p-4 ${toneWarning}`}>
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-medium">
                  No employee workflow data available
                </p>
                <p className="mt-1 text-xs opacity-90">
                  This case was completed directly without going through the
                  employee workflow.
                  {ticket.completedAt && (
                    <>
                      <br />
                      Completed on:{" "}
                      <span className="font-semibold">
                        {new Date(ticket.completedAt).toLocaleString()}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatTime = (seconds: number | null) => {
    if (!seconds) return "—";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const minutes = Math.round(seconds / 60);
      return `${minutes}m`;
    }
    const hours = Math.round(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDateTime = (timestamp: number) => {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getActionTone = (action: string) => {
    switch (action) {
      case "Started":
      case "Proceeded":
        return toneInfo;
      case "Completed":
        return toneSuccess;
      default:
        return toneNeutral;
    }
  };

  const totalDuration = items.reduce((sum, item) => {
    return sum + (item.durationSeconds || 0);
  }, 0);

  if (compact) {
    // Compact view for inline display
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {items.map((step, index) => (
            <div key={step.id} className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1">
                <span className="text-xs font-medium text-foreground">
                  {step.employeeName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatTime(step.durationSeconds)}
                </span>
              </div>
              {index < items.length - 1 && (
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Case Workflow Timeline</CardTitle>
          <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
            {items.length} step{items.length !== 1 ? "s" : ""} •{" "}
            {formatTime(totalDuration)}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.map((step, index) => (
            <div key={step.id}>
              <div className={`rounded-lg border p-4 ${getActionTone(step.status)}`}>
                <div className="flex items-start gap-4">
                  <CheckCircle2
                    className={`mt-1 h-5 w-5 shrink-0 ${
                      step.status === "Completed"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-primary"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-foreground">
                        {step.employeeName || "Unknown Employee"}
                      </p>
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
                          step.status === "Completed" ? toneSuccess : toneInfo
                        }`}
                      >
                        {step.status}
                      </span>
                      {step.isTeller && step.windowId && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary">
                          <Monitor className="h-3 w-3" />
                          Window {step.windowId}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {step.jobTitle || "No Title"}
                      </span>
                    </p>

                    <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5">
                        <Clock className="h-4 w-4 shrink-0 text-primary" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Duration
                          </p>
                          <p className="font-semibold text-foreground">
                            {formatTime(step.durationSeconds)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5">
                        <User className="h-4 w-4 shrink-0 text-primary" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Started At
                          </p>
                          <p className="text-xs font-semibold text-foreground">
                            {formatDateTime(step.startedAt)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {step.endedAt && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Ended at:{" "}
                        <span className="font-medium text-foreground">
                          {formatDateTime(step.endedAt)}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {index < items.length - 1 && (
                <div className="flex justify-center py-3">
                  <ArrowRight className="h-5 w-5 rotate-90 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/40 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Total Participants
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {items.length}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Combined Step Time
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              {formatTime(totalDuration)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sum of all recorded step durations
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Case Status
            </p>
            <div className="mt-1 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="text-base font-semibold">Completed</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
