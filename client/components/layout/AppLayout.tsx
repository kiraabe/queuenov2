import { Outlet, useLocation } from "react-router-dom";

import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { ConsoleHeader } from "./ConsoleHeader";

const AppLayout = () => {
  const { pathname } = useLocation();
  const isAdminPage = pathname.startsWith("/admin");
  const isProfilePage = pathname === "/profile";
  const isTellerPage = pathname.startsWith("/teller");
  const isConsolePage =
    pathname === "/reception" ||
    isTellerPage ||
    pathname.startsWith("/archiever") ||
    pathname.startsWith("/employee");
  const isTrackPage = pathname === "/track";
  const isTicketStatusPage = pathname.startsWith("/tickets/");
  const hideNavigation =
    isAdminPage || isProfilePage || isTrackPage || isTicketStatusPage;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {isConsolePage ? (
        !isTellerPage && <ConsoleHeader />
      ) : (
        !hideNavigation && <SiteHeader />
      )}
      <main className="flex-1">
        <Outlet />
      </main>
      {!hideNavigation && <SiteFooter />}
    </div>
  );
};

export default AppLayout;
