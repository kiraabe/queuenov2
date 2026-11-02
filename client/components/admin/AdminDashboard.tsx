import { useEffect, useState, useMemo } from "react";
import { useSSE } from "@/hooks/use-sse";
import { apiFetch, apiUrl } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Clock,
  Users,
  Zap,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  SkipForward,
  Pause,
  Award,
  Briefcase,
  X,
} from "lucide-react";
import type {
  QueueSnapshot,
  WindowState,
  Ticket,
  DisplayState,
} from "@shared/api";
import MetricTile from "./dashboard/MetricTile";
import CurrentDisplayCard from "./dashboard/CurrentDisplayCard";
import DashboardAnalyticsCharts from "./dashboard/DashboardAnalyticsCharts";

interface DashboardStats {
  totalWaiting: number;
  totalServing: number;
  servedToday: number;
  skippedToday: number;
  holdToday: number;
  averageHandlingTime: number | null;
  longestWaitTime: number | null;
  averageWaitTime: number | null;
  totalTicketsCreatedToday: number;
  completionRate: number;
  systemHealth: "healthy" | "warning" | "critical";
  totalCompleted: number;
}

interface EmployeeStats {
  totalEmployees: number;
  totalCases: number;
  topPerformer: string;
  avgDuration: number | null;
}

