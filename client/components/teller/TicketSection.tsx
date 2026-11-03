import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Ticket } from "@shared/api";
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { CompletedTicketSummary } from "./CompletedTicketSummary";
import { ProcessFlowChart } from "./ProcessFlowChart";
import { PerformanceRating } from "./PerformanceRating";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { ListUsersResponse, ServiceItem } from "@shared/api";
import {
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
} from "./status-tones";

interface EmployeeStep {
  id: string;
  employeeName: string;
  jobTitle: string;
  status: string;
  durationSeconds: number | null;
  windowId?: number | null;
  isTeller?: boolean;
  isArchiver?: boolean;
}

interface CaseWorkflowResponse {
  items?: EmployeeStep[];
}

interface TicketSectionProps {
  items: Ticket[];
  title: string;
  pageSize?: number;
  currentWindowId?: number;
}

export function TicketSection({
  items: allItems,
  title,
  pageSize,
  currentWindowId,
}: TicketSectionProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [serviceStandardTimes, setServiceStandardTimes] = useState<
    Record<string, number>
  >({});

  // Load service categories and standard times
  useEffect(() => {
    const loadServiceStandardTimes = async () => {
      try {
        const categoriesRes = await apiFetch<any>(
          "/api/service-categories"
        );

        let categories = categoriesRes?.categories;
        if (!Array.isArray(categories)) {
          return;
        }

        const standardTimes: Record<string, number> = {};

        for (const category of categories) {
          try {
            const servicesRes = await apiFetch<any>(
              `/api/service-categories/${category.id}/services`
            );

            let services = servicesRes?.services;
            if (!Array.isArray(services)) {
              continue;
            }

            services.forEach((service: ServiceItem) => {
              if (service.standardTimeMinutes && service.name) {
                standardTimes[service.name] = service.standardTimeMinutes;
              }
            });
          } catch {
            // Silent fail for individual service categories
          }
        }

        setServiceStandardTimes(standardTimes);
      } catch {
        // Silent fail - dashboard still works with default values
      }
    };

    loadServiceStandardTimes();
  }, []);

  // Fetch all users for transfer info display
  const { data: usersData } = useQuery({
    queryKey: ["all-users-for-tickets"],
    queryFn: () => apiFetch<ListUsersResponse>("/api/admin/users"),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    usersData?.users.forEach((user) => {
      map.set(user.id, user.fullName || user.username);
    });
    return map;
  }, [usersData]);

  // Reset page to 1 when items change significantly
  useEffect(() => {
    setCurrentPage(1);
  }, [allItems.length]);

  const ITEMS_PER_PAGE = pageSize ?? 20;

  const total = allItems.length;
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const items = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleNextPage = () => {
    if (hasNextPage) {
      setCurrentPage((prev) => Math.min(prev + 1, totalPages));
    }
  };

  const handlePrevPage = () => {
    if (hasPrevPage) {
      setCurrentPage((prev) => Math.max(prev - 1, 1));
    }
  };

  const handlePageClick = (page: number) => {
    const p = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(p);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">No records available.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {items.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  userMap={userMap}
                  currentWindowId={currentWindowId}
                  serviceStandardTimes={serviceStandardTimes}
                />
              ))}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-6 flex flex-col items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePrevPage}
                    disabled={!hasPrevPage}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <div className="flex gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                      (page) => (
                        <Button
                          key={page}
                          variant={page === currentPage ? "default" : "outline"}
                          size="sm"
                          onClick={() => handlePageClick(page)}
                          className="h-9 w-9 p-0"
                          aria-current={
                            page === currentPage ? "page" : undefined
                          }
                        >
                          {page}
                        </Button>
                      ),
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNextPage}
                    disabled={!hasNextPage}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Page {currentPage} of {totalPages} ({total} total records)
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TicketRow({
  ticket,
  userMap,
  currentWindowId,
  serviceStandardTimes = {},
}: {
  ticket: Ticket;
  userMap: Map<string, string>;
  currentWindowId?: number;
  serviceStandardTimes?: Record<string, number>;
}) {
  // Auto-expand completed tickets and transferred tickets by default
  const [isExpanded, setIsExpanded] = useState(
    ticket.status === "done" ||
    !!ticket.transferredToUserId ||
    !!ticket.transferredToWindow
  );

  // Fetch workflow data for completed tickets
  const { data: performanceData } = useQuery({
    queryKey: ["case-workflow-process", ticket.id],
    queryFn: async () => {
      const response = await apiFetch<CaseWorkflowResponse>(
        `/api/employee/case-workflow?ticketId=${encodeURIComponent(ticket.id)}`,
      );
      return response;
    },
    enabled: ticket.status === "done",
  });

  // Fetch job titles for displaying transferred user's job title
  const { data: jobTitlesData } = useQuery({
    queryKey: ["job-titles-for-ticket"],
    queryFn: async () => {
      return apiFetch<any>("/api/admin/job-titles");
    },
  });

  // Calculate total duration from workflow items
  const totalDuration = useMemo(() => {
    if (!performanceData?.items) return null;
    const items = performanceData.items;
    return items.reduce((sum, item) => sum + (item.durationSeconds || 0), 0);
  }, [performanceData]);

  // Helper function to get job title name from ID
  const getJobTitleName = (jobTitleId: string | null | undefined) => {
    if (!jobTitleId || !jobTitlesData?.jobTitles) return null;
    const jobTitle = jobTitlesData.jobTitles.find((jt: any) => jt.id === jobTitleId);
    return jobTitle?.nameEnglish || jobTitle?.name || null;
  };

  // Get standard time for selected services
  const getSelectedServicesStandardTime = () => {
    const selectedServices = ticket.selectedServices || [];
    if (selectedServices.length === 0) {
      return 0;
    }

    const totalMinutes = selectedServices.reduce((sum, serviceName) => {
      const standardMinutes = serviceStandardTimes[serviceName] || 0;
      return sum + standardMinutes;
    }, 0);

    return totalMinutes;
  };

  // Check if duration exceeds standard time
  const getStandardTimeStatus = () => {
    if (!totalDuration) {
      return {
        exceeds: false,
        performanceLevel: "on_time" as const,
        standardMinutes: null,
        standardSeconds: null,
        source: null as "category" | "services" | null
      };
    }

    // First priority: check selected services
    const selectedServices = ticket.selectedServices || [];
    if (selectedServices.length > 0) {
      const totalMinutes = getSelectedServicesStandardTime();
      if (totalMinutes > 0) {
        const standardSeconds = totalMinutes * 60;
        // Formula: (standard_time / actual_time) * 65, clamped to [0, 100]
        const performance = Math.max(0, Math.min(100, (standardSeconds / totalDuration) * 65));
        const percentageOfStandard = Math.round(performance);

        let performanceLevel: "on_time" | "slightly_over" | "moderately_over" | "significantly_over";
        if (percentageOfStandard >= 65) {
          performanceLevel = "on_time";
        } else if (percentageOfStandard >= 50) {
          performanceLevel = "slightly_over";
        } else if (percentageOfStandard >= 30) {
          performanceLevel = "moderately_over";
        } else {
          performanceLevel = "significantly_over";
        }

        const exceeds = totalDuration > standardSeconds;
        return {
          exceeds,
          performanceLevel,
          standardMinutes: totalMinutes,
          standardSeconds,
          source: "services" as const
        };
      }
    }

    // Fallback: check service category
    const serviceCategory = ticket.service;
    if (serviceCategory) {
      const standardMinutes = serviceStandardTimes[serviceCategory];
      if (standardMinutes) {
        const standardSeconds = standardMinutes * 60;
        // Formula: (standard_time / actual_time) * 65, clamped to [0, 100]
        const performance = Math.max(0, Math.min(100, (standardSeconds / totalDuration) * 65));
        const percentageOfStandard = Math.round(performance);

        let performanceLevel: "on_time" | "slightly_over" | "moderately_over" | "significantly_over";
        if (percentageOfStandard >= 65) {
          performanceLevel = "on_time";
        } else if (percentageOfStandard >= 50) {
          performanceLevel = "slightly_over";
        } else if (percentageOfStandard >= 30) {
          performanceLevel = "moderately_over";
        } else {
          performanceLevel = "significantly_over";
        }

        const exceeds = totalDuration > standardSeconds;
        return {
          exceeds,
          performanceLevel,
          standardMinutes,
          standardSeconds,
          source: "category" as const
        };
      }
    }

    return {
      exceeds: false,
      performanceLevel: "on_time" as const,
      standardMinutes: null,
      standardSeconds: null,
      source: null as "category" | "services" | null
    };
  };

  // Convert performance data to process steps
  const processSteps = useMemo(() => {
    // The API returns { items: [workflow steps] }
    // Each item contains the employee/archiver/teller workflow data
    const workflowItems = performanceData?.items;

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

    const steps = [];
    let stepNumber = 1;

    // Process all workflow items in order (including archiver, teller, and employee steps)
    if (workflowItems && workflowItems.length > 0) {
      workflowItems.forEach((item: any) => {
        // Determine the display name and status
        let displayName = item.employeeName || "Unknown";
        let displayStatus = item.status || "Started";

        // For archiver steps, use a descriptive label
        if (item.isArchiver) {
          displayName = `${displayName} (Archiever)`;
        }

        // For teller steps, include window number and use a descriptive label
        if (item.isTeller) {
          if (item.windowId) {
            displayName = `${displayName} - Window ${item.windowId}`;
          }
          // Ensure teller action is "Proceeded"
          displayStatus = "Proceeded";
        }

        // Map backend status to action status
        let action: "Started" | "Proceeded" | "Completed" | "Serving" | "On Hold" = "Started";
        if (displayStatus === "Completed" || displayStatus === "completed") {
          action = "Completed";
        } else if (
          displayStatus === "Proceeded" ||
          displayStatus === "proceeded"
        ) {
          action = "Proceeded";
        } else if (displayStatus === "Serving" || displayStatus === "serving") {
          action = "Serving";
        } else if (displayStatus === "On Hold" || displayStatus === "on_hold") {
          action = "On Hold";
        } else if (
          displayStatus === "Retrieved" ||
          displayStatus === "retrieved"
        ) {
          // Treat Retrieved as Started for process flow
          action = "Started";
        }

        steps.push({
          id: item.id,
          number: stepNumber++,
          employeeId: item.employeeId,
          employeeName: item.employeeName || "Unknown",
          jobTitle: item.jobTitle,
          action: action,
          duration: formatTime(item.durationSeconds),
          durationSeconds: item.durationSeconds,
          startedAt: item.startedAt,
          endedAt: item.endedAt,
          windowId: item.windowId,
          isTeller: item.isTeller,
          isArchiver: item.isArchiver,
        });
      });
    }

    return steps;
  }, [performanceData]);

  const getWindowName = (windowId: number | null | undefined) => {
    if (!windowId) return "—";
    return `Window ${windowId}`;
  };

  const formatDate = (timestamp: number | null | undefined) => {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const extractReason = (remark: string | undefined) => {
    if (!remark) return null;
    // Extract the reason part if it exists (format: "... Reason: REASON_TEXT")
    const reasonMatch = remark.match(/Reason:\s*(.+)$/);
    if (reasonMatch) {
      return reasonMatch[1].trim();
    }
    return null;
  };

  const extractSkipReason = (remark: string | undefined) => {
    if (!remark) return null;
    // Extract the reason part if it exists (format: "Skipped by window X at ISO_TIME. Reason: REASON_TEXT")
    const reasonMatch = remark.match(/Reason:\s*(.+)$/);
    if (reasonMatch) {
      return reasonMatch[1].trim();
    }
    // If no explicit reason, extract just the window and time info
    const timeMatch = remark.match(/Skipped by window (\d+) at (.+?)(?:\.|$)/);
    if (timeMatch) {
      const window = timeMatch[1];
      const time = new Date(timeMatch[2]).toLocaleTimeString();
      return `Window ${window} at ${time}`;
    }
    return remark;
  };

  const statusTone =
    ticket.status === "done"
      ? toneSuccess
      : ticket.status === "skipped"
        ? toneDanger
        : ticket.status === "serving"
          ? toneInfo
          : toneNeutral;

  const standardStatus = getStandardTimeStatus();

  return (
    <div
      className={`rounded-lg border ${
        ticket.status === "done" ? "border-border bg-card" : "border-border bg-muted/40"
      }`}
    >
      {/* Accordion header - always visible */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{ticket.code}</p>
            <p className="text-sm text-muted-foreground">
              {ticket.ownerName || "—"}
            </p>
            {ticket.transferredToUserId && (
              <p className="mt-1 text-xs text-muted-foreground">
                Sent to: {userMap.get(ticket.transferredToUserId) || "—"}
                {ticket.jobTitleForProceed && (
                  <span className="block">{getJobTitleName(ticket.jobTitleForProceed) || ticket.jobTitleForProceed}</span>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {ticket.status === "done" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-8 w-8 p-0"
                aria-label={
                  isExpanded
                    ? "Collapse ticket details"
                    : "Expand ticket details"
                }
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </Button>
            )}
            <span
              className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusTone}`}
            >
              {ticket.status}
            </span>
          </div>
        </div>
      </div>

      {/* Accordion content - shown when expanded */}
      {isExpanded && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          {(ticket.transferredFromWindow ||
            ticket.transferredToWindow ||
            ticket.transferredToUserId) && (
            <div className={`rounded-md border p-2 ${toneInfo}`}>
              <span className="text-xs font-medium">Transfer Info</span>
              <div className="mt-2 flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">
                  {ticket.transferredFromWindow
                    ? getWindowName(ticket.transferredFromWindow)
                    : "—"}
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" />
                <div className="font-medium text-foreground">
                  {ticket.transferredToWindow
                    ? getWindowName(ticket.transferredToWindow)
                    : ticket.transferredToUserId
                      ? (
                          <>
                            <span>{userMap.get(ticket.transferredToUserId) || "—"}</span>
                            {ticket.jobTitleForProceed && (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {getJobTitleName(ticket.jobTitleForProceed) || ticket.jobTitleForProceed}
                              </span>
                            )}
                          </>
                        )
                      : "—"}
                </div>
              </div>
              {ticket.transferredAt && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>{formatDate(ticket.transferredAt)}</span>
                </div>
              )}
              {ticket.remark && extractReason(ticket.remark) && (
                <div className="mt-2 border-t border-primary/20 pt-2">
                  <p className="text-xs font-medium">Transfer Reason</p>
                  <p className="mt-1 text-xs text-foreground">
                    {extractReason(ticket.remark)}
                  </p>
                </div>
              )}
            </div>
          )}

          {ticket.selectedServices && ticket.selectedServices.length > 0 && (
            <div className={`rounded-md border p-2 ${toneInfo}`}>
              <p className="text-xs font-medium">Selected Services</p>
              <ul className="mt-1 space-y-1">
                {ticket.selectedServices.map((serviceName, index) => (
                  <li key={index} className="text-xs text-foreground">
                    • {serviceName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ticket.notes && (
            <p className="text-sm text-muted-foreground">
              Notes: {ticket.notes}
            </p>
          )}
          {ticket.status === "skipped" && ticket.remark && (
            <div className={`rounded-md border p-2 ${toneDanger}`}>
              <p className="text-xs font-medium">Skip Reason</p>
              <p className="mt-1 text-xs">
                {extractSkipReason(ticket.remark) || "No reason provided"}
              </p>
            </div>
          )}
          {ticket.woreda && (
            <p className="text-xs text-muted-foreground">
              Woreda: {ticket.woreda}
            </p>
          )}

          {/* Process flow chart for completed tickets */}
          {ticket.status === "done" && (
            <>
              {processSteps.length > 0 ? (
                <ProcessFlowChart
                  ticket={ticket}
                  steps={processSteps}
                  userMap={userMap}
                />
              ) : (
                <CompletedTicketSummary ticket={ticket} />
              )}

              {standardStatus.standardSeconds && totalDuration ? (
                <PerformanceRating
                  performanceLevel={standardStatus.performanceLevel}
                  standardMinutes={standardStatus.standardMinutes}
                  standardSeconds={standardStatus.standardSeconds}
                  source={standardStatus.source}
                  selectedServices={ticket.selectedServices || []}
                  serviceStandardTimes={serviceStandardTimes}
                  totalDuration={totalDuration}
                />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
