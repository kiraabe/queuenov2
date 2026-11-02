import type { Request, Response, RequestHandler } from "express";
import { UAParser } from "ua-parser-js";
import DeviceDetector from "device-detector-js";
import {
  getUserByUsername,
  getUserByWindow,
  logAudit,
  getPool,
} from "../store/db";
import { parseCookies, verifyPassword, hashPassword } from "../utils/auth";
import type {
  AuthErrorCode,
  AuthUser,
  ListSessionsResponse,
  LoginRequest,
  LoginResponse,
  MeResponse,
  UserRole,
} from "../../shared/api";
import {
  SESSION_COOKIE,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_MAX_AGE_SECONDS,
  createUserSession,
  createUserSessionAtomic,
  decrementTabCount,
  findSessionByToken,
  incrementTabCount,
  listSessions,
  revokeSessionById,
  revokeSessionByToken,
  revokeSessionsForUser,
  touchSession,
} from "../store/sessions";
import type { SessionRecord, SessionRevokeReason } from "../store/sessions";
import { broadcastSessionUpdate } from "../services/session-websocket";
import {
  clearLoginAccountFailures,
  getLoginRateLimitKeys,
  isLoginRateLimited,
  recordLoginFailure,
} from "../store/login-rate-limiter";

// For production HTTPS, use SameSite=None with Secure flag
// For development HTTP, use SameSite=Lax without Secure flag
// Environment variable override: COOKIE_SAMESITE and COOKIE_SECURE
const COOKIE_SAMESITE = (process.env.COOKIE_SAMESITE || "None").trim();
const COOKIE_SECURE =
  process.env.COOKIE_SECURE === "true" ||
  COOKIE_SAMESITE.toLowerCase() === "none";

// Maximum concurrent sessions per user (can be overridden via MAX_SESSIONS_PER_USER env var)
const MAX_SESSIONS_PER_USER = parseInt(
  process.env.MAX_SESSIONS_PER_USER || "3",
  10,
);

// Log cookie configuration for debugging
if (
  process.env.NODE_ENV === "production" ||
  process.env.FORCE_HTTPS === "true"
) {
  console.log(
    `[Auth] Production mode - SameSite=${COOKIE_SAMESITE}, Secure=${COOKIE_SECURE}`,
  );
}

function toAuthUserFromRow(row: {
  id: string;
  username: string;
  role: UserRole;
  roles?: UserRole[];
  window_id: number | null;
  full_name?: string | null;
  job_title_id?: string | null;
  phone?: string | null;
  email?: string | null;
  department?: string | null;
  created_at?: Date | string | null;
  must_change_password?: boolean;
}): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    roles: row.roles,
    windowId: row.window_id ?? null,
    fullName: row.full_name ?? undefined,
    jobTitleId: row.job_title_id ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    department: row.department ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    mustChangePassword: row.must_change_password ?? false,
  };
}

function toAuthUserFromSession(session: SessionRecord): AuthUser {
  return {
    id: session.userId,
    username: session.username,
    role: session.activeRole,
    windowId: session.windowId ?? null,
    jobTitleId: session.jobTitleId ?? undefined,
    mustChangePassword: session.mustChangePassword,
  };
}

function buildSessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `SameSite=${COOKIE_SAMESITE}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

function buildSessionClearCookie(): string {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    `SameSite=${COOKIE_SAMESITE}`,
  ];
  if (COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

type AuthResult =
  | { ok: true; session: SessionRecord; token: string }
  | { ok: false; status: number; code: AuthErrorCode; message: string };

function sanitizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}

function ensurePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value || value.length > 200) return null;
  return value;
}

function mapRevokeReason(reason: SessionRevokeReason | null): {
  status: number;
  code: AuthErrorCode;
  message: string;
} {
  switch (reason) {
    case "conflict":
      return {
        status: 409,
        code: "SESSION_CONFLICT",
        message:
          "This account was signed in from another device. You have been logged out.",
      };
    case "logout":
      return {
        status: 401,
        code: "SESSION_INVALIDATED",
        message: "Your session has expired. Please sign in again.",
      };
    case "invalidated":
      return {
        status: 401,
        code: "SESSION_INVALIDATED",
        message: "Your session has expired. Please sign in again.",
      };
    case "timeout":
      return {
        status: 401,
        code: "SESSION_EXPIRED",
        message: "Your session has expired. Please sign in again.",
      };
    case "expired":
      return {
        status: 401,
        code: "SESSION_EXPIRED",
        message: "Your session has expired. Please sign in again.",
      };
    default:
      return {
        status: 401,
        code: "SESSION_INVALIDATED",
        message: "Your session has expired. Please sign in again.",
      };
  }
}

async function authenticateRequest(
  req: Request,
  res: Response,
  { touch }: { touch?: boolean } = {},
): Promise<AuthResult> {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    // Session cookie not found - this could be a new user or the cookie wasn't sent
    const hasCookieHeader = !!req.headers.cookie;
    console.warn(
      `[Auth] Session cookie not found. Cookie header present: ${hasCookieHeader}, Looking for: ${SESSION_COOKIE}`,
    );
    return {
      ok: false,
      status: 401,
      code: "NO_SESSION",
      message: "Authentication required.",
    };
  }
  const session = await findSessionByToken(token);
  if (!session) {
    console.warn(`[Auth] Session token not found in database for cookie`);
    res.setHeader("Set-Cookie", buildSessionClearCookie());
    return {
      ok: false,
      status: 401,
      code: "SESSION_INVALIDATED",
      message: "Your session has expired. Please sign in again.",
    };
  }
  if (session.revokedAt) {
    res.setHeader("Set-Cookie", buildSessionClearCookie());
    const mapped = mapRevokeReason(session.revokeReason ?? null);
    return { ok: false, ...mapped };
  }
  const now = new Date();
  if (now.getTime() > session.expiresAt.getTime()) {
    await revokeSessionById(session.id, "expired");
    res.setHeader("Set-Cookie", buildSessionClearCookie());
    return {
      ok: false,
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Session expired. Please sign in again.",
    };
  }
  const idleMs = now.getTime() - session.lastActivityAt.getTime();
  if (idleMs > SESSION_IDLE_TIMEOUT_SECONDS * 1000) {
    await revokeSessionById(session.id, "timeout");
    res.setHeader("Set-Cookie", buildSessionClearCookie());
    return {
      ok: false,
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Session ended due to inactivity. Please sign in again.",
    };
  }
  if (touch) {
    await touchSession(session.id, now);
  }
  return { ok: true, session, token };
}

function getClientIpAddress(req: Request): string {
  return cleanIpAddress(req.ip || req.socket?.remoteAddress || "");
}

// Helper function to clean IPv6-mapped IPv4 addresses
function cleanIpAddress(ip: string): string {
  if (!ip) return "";
  // Remove ::ffff: prefix from IPv6-mapped IPv4 addresses
  if (ip.startsWith("::ffff:")) {
    return ip.substring(7);
  }
  // Remove brackets for IPv6 addresses
  if (ip.startsWith("[") && ip.endsWith("]")) {
    return ip.slice(1, -1);
  }
  return ip;
}

function loginRateLimitKeys(req: Request, username: string) {
  return getLoginRateLimitKeys(getClientIpAddress(req), username);
}

/**
 * Normalizes OS name and version from ua-parser-js result with support for:
 * 1. Android detection (when User-Agent contains both "Linux" and "Android")
 * 2. Windows 11 detection via Client Hints (Sec-CH-UA-Platform-Version header)
 *
 * IMPORTANT: Uses ua-parser-js result.os.name and result.os.version only.
 * Does NOT use engine, cpu, or other fields to avoid confusion.
 */
function normalizeOsDetection(
  uaResult: { os: { name: string | null; version: string | null } },
  req: Request,
  platformVersion: string | undefined,
): { osName: string; osVersion: string } {
  // Extract OS info directly from ua-parser-js os object
  let osName = uaResult.os.name || "Unknown";
  let osVersion = uaResult.os.version || "";
  const userAgent = (req.headers["user-agent"] || "").toLowerCase();

  const isDebugEnabled = process.env.DEBUG_OS_DETECTION === "true";
  if (isDebugEnabled) {
    console.log("[OS Detection] Initial parse:", {
      osName,
      osVersion,
      userAgent: userAgent.substring(0, 100),
    });
  }

  // ==============================================================================
  // Android Detection: Fix false "Linux" classification
  // ==============================================================================
  // ua-parser-js may report "Linux" when User-Agent contains both "Linux" and
  // "Android" string. Android devices are Linux-based but should display as "Android".
  // Precedence: If Android string exists in UA, always use "Android" over "Linux".
  if (osName === "Linux" && userAgent.includes("android")) {
    osName = "Android";
    if (isDebugEnabled) {
      console.log("[OS Detection] Android detected (Linux + Android in UA)");
    }
  }

  // ==============================================================================
  // Windows 11 Detection: Use Client Hints for accurate version
  // ==============================================================================
  // Background:
  // - Windows 11 uses same kernel as Windows 10 (NT 10.0)
  // - User-Agent alone cannot distinguish Windows 10 from Windows 11
  // - Client Hints (Sec-CH-UA-Platform-Version) provide accurate platform version
  // - Windows 11 reports platform version >= 13, Windows 10 reports <= 10
  // - Fallback: Without Client Hints, ua-parser-js will report "10" (kernel version)
  if (osName === "Windows" && osVersion === "10") {
    if (platformVersion && platformVersion.trim()) {
      try {
        // Extract major version number from platform version string
        // Examples: "13.0", "13.0.1", "14.5" -> major version = 13, 14
        const versionParts = platformVersion.trim().split(".");
        const majorVersion = parseInt(versionParts[0], 10);

        // Validate parsed version is a reasonable number
        if (Number.isFinite(majorVersion) && majorVersion > 0) {
          // Windows 11: major version >= 13
          // Windows 10: major version <= 10
          // Windows 12+ (future): major version >= 13+
          if (majorVersion >= 13) {
            osVersion = "11";
            if (isDebugEnabled) {
              console.log("[OS Detection] Windows 11 detected via Client Hints", {
                platformVersion,
                majorVersion,
              });
            }
          }
        }
      } catch (error) {
        if (isDebugEnabled) {
          console.log(
            "[OS Detection] Failed to parse platform version:",
            platformVersion,
            error instanceof Error ? error.message : String(error),
          );
        }
        // Fall back to osVersion === "10" if parsing fails
      }
    } else if (isDebugEnabled) {
      console.log(
        "[OS Detection] Windows 10 detected (no Client Hints available)",
        { clientHintsHeader: platformVersion },
      );
    }
  }

  if (isDebugEnabled) {
    console.log("[OS Detection] Final result:", { osName, osVersion });
  }

  return { osName, osVersion };
}
async function isLocked(req: Request, username: string) {
  return isLoginRateLimited(loginRateLimitKeys(req, username));
}

async function recordFailedLogin(req: Request, username: string) {
  return recordLoginFailure(loginRateLimitKeys(req, username));
}

export const login: RequestHandler = async (req, res) => {
  const body = (req.body || {}) as LoginRequest & {
    otp?: string;
    mode?: string;
    role?: string;
    platformVersion?: string;
  };
  const input = sanitizeUsername(body.username);
  const password = ensurePassword(body.password);
  const desiredRole = typeof body.role === "string" ? body.role.trim() : "";

  if (!input || !password)
    return res.status(400).json({
      error: "Missing credentials",
      message: "Please enter your credentials and password.",
      code: "MISSING_CREDENTIALS",
    });

  // Determine if input is a window ID or username
  const windowId = Number(input);
  const isWindowInput = Number.isInteger(windowId) && windowId >= 1;

  let userRow;
  let loginKey: string;
  let isWindowLogin = false;

  if (isWindowInput) {
    isWindowLogin = true;
    loginKey = `window_${windowId}`;
    if (await isLocked(req, loginKey)) {
      return res.status(429).json({
        error: "Too many attempts. Try again later.",
        message: "Too many attempts. Try again later.",
        code: "RATE_LIMITED" as any,
      });
    }
    userRow = await getUserByWindow(windowId);
  } else {
    loginKey = `user_${input}`;
    if (await isLocked(req, loginKey)) {
      return res.status(429).json({
        error: "Too many attempts. Try again later.",
        message: "Too many attempts. Try again later.",
        code: "RATE_LIMITED" as any,
      });
    }
    userRow = await getUserByUsername(input);
  }

  if (!userRow) {
    await recordFailedLogin(req, loginKey);
    return res.status(401).json({
      error: "Invalid username or password",
      message: "Invalid username or password.",
      code: "INVALID_CREDENTIALS",
    });
  }

  if (userRow.disabled) {
    return res.status(401).json({
      error: "Invalid username or password",
      message: "Invalid username or password.",
      code: "INVALID_CREDENTIALS",
    });
  }

  const passwordMatch = verifyPassword(password, userRow.password_hash);
  if (!passwordMatch) {
    await recordFailedLogin(req, loginKey);
    return res.status(401).json({
      error: "Invalid username or password",
      message: "Invalid username or password.",
      code: "INVALID_CREDENTIALS",
    });
  }

  // Screen width-based role restriction:
  // - When screen width < 1024px: only admin role can login
  // - When screen width >= 1024px: all user roles can login
  const screenWidth = (body as any).screenWidth || 1024; // Default to 1024 if not provided
  const isSmallScreen = screenWidth < 1024;

  if (isSmallScreen && userRow.role !== "admin") {
    await recordFailedLogin(req, loginKey);
    return res.status(403).json({
      error: "Admin access only on small screens",
      message: "Only admin users can log in on screens smaller than 1024px. Please use a larger screen or contact your administrator.",
      code: "UNAUTHORIZED" as AuthErrorCode,
    });
  }

  // Optional 2FA: require static code if configured
  const requiredOtp =
    (req.headers["x-otp"] as string) ||
    (req.headers["x-totp"] as string) ||
    (body as any).otp ||
    "";
  const configuredOtp = (process.env.TWO_FACTOR_STATIC_CODE || "").trim();
  if (configuredOtp) {
    if (!requiredOtp || requiredOtp !== configuredOtp) {
      return res.status(401).json({
        error: "Two-factor code required",
        message: "Two-factor code required.",
        code: "INVALID_CREDENTIALS",
      });
    }
  }

  // Determine the active role to use for this session
  // If desiredRole is specified and user has it, use it. Otherwise, use primary role.
  let activeRole = userRow.role;
  if (desiredRole && userRow.roles?.includes(desiredRole as any)) {
    activeRole = desiredRole as any;
  }

  // Validate that user has at least one role
  if (!activeRole) {
    console.error("User has no roles assigned:", {
      userId: userRow.id,
      username: userRow.username,
    });
    return res.status(500).json({
      error: "User configuration error",
      message:
        "User account is not properly configured. Please contact the administrator.",
      code: "USER_CONFIG_ERROR",
    });
  }

  // Capture device and browser info
  const userAgent = req.headers["user-agent"] || "";
  const parser = new UAParser(userAgent);
  const uaResult = parser.getResult();

  // Extract and normalize OS details
  const clientPlatformVersion =
    typeof body.platformVersion === "string" ? body.platformVersion : undefined;
  const { osName, osVersion } = normalizeOsDetection(
    uaResult as any,
    req,
    clientPlatformVersion,
  );

  // Use device-detector-js for more precise device detection
  const detector = new DeviceDetector();
  const deviceInfo = detector.parse(userAgent) as any;

  const isDebugDeviceDetection = process.env.DEBUG_DEVICE_DETECTION === "true";
  if (isDebugDeviceDetection) {
    console.log("[Device Detection] Full deviceInfo object keys:", Object.keys(deviceInfo || {}));
    console.log("[Device Detection] deviceInfo content:", JSON.stringify(deviceInfo, null, 2).substring(0, 500));
    if (deviceInfo?.device) {
      console.log("[Device Detection] device object keys:", Object.keys(deviceInfo.device || {}));
    }
  }

  // Extract device details with device-detector-js taking precedence for better accuracy
  let deviceVendor = "";
  let deviceModel = "";
  let deviceType = uaResult.device.type || "desktop";

  // device-detector-js specific extraction
  // The library returns an object with: device, client, os properties
  if (deviceInfo && typeof deviceInfo === "object") {
    const device = deviceInfo.device;

    if (device && typeof device === "object") {
      // device-detector-js uses different property names than ua-parser-js
      // Try multiple possible property names for brand and model
      deviceVendor = device.brand || device.vendor || device.name || "";
      deviceModel = device.model || device.code || "";
      deviceType = device.type || deviceType;

      if (isDebugDeviceDetection) {
        console.log("[Device Detection] Found device object in deviceInfo:", {
          vendor: deviceVendor,
          model: deviceModel,
          type: deviceType,
          allDeviceKeys: Object.keys(device),
        });
      }
    }
  }

  // Fallback to ua-parser-js if device-detector-js didn't provide vendor/model
  if (!deviceVendor) {
    deviceVendor = uaResult.device.vendor || "";
  }
  if (!deviceModel) {
    deviceModel = uaResult.device.model || "";
  }

  const isBot = uaResult.ua?.toLowerCase().includes("bot");

  // Filter out single-character or obviously invalid device info (like "K", "X", etc.)
  // These are often parsing artifacts and not real device names
  if (deviceVendor && deviceVendor.length <= 2) {
    deviceVendor = "";
  }
  if (deviceModel && deviceModel.length <= 2) {
    deviceModel = "";
  }

  if (isDebugDeviceDetection) {
    console.log("[Device Detection] Final extracted values:", {
      deviceVendor,
      deviceModel,
      deviceType,
    });
  }

  // Helper function to extract proper device name from User-Agent for common devices
  const extractDeviceNameFromUA = (): string | null => {
    const ua = userAgent.toLowerCase();

    // iPhone/iPad patterns
    if (ua.includes("iphone")) {
      const match = userAgent.match(/iPhone\s*(?:OS\s*)?(\d+)/i);
      if (match) {
        const version = match[1];
        // Try to extract the specific iPhone model from User-Agent
        // iPhone models: X, XS, XS Max, 11, 11 Pro, 11 Pro Max, 12, 12 mini, 12 Pro, 12 Pro Max, 13, 13 mini, 13 Pro, 13 Pro Max, 14, 14 Plus, 14 Pro, 14 Pro Max, 15, 15 Plus, 15 Pro, 15 Pro Max
        if (ua.includes("iphone13,1")) return "iPhone 12 mini";
        if (ua.includes("iphone13,2")) return "iPhone 12";
        if (ua.includes("iphone13,3")) return "iPhone 12 Pro";
        if (ua.includes("iphone13,4")) return "iPhone 12 Pro Max";
        if (ua.includes("iphone14,4")) return "iPhone 13 mini";
        if (ua.includes("iphone14,5")) return "iPhone 13";
        if (ua.includes("iphone14,2")) return "iPhone 13 Pro";
        if (ua.includes("iphone14,3")) return "iPhone 13 Pro Max";
        if (ua.includes("iphone15,1")) return "iPhone 14";
        if (ua.includes("iphone15,2")) return "iPhone 14 Pro";
        if (ua.includes("iphone15,3")) return "iPhone 14 Pro Max";
        if (ua.includes("iphone15,4")) return "iPhone 15";
        if (ua.includes("iphone15,5")) return "iPhone 15 Plus";
        if (ua.includes("iphone16,1")) return "iPhone 15 Pro";
        if (ua.includes("iphone16,2")) return "iPhone 15 Pro Max";
        return `iPhone ${version}`;
      }
      return "iPhone";
    }

    // iPad patterns
    if (ua.includes("ipad")) {
      if (ua.includes("ipad pro")) return "iPad Pro";
      if (ua.includes("ipad air")) return "iPad Air";
      if (ua.includes("ipad mini")) return "iPad Mini";
      return "iPad";
    }

    // Samsung patterns
    if (ua.includes("samsung") || ua.includes("sm-")) {
      // Samsung model codes: SM-G950F (S8), SM-G960F (S9), SM-G970F (S10), SM-G980F (S20), etc.
      const match = userAgent.match(/sm-g(\d{3})/i);
      if (match) {
        const modelCode = match[1];
        const modelMap: Record<string, string> = {
          "950": "Samsung Galaxy S8",
          "955": "Samsung Galaxy S8+",
          "960": "Samsung Galaxy S9",
          "965": "Samsung Galaxy S9+",
          "970": "Samsung Galaxy S10",
          "975": "Samsung Galaxy S10+",
          "977": "Samsung Galaxy S10e",
          "980": "Samsung Galaxy S20",
          "981": "Samsung Galaxy S20+",
          "988": "Samsung Galaxy S20 Ultra",
          "990": "Samsung Galaxy S21",
          "991": "Samsung Galaxy S21+",
          "998": "Samsung Galaxy S21 Ultra",
          "998b": "Samsung Galaxy S22 Ultra",
          "900": "Samsung Galaxy S22",
          "901": "Samsung Galaxy S22+",
          "910": "Samsung Galaxy S23",
          "911": "Samsung Galaxy S23+",
          "918": "Samsung Galaxy S23 Ultra",
        };
        return modelMap[modelCode] || `Samsung Galaxy S${parseInt(modelCode[0]) * 10 + parseInt(modelCode[1])}`;
      }
      if (ua.includes("samsung sm-")) {
        const match = userAgent.match(/samsung\s+(sm-[a-z0-9]+)/i);
        if (match) return `Samsung ${match[1].toUpperCase()}`;
      }
      return "Samsung Device";
    }

    // Google Pixel patterns
    if (ua.includes("pixel")) {
      const match = userAgent.match(/Pixel\s+(\d+)/i);
      if (match) return `Google Pixel ${match[1]}`;
      return "Google Pixel";
    }

    return null;
  };

  // Try to extract full device name from User-Agent
  const extractedDeviceName = extractDeviceNameFromUA();

  // Build device string based on device type
  let device: string;

  // Device restriction: Non-admin users can only access from desktop when screen width < 1024px
  if (isSmallScreen && activeRole !== "admin" && (deviceType === "mobile" || deviceType === "tablet")) {
    return res.status(403).json({
      error: "Desktop only access",
      message: "Non-admin users can only access from desktop browsers on small screens. Please use a larger screen or contact your administrator.",
      code: "DEVICE_NOT_ALLOWED" as AuthErrorCode,
    });
  }

  // Helper to check if we have any meaningful vendor or model info
  const hasDeviceInfo = (vendor: string, model: string): boolean => {
    return !!(vendor || model);
  };

  if (deviceType === "mobile" || deviceType === "tablet") {
    // First try to use the extracted device name from User-Agent
    if (extractedDeviceName) {
      device = extractedDeviceName;
    } else if (hasDeviceInfo(deviceVendor, deviceModel)) {
      // Show vendor + model, or just model/vendor if one is missing
      device = `${deviceVendor || ""} ${deviceModel || ""}`.trim();
    } else {
      // Fallback based on OS if no vendor/model info at all
      if (osName === "Android") {
        device = "Android Device";
      } else if (osName === "iOS") {
        device = "iOS Device";
      } else {
        device = deviceType === "tablet" ? "Tablet" : "Mobile Device";
      }
    }
  } else {
    // For desktop, show vendor/model if available
    if (hasDeviceInfo(deviceVendor, deviceModel)) {
      device = `${deviceVendor || ""} ${deviceModel || ""}`.trim();
    } else {
      // For Windows desktop, include OS version for more specificity
      // since brand/model info is not available in user-agent
      if (osName === "Windows") {
        device = `Windows PC ${osVersion ? `(${osVersion})` : ""}`.trim();
      } else if (osName === "Mac") {
        device = `Mac ${osVersion ? `(${osVersion})` : ""}`.trim();
      } else if (osName === "Linux") {
        device = "Linux Desktop";
      } else {
        device = "Desktop";
      }
    }
  }

  // Extract browser details
  const browserName = uaResult.browser.name || "Unknown";
  const browserVersion = uaResult.browser.version || "";
  const browser = `${browserName}${browserVersion ? ` ${browserVersion}` : ""}`.trim();

  // Legacy fields for backward compatibility
  const os = `${osName}${osVersion ? ` ${osVersion}` : ""}`.trim();

  // Extract and clean IP address
  const ipAddress = getClientIpAddress(req);

  // Atomic session creation with limit enforcement and race condition prevention
  const sessionResult = await createUserSessionAtomic({
    userId: userRow.id,
    username: userRow.username,
    activeRole: activeRole,
    windowId: userRow.window_id ?? null,
    jobTitleId: userRow.job_title_id ?? null,
    maxSessions: MAX_SESSIONS_PER_USER,
    device,
    browser,
    os,
    ipAddress,
    osName,
    osVersion,
    deviceVendor,
    deviceModel,
    browserName,
    browserVersion,
  });

  if ("error" in sessionResult) {
    // Log the max sessions reached event for security auditing
    await logAudit({
      action: "auth.max_sessions_reached",
      userId: userRow.id,
      username: userRow.username,
      role: activeRole,
      windowId: userRow.window_id ?? null,
      details: {
        maxSessions: MAX_SESSIONS_PER_USER,
        ipAddress: getClientIpAddress(req),
        device: device,
        browser: browser,
      },
    });

    return res.status(409).json({
      error: "Maximum session limit reached",
      message:
        "Maximum session limit reached. Please log out from another device to continue.",
      code: "MAX_SESSIONS_REACHED" as AuthErrorCode,
    });
  }

  const { token, session } = sessionResult;
  await clearLoginAccountFailures(loginRateLimitKeys(req, loginKey));

  res.setHeader("Set-Cookie", buildSessionCookie(token));

  const user = toAuthUserFromRow(userRow);
  user.role = activeRole;
  user.roles = userRow.roles;
  try {
    await logAudit({
      action: "auth.login",
      userId: user.id,
      username: user.username,
      role: user.role,
      windowId: user.windowId ?? null,
    });
  } catch {}

  const payload: LoginResponse = {
    user,
    message: `Signed in as ${user.username}`,
  };

  (req as any).auth = {
    id: session.userId,
    username: session.username,
    role: session.activeRole,
    windowId: session.windowId ?? null,
    sessionId: session.id,
  };

  res.json(payload);

  // Broadcast session update to all admin clients
  broadcastSessionUpdate().catch((err) =>
    console.error("[SessionWS] Failed to broadcast after login:", err)
  );
};

export const me: RequestHandler = async (req, res) => {
  const result = await authenticateRequest(req, res, { touch: true });
  if (!result.ok) {
    // Return JSON response instead of letting authenticateRequest handle it
    const err = result as any;
    return res.json({
      user: null,
      errorCode: err.code,
      message: err.message,
    } as MeResponse);
  }

  const session = result.session;

  // Fetch full user data from database to include email, phone, department, etc.
  const p = getPool();
  const { rows } = await p.query(
    `SELECT u.id, u.username, u.password_hash, u.window_id, u.disabled, u.full_name, u.job_title_id, u.phone, u.email, u.department, u.created_at, u.must_change_password
     FROM users u
     WHERE u.id=$1 LIMIT 1`,
    [session.userId],
  );

  if (!rows[0]) {
    // User no longer exists
    await revokeSessionById(session.id, "invalidated");
    res.setHeader("Set-Cookie", buildSessionClearCookie());
    return res.json({
      user: null,
      errorCode: "SESSION_INVALIDATED",
      message: "Your account no longer exists.",
    } as MeResponse);
  }

  const userRow = rows[0];
  const user = toAuthUserFromRow(userRow);
  user.role = session.activeRole;
  user.roles = [session.activeRole]; // Set roles to current active role
  user.lastLoginAt = session.createdAt.getTime();

  res.json({ user } as MeResponse);
};

export const heartbeat: RequestHandler = async (req, res) => {
  const result = await authenticateRequest(req, res, { touch: true });
  if (!result.ok) {
    // Only log authentication failures for heartbeat, not every successful heartbeat
    // to avoid excessive logging
    if ((result as any).code === "SESSION_EXPIRED" || (result as any).code === "SESSION_INVALIDATED") {
      try {
        const cookies = parseCookies(req.headers.cookie || "");
        const token = cookies[SESSION_COOKIE];
        const session = token ? await findSessionByToken(token) : null;
        if (session) {
          await logAudit({
            action: "auth.heartbeat_failed",
            userId: session.userId,
            username: session.username,
            role: session.activeRole,
            windowId: session.windowId ?? null,
            details: {
              sessionId: session.id,
              reason: (result as any).code,
            },
          });
        }
      } catch {}
    }
    return respondWithAuthError(res, result);
  }
  res.json({ ok: true, lastActivityAt: result.session.lastActivityAt.getTime() });
};

export const logout: RequestHandler = async (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];

  if (token) {
    try {
      const session = await findSessionByToken(token);
      if (session) {
        await revokeSessionById(session.id, "logout");
        await logAudit({
          action: "auth.logout",
          userId: session.userId,
          username: session.username,
          role: session.activeRole,
          windowId: session.windowId ?? null,
        });
      } else {
        await revokeSessionByToken(token, "logout");
      }
    } catch {}
  }

  res.setHeader("Set-Cookie", buildSessionClearCookie());
  res.json({ ok: true });

  // Broadcast session update to all admin clients
  broadcastSessionUpdate().catch((err) =>
    console.error("[SessionWS] Failed to broadcast after logout:", err)
  );
};

export const tabOpened: RequestHandler = async (req, res) => {
  const result = await authenticateRequest(req, res, { touch: true });
  if (!result.ok) return respondWithAuthError(res, result);

  await incrementTabCount(result.session.id);
  res.json({ ok: true, tabCount: result.session.tabCount + 1 });
};

export const tabClosed: RequestHandler = async (req, res) => {
  const result = await authenticateRequest(req, res, { touch: false });
  if (!result.ok) return respondWithAuthError(res, result);

  await decrementTabCount(result.session.id);
  res.json({ ok: true });
};

function respondWithAuthError(
  res: Response,
  error: { status: number; code: AuthErrorCode; message: string } | AuthResult,
) {
  if (!("ok" in error) || error.ok === false) {
    const err = error as any;
    return res
      .status(err.status)
      .json({ error: err.message, message: err.message, code: err.code });
  }
}

/**
 * Middleware that automatically touches (updates last_activity_at) authenticated sessions.
 * Should be applied to all routes that require authentication.
 * This ensures that active sessions stay alive as long as they're being used.
 */
export function requireAuthentication(): RequestHandler {
  return async (req, res, next) => {
    const result = await authenticateRequest(req, res, { touch: true });
    if (!result.ok) return respondWithAuthError(res, result);

    (req as any).auth = {
      id: result.session.userId,
      username: result.session.username,
      role: result.session.activeRole,
      windowId: result.session.windowId ?? null,
      sessionId: result.session.id,
    };
    next();
  };
}

export function requireRole(roles: UserRole[]): RequestHandler {
  return async (req, res, next) => {
    const result = await authenticateRequest(req, res, { touch: true });
    if (!result.ok) return respondWithAuthError(res, result);

    const userRole = result.session.activeRole;
    const hasPermission = roles.includes(userRole);

    if (!hasPermission) {
      console.warn(
        `[Auth] Access denied: user role '${userRole}' not in allowed roles [${roles.join(", ")}]`,
        {
          userId: result.session.userId,
          username: result.session.username,
          userRole,
          allowedRoles: roles,
          path: req.path,
          method: req.method,
        },
      );
      return res.status(403).json({
        error:
          "Access denied. You do not have permission to perform this action.",
        message:
          "Access denied. You do not have permission to perform this action.",
        code: "UNAUTHORIZED" as AuthErrorCode,
      });
    }
    (req as any).auth = {
      id: result.session.userId,
      username: result.session.username,
      role: result.session.activeRole,
      windowId: result.session.windowId ?? null,
      sessionId: result.session.id,
    };
    next();
  };
}

export function requireTellerForWindowParam(paramName: string): RequestHandler {
  return async (req, res, next) => {
    const result = await authenticateRequest(req, res, { touch: true });
    if (!result.ok) return respondWithAuthError(res, result);
    const windowId = Number(req.params[paramName]);
    if (!Number.isInteger(windowId) || windowId <= 0) {
      return res
        .status(400)
        .json({ error: "Invalid window id", message: "Invalid window id" });
    }

    const isAdmin = result.session.activeRole === "admin";
    const isTellerForWindow =
      result.session.activeRole === "teller" &&
      result.session.windowId === windowId;

    if (!isAdmin && !isTellerForWindow) {
      return res.status(403).json({
        error:
          "Access denied. You do not have permission to perform this action.",
        message:
          "Access denied. You do not have permission to perform this action.",
        code: "UNAUTHORIZED" as AuthErrorCode,
      });
    }

    (req as any).auth = {
      id: result.session.userId,
      username: result.session.username,
      role: result.session.activeRole,
      windowId: result.session.windowId ?? null,
      sessionId: result.session.id,
    };
    next();
  };
}

export const switchRole: RequestHandler = async (req, res) => {
  const authResult = await authenticateRequest(req, res, { touch: true });
  if (!authResult.ok) return respondWithAuthError(res, authResult);

  const { session, token } = authResult;
  const body = (req.body || {}) as { role?: string };
  const desiredRole = (body.role || "").trim() as UserRole;

  if (!desiredRole) {
    return res.status(400).json({
      error: "Missing role",
      message: "Please specify a role to switch to.",
    });
  }

  if (
    !["reception", "teller", "admin", "employee", "archiever"].includes(
      desiredRole,
    )
  ) {
    return res.status(400).json({
      error: "Invalid role",
      message: "The specified role is not valid.",
    });
  }

  // Get user's available roles from the database
  const p = getPool();
  const { rows } = await p.query(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY is_primary DESC`,
    [session.userId],
  );

  const availableRoles = rows.map((r) => r.role as UserRole);

  if (!availableRoles.includes(desiredRole)) {
    return res.status(403).json({
      error: "Access denied",
      message: `You do not have permission to access the ${desiredRole} role.`,
      code: "UNAUTHORIZED",
    });
  }

  // Update the session's active role
  await p.query(`UPDATE user_sessions SET active_role = $2 WHERE id = $1`, [
    session.id,
    desiredRole,
  ]);

  // Fetch the updated session
  const updatedSession = await findSessionByToken(token);
  if (!updatedSession) {
    return res.status(500).json({
      error: "Failed to switch role",
      message: "Could not update your session.",
    });
  }

  // Audit log for role change
  await logAudit({
    action: "auth.role_switched",
    userId: session.userId,
    username: session.username,
    role: desiredRole,
    windowId: session.windowId ?? null,
    details: {
      sessionId: session.id,
      previousRole: session.activeRole,
      newRole: desiredRole,
    },
  });

  const user = toAuthUserFromSession(updatedSession);
  res.json({ user, message: `Switched to ${desiredRole} role` });
};

