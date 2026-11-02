import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BarChart3,
  Users,
  Ticket,
  MonitorPlay,
  Settings,
  User,
  Briefcase,
  FileText,
  LineChart,
  Workflow,
} from "lucide-react";
import MobileAdminLayout from "@/components/admin/MobileAdminLayout";
import AdminDashboard from "@/components/admin/AdminDashboard";
import SessionManagement from "@/components/admin/SessionManagement";
import TicketManagement from "@/components/admin/TicketManagement";
import AdminSettings from "@/components/admin/AdminSettings";
import AdminProfile from "@/components/admin/AdminProfile";
import EmploymentManagement from "@/components/admin/EmploymentManagement";
import AdminWindows from "@/components/admin/AdminWindows";
import DailyReportViewer from "@/components/admin/DailyReportViewer";
import AdminAdvancedAnalytics from "@/components/admin/AdminAdvancedAnalytics";
import CaseWorkflowTracker from "@/components/admin/CaseWorkflowTracker";
import AdminFooter from "@/components/admin/AdminFooter";
import { ProfileDropdown } from "@/components/admin/ProfileDropdown";

export type AdminSection =
  | "dashboard"
  | "reports"
  | "analytics"
  | "process-flow"
  | "employment"
  | "sessions"
  | "tickets"
  | "windows"
  | "settings"
  | "profile";

interface AdminProps {
  section: AdminSection;
}

export default function Admin({ section }: AdminProps) {
  const navigate = useNavigate();
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const navItems = [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <BarChart3 className="h-5 w-5" />,
      path: "/admin/dashboard",
    },
    {
      id: "reports",
      label: "Reports",
      icon: <FileText className="h-5 w-5" />,
      path: "/admin/reports",
    },
    {
      id: "analytics",
      label: "Advanced Analytics",
      icon: <LineChart className="h-5 w-5" />,
      path: "/admin/analytics",
    },
    {
      id: "process-flow",
      label: "Process Flow",
      icon: <Workflow className="h-5 w-5" />,
      path: "/admin/process-flow",
    },
    {
      id: "employment",
      label: "Employment",
      icon: <Briefcase className="h-5 w-5" />,
      path: "/admin/employment",
    },
    {
      id: "sessions",
      label: "Sessions",
      icon: <Users className="h-5 w-5" />,
      path: "/admin/sessions",
    },
    {
      id: "tickets",
      label: "Tickets",
      icon: <Ticket className="h-5 w-5" />,
      path: "/admin/tickets",
    },
    {
      id: "windows",
      label: "Windows",
      icon: <MonitorPlay className="h-5 w-5" />,
      path: "/admin/windows",
    },
    {
      id: "settings",
      label: "Settings",
      icon: <Settings className="h-5 w-5" />,
      path: "/admin/settings",
    },
    {
      id: "profile",
      label: "Profile",
      icon: <User className="h-5 w-5" />,
      path: "/admin/profile",
    },
  ];

  const reportSubItems = navItems.filter((item) =>
    ["reports", "analytics", "process-flow"].includes(item.id),
  );
  const isReportsGroup = reportSubItems.some((item) => item.id === section);

  const desktopNavItems = navItems
    .filter((item) => item.id !== "settings" && item.id !== "profile")
    .filter((item) => !reportSubItems.includes(item) || item.id === "reports")
    .map((item) =>
      item.id === "reports" ? { ...item, label: "Reports & Analytics" } : item,
    );

  const renderContent = () => {
    switch (section) {
      case "dashboard":
        return <AdminDashboard />;
      case "reports":
        return <DailyReportViewer />;
      case "analytics":
        return <AdminAdvancedAnalytics />;
      case "process-flow":
        return <CaseWorkflowTracker />;
      case "employment":
        return <EmploymentManagement />;
      case "sessions":
        return <SessionManagement />;
      case "tickets":
        return <TicketManagement />;
      case "windows":
        return <AdminWindows />;
      case "settings":
        return <AdminSettings />;
      case "profile":
        return <AdminProfile />;
    }
  };

  if (!isDesktop) {
    return (
      <TooltipProvider>
        <MobileAdminLayout navItems={navItems} activeTab={section}>
          {renderContent()}
        </MobileAdminLayout>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col min-h-screen">
        <div className="flex-1 container mx-auto px-4 py-6 pb-12">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <img
                  src="/logos/lhpria-logo.webp"
                  alt="STC Solution logo"
                  className="h-10 w-10 shrink-0 rounded-full object-cover shadow-sm"
                />
                <div className="space-y-1">
                  <h1 className="text-2xl font-semibold text-foreground">Admin Panel</h1>
                  <p className="text-sm text-muted-foreground">
                    Manage system operations, monitor queues, and configure settings
                  </p>
                </div>
              </div>
              <ProfileDropdown navItems={navItems} />
            </div>

            <div className="space-y-3">
              <Tabs
                value={isReportsGroup ? "reports" : section}
                onValueChange={(value) => navigate(`/admin/${value}`)}
                className="w-full"
              >
                <TabsList className="flex h-11 w-full justify-start gap-1 overflow-x-auto">
                  {desktopNavItems.map((item) => (
                    <TabsTrigger
                      key={item.id}
                      value={item.id}
                      className="group flex flex-1 items-center justify-center gap-2 px-4 h-9"
                    >
                      <span className="h-4 w-4 shrink-0">{item.icon}</span>
                      <span className="font-medium">{item.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {isReportsGroup && (
                <Tabs
                  value={section}
                  onValueChange={(value) => navigate(`/admin/${value}`)}
                  className="w-full"
                >
                  <TabsList className="flex h-9 w-full justify-start gap-1 overflow-x-auto bg-muted/50">
                    {reportSubItems.map((item) => (
                      <TabsTrigger
                        key={item.id}
                        value={item.id}
                        className="group flex items-center gap-2 px-3 h-7"
                      >
                        <span className="h-4 w-4 shrink-0">{item.icon}</span>
                        <span className="font-medium">{item.label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            </div>

            <div className="mt-8 space-y-4">{renderContent()}</div>
          </div>
        </div>
        <AdminFooter />
      </div>
    </TooltipProvider>
  );
}