const formatSeconds = (seconds: number | null) => {
  if (seconds === null) return "N/A";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}hr ${minutes}min ${secs}sec`;
  } else if (minutes > 0) {
    return `${minutes}min ${secs}sec`;
  } else {
    return `${secs}sec`;
  }
};

const HEALTH_ALERT_DISMISSED_KEY = "admin-dashboard-health-alert-dismissed";

const healthBadgeClass: Record<DashboardStats["systemHealth"], string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  critical: "border-red-200 bg-red-50 text-red-700",
};

const healthLabel: Record<DashboardStats["systemHealth"], string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
};

export default function AdminDashboard() {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [tickets, setTickets] = useState<Record<string, Ticket>>({});
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [employeeStats, setEmployeeStats] = useState<EmployeeStats>({
    totalEmployees: 0,
    totalCases: 0,
    topPerformer: "N/A",
    avgDuration: null,
  });

  const sseUrl = apiUrl("/api/events");
  useSSE(sseUrl, (event) => {
    setLastUpdate(Date.now());

    if (event.type === "init") {
      const snapshot = event.payload as QueueSnapshot;
      setWindows(snapshot.windows);
      setTickets(snapshot.tickets);
      setDisplay(snapshot.display);
    } else if (event.type === "window.updated") {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === (event.payload as WindowState).id
            ? (event.payload as WindowState)
            : w,
        ),
      );
    } else if (
      event.type === "ticket.created" ||
      event.type === "ticket.updated"
    ) {
      const ticket = event.payload as Ticket;
      setTickets((prev) => ({ ...prev, [ticket.id]: ticket }));
    } else if (event.type === "display.updated") {
      setDisplay(event.payload as DisplayState);
    }
  });

  // Fetch employee stats periodically
  useEffect(() => {
    const fetchEmployeeStats = async () => {
      try {
        const data = await apiFetch<any>("/api/admin/employee-stats");
        setEmployeeStats({
          totalEmployees: data.totalEmployees || 0,
          totalCases: data.totalCases || 0,
          topPerformer: data.topPerformer || "N/A",
          avgDuration: data.avgDuration || null,
        });
      } catch (error) {
        // Silently fail - dashboard still works with default values
        let errorMsg = "Unknown error";
        if (error instanceof Error) {
          errorMsg = error.message;
        }
        console.debug("[AdminDashboard] Failed to fetch employee stats:", errorMsg);
        // Keep existing state on error
      }
    };

    // Fetch immediately on load
    fetchEmployeeStats();
    // Then refresh every 30 seconds
    const interval = setInterval(fetchEmployeeStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = useMemo((): DashboardStats => {
    const ticketList = Object.values(tickets);
    const now = Date.now();

    // Aggregate stats
    const waiting = ticketList.filter((t) => t.status === "waiting");
    const serving = ticketList.filter((t) => t.status === "serving");
    const completed = ticketList.filter((t) => t.status === "done");
    const skipped = ticketList.filter((t) => t.status === "skipped");
    const transferred = ticketList.filter((t) => t.status === "transferred");

    // Today's tickets (created after midnight UTC)
    const todayTickets = ticketList.filter((t) => {
      const ticketDate = new Date(t.createdAt).toDateString();
      const today = new Date(now).toDateString();
      return ticketDate === today;
    });

    // All-time serving time calculations from completed tickets
    const completedWithTiming = completed.filter(
      (t) => t.startedAt && t.completedAt,
    );
    const servingTimes = completedWithTiming.map(
      (t) => (t.completedAt! - t.startedAt!) / 1000,
    );

    // Average handling time from all completed tickets with timing data
    const avgHandlingTime =
      servingTimes.length > 0
        ? Math.round(
            servingTimes.reduce((a, b) => a + b, 0) / servingTimes.length,
          )
        : null;

    // All-time wait time calculations (from all tickets that have had wait time)
    const allTicketsWithWaitTime = ticketList.filter(
      (t) => t.createdAt && t.startedAt,
    );
    const allWaitTimes = allTicketsWithWaitTime.map(
      (t) => (t.startedAt! - t.createdAt) / 1000,
    );

    // For currently waiting tickets, calculate current wait time
    const currentWaitingTimes = waiting.map((t) => (now - t.createdAt) / 1000);

    // Combine all historical wait times with current wait times for longest wait
    const allWaitsForLongestCalc = [...allWaitTimes, ...currentWaitingTimes];
    const longestWait =
      allWaitsForLongestCalc.length > 0
        ? Math.round(Math.max(...allWaitsForLongestCalc))
        : null;

    // Average wait time from all tickets that have completed waiting
    const avgWait =
      allWaitTimes.length > 0
        ? Math.round(
            allWaitTimes.reduce((a, b) => a + b, 0) / allWaitTimes.length,
          )
        : null;

    // System health
    let health: DashboardStats["systemHealth"] = "healthy";
    if (longestWait && longestWait > 3600) health = "critical";
    else if (longestWait && longestWait > 1800) health = "warning";

    const servedCount = todayTickets.filter((t) => t.status === "done").length;
    const completionRate =
      todayTickets.length > 0
        ? Math.round((servedCount / todayTickets.length) * 100)
        : 0;

    return {
      totalWaiting: waiting.length,
      totalServing: serving.length,
      servedToday: servedCount,
      skippedToday: todayTickets.filter((t) => t.status === "skipped").length,
      holdToday: todayTickets.filter((t) => t.status === "transferred")
        .length,
      averageHandlingTime: avgHandlingTime,
      longestWaitTime: longestWait,
      averageWaitTime: avgWait,
      totalTicketsCreatedToday: todayTickets.length,
      completionRate,
      systemHealth: health,
      totalCompleted: completed.length,
    };
  }, [tickets]);

  const employeeMetrics = [
    {
      label: "Total Employees",
      value: employeeStats.totalEmployees,
      hint: "active staff",
      icon: Users,
      tooltipTitle: "Total Employees",
      tooltipDescription: "Staff availability indicator",
    },
    {
      label: "Total Cases",
      value: stats.totalCompleted,
      hint: "completed tickets",
      icon: Briefcase,
      tooltipTitle: "Total Cases",
      tooltipDescription: "Success/completed indicator",
    },
    {
      label: "Top Performer",
      value: employeeStats.topPerformer,
      hint: "by cases",
      icon: Award,
      tooltipTitle: "Top Performer",
      tooltipDescription: "Outstanding/award indicator",
    },
    {
      label: "Avg Duration",
      value:
        employeeStats.avgDuration !== null
          ? formatSeconds(employeeStats.avgDuration)
          : "N/A",
      hint: "per case",
      icon: Clock,
      tooltipTitle: "Average Duration",
      tooltipDescription: "Time-based warning indicator",
    },
    {
      label: "Total Windows",
      value: windows.length,
      hint: "total available",
      icon: Zap,
      tooltipTitle: "Total Windows",
      tooltipDescription: "Capacity/resources indicator",
    },
  ];

  const performanceMetrics = [
    {
      label: "Avg Handling Time",
      value: formatSeconds(stats.averageHandlingTime),
      hint: "per completed ticket",
      icon: Clock,
      tooltipTitle: "Average Handling Time",
      tooltipDescription: "Average time spent handling cases",
    },
    {
      label: "Longest Wait",
      value: formatSeconds(stats.longestWaitTime),
      hint: "current customer",
      icon: TrendingUp,
      tooltipTitle: "Longest Wait Time",
      tooltipDescription: "Longest waiting customer (watch for delays)",
    },
    {
      label: "Avg Wait Time",
      value: formatSeconds(stats.averageWaitTime),
      hint: "queue average",
      icon: Clock,
      tooltipTitle: "Average Wait Time",
      tooltipDescription: "Average time customers wait in queue",
    },
  ];

  const queueMetrics = [
    {
      label: "Waiting",
      value: stats.totalWaiting,
      hint: "in queue",
      icon: Users,
      tooltipTitle: "Customers Waiting",
      tooltipDescription: "Customers currently in queue waiting for service",
    },
    {
      label: "Serving",
      value: stats.totalServing,
      hint: "being served",
      icon: Zap,
      tooltipTitle: "Customers Being Served",
      tooltipDescription: "Customers currently with staff members",
    },
    {
      label: "Served Today",
      value: stats.servedToday,
      hint: "completed",
      icon: CheckCircle,
      tooltipTitle: "Served Today",
      tooltipDescription: "Completed customer cases (since midnight)",
    },
    {
      label: "Completion Rate",
      value: `${stats.completionRate}%`,
      hint: "today's rate",
      icon: CheckCircle,
      tooltipTitle: "Completion Rate",
      tooltipDescription: "Percentage of completed vs total cases",
    },
    {
      label: "Skipped",
      value: stats.skippedToday,
      hint: "skipped today",
      icon: SkipForward,
      tooltipTitle: "Skipped Cases",
      tooltipDescription: "Customers who skipped their turn",
    },
    {
      label: "Hold",
      value: stats.holdToday,
      hint: "hold today",
      icon: Pause,
      tooltipTitle: "Cases on Hold",
      tooltipDescription: "Cases transferred or waiting for transfer",
    },
  ];

  const [dismissedHealthLevel, setDismissedHealthLevel] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem(HEALTH_ALERT_DISMISSED_KEY);
      } catch {
        return null;
      }
    },
  );

  useEffect(() => {
    if (stats.systemHealth !== "healthy") return;
    setDismissedHealthLevel(null);
    try {
      localStorage.removeItem(HEALTH_ALERT_DISMISSED_KEY);
    } catch {
      // Storage can be unavailable in sandboxed iframes
    }
  }, [stats.systemHealth]);

  const dismissHealthAlert = () => {
    setDismissedHealthLevel(stats.systemHealth);
    try {
      localStorage.setItem(HEALTH_ALERT_DISMISSED_KEY, stats.systemHealth);
    } catch {
      // Storage can be unavailable in sandboxed iframes
    }
  };

  const renderMetricGrid = (
    metrics: typeof employeeMetrics,
    columns: string,
  ) => (
    <div className={`grid grid-cols-1 gap-4 ${columns}`}>
      {metrics.map((metric) => (
        <MetricTile key={metric.label} {...metric} />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {stats.systemHealth !== "healthy" &&
        dismissedHealthLevel !== stats.systemHealth && (
        <Alert
          className={
            stats.systemHealth === "critical"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }
        >
          <button
            type="button"
            onClick={dismissHealthAlert}
            aria-label="Dismiss alert"
            className="absolute right-3 top-3 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="pr-6">
            {stats.systemHealth === "critical"
              ? `Critical: Longest wait time is ${formatSeconds(stats.longestWaitTime)}. Consider opening additional windows.`
              : `Warning: Longest wait time is ${formatSeconds(stats.longestWaitTime)}. Monitor queue status closely.`}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>System Status</CardTitle>
              <CardDescription>
                Real-time system health and activity
              </CardDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={healthBadgeClass[stats.systemHealth]}
                >
                  {healthLabel[stats.systemHealth]}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-2">
                  <p className="font-semibold">System Health Status</p>
                  <div className="space-y-1 text-xs">
                    <p>Healthy: wait time under 30 mins</p>
                    <p>Warning: wait time 30-60 mins</p>
                    <p>Critical: wait time over 60 mins</p>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent>
          {renderMetricGrid(
            employeeMetrics,
            "md:grid-cols-2 xl:grid-cols-5",
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
          <CardDescription>Service timing and queue statistics</CardDescription>
        </CardHeader>
        <CardContent>
          {renderMetricGrid(performanceMetrics, "md:grid-cols-2 xl:grid-cols-3")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Queue Actions</CardTitle>
          <CardDescription>
            Real-time queue operations and metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          {renderMetricGrid(queueMetrics, "md:grid-cols-2 xl:grid-cols-3")}
        </CardContent>
      </Card>

      <DashboardAnalyticsCharts />

      {display && <CurrentDisplayCard display={display} tickets={tickets} />}
    </div>
  );
}
