import { useState, useId, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/hooks/use-translation";
import { homePathForUser } from "@/lib/role-home";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Allowed redirect prefixes per role. */
const ALLOWED_REDIRECTS: Record<string, string[]> = {
  admin:     ["/", "/admin", "/teller", "/reception", "/queue", "/display", "/tickets/", "/role-selector"],
  teller:    ["/teller", "/tickets/", "/role-selector"],
  reception: ["/reception", "/tickets/", "/role-selector"],
  employee:  ["/employee", "/tickets/", "/role-selector"],
  archiever: ["/archiever", "/tickets/", "/role-selector"],
};

/**
 * Validates a redirect param against the role's allowlist.
 * Prefix check requires the next character to be "/" to prevent
 * open-redirect attacks like "/admin.evil.com" passing "/admin".
 */
function isSafeRedirect(redirectParam: string, role: string): boolean {
  const allowed = ALLOWED_REDIRECTS[role] ?? ["/"];
  return allowed.some(
    (path) =>
      redirectParam === path ||
      redirectParam.startsWith(path.endsWith("/") ? path : path + "/"),
  );
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Login() {
  const { login } = useAuth();
  const { t }     = useTranslation();
  const navigate  = useNavigate();
  const [params]  = useSearchParams();

  const [username,       setUsername]       = useState("");
  const [password,       setPassword]       = useState("");
  const [showPassword,   setShowPassword]   = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [pending,        setPending]        = useState(false);
  const [lockedUntil,    setLockedUntil]    = useState<number | null>(null);
  const [now,            setNow]            = useState(() => Date.now());
  const errorId = useId();

  const remainingSeconds = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - now) / 1000))
    : 0;
  const isLocked = remainingSeconds > 0;

  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= lockedUntil) setLockedUntil(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  // Capture viewport width once at mount.
  // Reading it at submit time would give the post-resize value.
  const [viewportWidth] = useState(() => window.innerWidth);

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const u = username.trim();
    // Do NOT trim the password — spaces are valid password characters.
    const p = password;

    if (!u) { setError(t("login.enterUsername")); return; }
    if (!p) { setError(t("login.enterPassword")); return; }

    setPending(true);
    try {
      const user = await login(u, p, viewportWidth);

      if (user.mustChangePassword) {
        navigate("/change-password", { replace: true });
        return;
      }

      if (user.roles && user.roles.length > 1) {
        navigate("/role-selector");
        return;
      }

      const defaultPath   = homePathForUser(user) ?? "/";
      const redirectParam = params.get("redirect");

      const to =
        redirectParam &&
        redirectParam !== defaultPath &&
        isSafeRedirect(redirectParam, user.role)
          ? redirectParam
          : defaultPath;

      navigate(to);
    } catch (err) {
      const retryAfterSeconds = (err as Error & { retryAfterSeconds?: number })
        .retryAfterSeconds;
      if (typeof retryAfterSeconds === "number" && retryAfterSeconds > 0) {
        setNow(Date.now());
        setLockedUntil(Date.now() + retryAfterSeconds * 1000);
        setError(t("login.tooManyAttempts"));
      } else {
        setError(err instanceof Error ? err.message : t("errors.serverError"));
      }
    } finally {
      setPending(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="container py-16">
      <div className="mx-auto max-w-md">
        <Card className="border-border/60 bg-card/80">
          <CardHeader>
            <CardTitle>{t("login.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              {t("login.enterUsername")}
            </p>
          </CardHeader>

          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={onSubmit}
              aria-describedby={error ? errorId : undefined}
            >
              {/* Username */}
              <div className="grid gap-2">
                <Label htmlFor="username">{t("login.username")}</Label>
                <Input
                  id="username"
                  type="text"
                  required
                  maxLength={120}
                  placeholder={t("login.enterUsername")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  disabled={pending}
                />
              </div>

              {/* Password */}
              <div className="grid gap-2">
                <Label htmlFor="password">{t("login.password")}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    maxLength={200}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                    // copy/paste intentionally NOT blocked — prevents password
                    // managers from working and violates NIST SP 800-63B §5.1.1
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                    aria-pressed={showPassword}
                    disabled={pending}
                    className="absolute inset-y-0 right-2 inline-flex items-center rounded-md p-2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={pending || isLocked}
              >
                {isLocked
                  ? `${t("login.signIn")} (${formatCountdown(remainingSeconds)})`
                  : pending
                    ? `${t("login.signIn")}…`
                    : t("login.signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
