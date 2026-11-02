import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { homePathForUser } from "@/lib/role-home";

export function RequireAuth({
  role,
}: {
  role?: "reception" | "teller" | "admin" | "employee" | "archiever";
}) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === undefined) return null; // loading state could show spinner
  if (!user)
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(loc.pathname + loc.search)}`}
        replace
      />
    );
  if (user.mustChangePassword && loc.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  if (role && user.role !== role)
    return <Navigate to={homePathForUser(user) ?? "/"} replace />;
  return <Outlet />;
}
