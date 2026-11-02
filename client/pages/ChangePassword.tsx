import { useNavigate } from "react-router-dom";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { useAuth } from "@/hooks/use-auth";
import { homePathForUser } from "@/lib/role-home";

export default function ChangePassword() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const handlePasswordChanged = async () => {
    const user = await refreshUser();
    if (user && !user.mustChangePassword) {
      navigate(homePathForUser(user) ?? "/", { replace: true });
    }
  };

  return (
    <div className="container max-w-2xl py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Change your temporary password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set a new password to finish signing in and continue to the application.
        </p>
      </div>
      <ChangePasswordForm onPasswordChanged={handlePasswordChanged} />
    </div>
  );
}
