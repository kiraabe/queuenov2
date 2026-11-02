import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { ConsoleHeader } from "./ConsoleHeader";

const AppLayout = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isTemporaryPasswordChange =
    pathname === "/change-password" && user?.mustChangePassword === true;
  const isAdminPage = pathname.startsWith("/admin");
  const isProfilePage = pathname === "/profile";
  const isConsolePage =
    pathname === "/reception" ||
    pathname.startsWith("/teller") ||
    pathname.startsWith("/archiever") ||
    pathname.startsWith("/employee");
  const isTrackPage = pathname === "/track";
  const isTicketStatusPage = pathname.startsWith("/tickets/");
  const hideNavigation =
    isAdminPage || isProfilePage || isTrackPage || isTicketStatusPage;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {isConsolePage ? (
        <ConsoleHeader />
      ) : (
        !hideNavigation && !isTemporaryPasswordChange && <SiteHeader />
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      {!hideNavigation && <SiteFooter />}
    </div>
  );
};

export default AppLayout;
