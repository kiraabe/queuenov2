import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import EmployeePerformanceDashboard from "./EmployeePerformanceDashboard";
import EmployeeCaseQueue from "./EmployeeCaseQueue";
import ServiceCategoryAnalytics from "./ServiceCategoryAnalytics";
import OverallEmployeeAnalytics from "./OverallEmployeeAnalytics";
import OverallCategoryAnalytics from "./OverallCategoryAnalytics";

export default function AdminAdvancedAnalytics() {
  const [analyticsView, setAnalyticsView] = useState<"overall" | "daily">(
    "overall",
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Advanced Analytics</CardTitle>
          <CardDescription>
            Comprehensive metrics for performance tracking and analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant={analyticsView === "overall" ? "default" : "outline"}
              onClick={() => setAnalyticsView("overall")}
              className="sm:flex-initial"
            >
              Overall Metrics (All-Time)
            </Button>
            <Button
              variant={analyticsView === "daily" ? "default" : "outline"}
              onClick={() => setAnalyticsView("daily")}
              className="sm:flex-initial"
            >
              Daily Metrics
            </Button>
          </div>
        </CardContent>
      </Card>

      {analyticsView === "overall" && (
        <div className="space-y-6">
          <OverallEmployeeAnalytics />
          <OverallCategoryAnalytics />
        </div>
      )}

      {analyticsView === "daily" && (
        <div className="space-y-6">
          <EmployeePerformanceDashboard />
          <ServiceCategoryAnalytics />
          <EmployeeCaseQueue />
        </div>
      )}
    </div>
  );
}