export const listSessionsHandler: RequestHandler = async (req, res) => {
  try {
    const auth = (req as any).auth;
    console.log("[listSessionsHandler] Request received", {
      method: req.method,
      path: req.path,
      username: auth?.username || "no-auth",
      role: auth?.role || "no-role",
      hasCookie: !!req.headers.cookie,
    });

    const sessions = await listSessions();
    console.log(
      "[listSessionsHandler] Successfully fetched sessions, count:",
      sessions.length,
    );

    const payload: ListSessionsResponse = { sessions };
    res.header("Content-Type", "application/json");
    res.json(payload);
  } catch (error) {
    console.error(
      "[listSessionsHandler] Error fetching sessions:",
      error instanceof Error ? error.message : error,
    );
    res.status(500).json({
      error: "Failed to fetch sessions",
      sessions: [],
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// Revoke a specific session by ID
export const revokeSessionHandler: RequestHandler = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const auth = (req as any).auth;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    // Revoke the session
    await revokeSessionById(sessionId, "invalidated");

    // Log the audit
    await logAudit({
      action: "auth.session_revoked",
      userId: auth?.id ?? null,
      username: auth?.username ?? null,
      role: auth?.role ?? null,
      details: { revokedSessionId: sessionId },
    });

    res.json({ ok: true, message: "Session revoked successfully" });

    // Broadcast session update to all admin clients
    broadcastSessionUpdate().catch((err) =>
      console.error("[SessionWS] Failed to broadcast after revoke:", err)
    );
  } catch (error) {
    console.error("[revokeSessionHandler] Error:", error);
    res.status(500).json({
      error: "Failed to revoke session",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// Revoke all sessions for current user (cleanup endpoint for emergency)
export const revokeAllSessionsHandler: RequestHandler = async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[SESSION_COOKIE];

    if (!token) {
      return res.status(401).json({
        error: "No session found",
        message: "Please provide a valid session token",
        code: "NO_SESSION",
      });
    }

    // Find the session to get user ID
    const session = await findSessionByToken(token);
    if (!session) {
      return res.status(401).json({
        error: "Session invalid",
        message: "Your session is invalid",
        code: "SESSION_INVALIDATED",
      });
    }

    // Revoke all sessions for this user EXCEPT the current one
    await revokeSessionsForUser(session.userId, "invalidated", session.id);

    // Log the audit
    await logAudit({
      action: "auth.all_sessions_revoked",
      userId: session.userId,
      username: session.username,
      role: session.activeRole,
      details: { currentSessionKept: session.id },
    });

    res.json({
      ok: true,
      message: "All other sessions revoked successfully. You remain logged in.",
    });

    // Broadcast session update to all admin clients
    broadcastSessionUpdate().catch((err) =>
      console.error("[SessionWS] Failed to broadcast after revoke all:", err)
    );
  } catch (error) {
    console.error("[revokeAllSessionsHandler] Error:", error);
    res.status(500).json({
      error: "Failed to revoke sessions",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * sessionPing handler for the new /api/session/ping endpoint.
 * Requirements:
 * 1. POST request
 * 2. Updates last_activity_at (via touch: true)
 * 3. Securely handles credentials (via cookies)
 */
export const sessionPing: RequestHandler = async (req, res) => {
  const result = await authenticateRequest(req, res, { touch: true });
  if (!result.ok) return respondWithAuthError(res, result);
  res.json({ ok: true, lastActivityAt: result.session.lastActivityAt.getTime() });
};

/**
 * Validates password strength requirements
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!password || password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export const changePassword: RequestHandler = async (req, res) => {
  try {
    // Authenticate the request
    const result = await authenticateRequest(req, res, { touch: true });
    if (!result.ok) return respondWithAuthError(res, result);

    const userId = result.session.userId;
    const body = req.body || {};

    // Validate input
    const currentPassword = ensurePassword(body.currentPassword);
    const newPassword = ensurePassword(body.newPassword);
    const confirmPassword = ensurePassword(body.confirmPassword);

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Please provide current password, new password, and confirm password",
        code: "INVALID_INPUT",
      });
    }

    // Check if new password matches confirm password
    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: "Passwords do not match",
        message: "New password and confirm password do not match",
        code: "PASSWORD_MISMATCH",
      });
    }

    // Validate new password strength
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      return res.status(400).json({
        error: "Password does not meet security requirements",
        message: strengthCheck.errors.join(". "),
        code: "WEAK_PASSWORD",
      });
    }

    // Prevent using the same password
    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: "New password cannot be the same as current password",
        message: "Please choose a different password",
        code: "SAME_PASSWORD",
      });
    }

    // Get user from database
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: "User not found",
        message: "Could not find user account",
        code: "USER_NOT_FOUND",
      });
    }

    const user = rows[0];

    // Verify current password is correct
    const currentPasswordValid = verifyPassword(currentPassword, user.password_hash);
    if (!currentPasswordValid) {
      return res.status(401).json({
        error: "Invalid current password",
        message: "The current password you provided is incorrect",
        code: "INVALID_CURRENT_PASSWORD",
      });
    }

    // Hash the new password
    const newPasswordHash = hashPassword(newPassword);

    await pool.query(
      `WITH updated_user AS (
         UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2 RETURNING id
       )
       UPDATE user_sessions
       SET revoked_at = now(), revoke_reason = 'invalidated'
       WHERE user_id = (SELECT id FROM updated_user)
         AND id <> $3
         AND revoked_at IS NULL`,
      [newPasswordHash, userId, result.session.id],
    );

    // Log audit
    await logAudit({
      action: "auth.password_changed",
      userId: result.session.userId,
      username: result.session.username,
      role: result.session.activeRole,
      windowId: result.session.windowId ?? null,
    });

    res.json({
      ok: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("[changePassword] Error:", error);
    res.status(500).json({
      error: "Failed to change password",
      message: error instanceof Error ? error.message : "An unexpected error occurred",
      code: "INTERNAL_ERROR",
    });
  }
};
