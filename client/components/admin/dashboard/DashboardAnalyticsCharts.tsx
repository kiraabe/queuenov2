import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface CategoryAnalytics {
  categoryName: string;
  served: number;
  skipped: number;
  transferred: number;
}

interface EmployeeAnalytics {
  employeeName: string;
  casesCompleted: number;
  casesProceed: number;
}

interface OverallAnalytics {
  categories: CategoryAnalytics[];
  employees: EmployeeAnalytics[];
}

const REFRESH_INTERVAL_MS = 60000;

export default function DashboardAnalyticsCharts() {
  const [analytics, setAnalytics] = useState<OverallAnalytics | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const data = await apiFetch<OverallAnalytics>("/api/admin/overall-analytics");
        setAnalytics(data);
      } catch (error) {
        console.debug("[DashboardAnalyticsCharts] Failed to fetch analytics:", error);
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const categoryData = (analytics?.categories ?? []).map((cat) => ({
    name: cat.categoryName,
    served: cat.served,
    skipped: cat.skipped,
    transferred: cat.transferred,
  }));

  const employeeData = (analytics?.employees ?? []).map((emp) => ({
    name: emp.employeeName.split(" ")[0],
    completed: emp.casesCompleted,
    forwarded: emp.casesProceed,
  }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Category Status Breakdown</CardTitle>
          <CardDescription>Served, skipped, and transferred by category</CardDescription>
        </CardHeader>
        <CardContent>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="served" fill="#22c55e" name="Served" />
                <Bar dataKey="skipped" fill="#f59e0b" name="Skipped" />
                <Bar dataKey="transferred" fill="#3b82f6" name="Transferred" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No category data yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cases by Employee</CardTitle>
          <CardDescription>Completed and forwarded cases per employee</CardDescription>
        </CardHeader>
        <CardContent>
          {employeeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={employeeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="completed" fill="#22c55e" name="Completed" />
                <Bar dataKey="forwarded" fill="#3b82f6" name="Forwarded" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-muted-foreground">No employee data yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
