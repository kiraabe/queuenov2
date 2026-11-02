import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import {
  checkQueryRateLimit,
  getActiveConnectionsCount,
  registerConnection,
  unregisterConnection,
} from "../services/query-rate-limiter";
import { findSessionByToken, SESSION_COOKIE, SESSION_IDLE_TIMEOUT_SECONDS } from "../store/sessions";
import { parseCookies } from "../utils/auth";

const PASSWORD_CHANGE_ALLOWED_PATHS = new Set([
  "/api/license/status",
  "/api/license/validate",
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/heartbeat",
  "/api/auth/tab-opened",
  "/api/auth/tab-closed",
  "/api/auth/change-password",
  "/api/session/ping",
  "/api/session/logout",
]);

/**
 * Express middleware for database rate limiting
 * Checks query and connection limits for authenticated users
 */
export function dbRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Extract user ID from request (should be set by auth middleware)
  const userId = (req as any).userId;
  const rateLimitKey = userId
    ? `user:${userId}`
    : `ip:${req.socket.remoteAddress || req.ip}`;

  const rateLimitStatus = checkQueryRateLimit(rateLimitKey);

  if (!rateLimitStatus.allowed) {
    return res.status(429).json({
      error: "Rate limit exceeded",
      code: "DB_RATE_LIMIT_EXCEEDED",
      message: `Database query limit exceeded (${rateLimitStatus.limit} queries per ${rateLimitStatus.windowSeconds}s)`,
      limit: rateLimitStatus.limit,
      windowSeconds: rateLimitStatus.windowSeconds,
      resetAt: rateLimitStatus.resetAt,
      retryAfter: Math.ceil((rateLimitStatus.resetAt - Date.now()) / 1000),
    });
  }

  // Set rate limit headers in response
  res.setHeader("X-RateLimit-Limit", rateLimitStatus.limit.toString());
  res.setHeader("X-RateLimit-Remaining", rateLimitStatus.remaining.toString());
  res.setHeader(
    "X-RateLimit-Reset",
    Math.ceil(rateLimitStatus.resetAt / 1000).toString()
  );

  // Log high usage
  if (rateLimitStatus.remaining <= 10) {
    console.warn(
      `[DB-Rate-Limit] ${rateLimitKey} approaching limit: ${rateLimitStatus.remaining} requests remaining`
    );
  }

  next();
}

/**
 * Optional: Stricter rate limiting for write operations
 * Returns 429 if too many concurrent write operations
 */
export function strictDbRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const userId = (req as any).userId;
  if (!userId) return next();

  // Only apply strict limit to state-changing operations
  const isWriteOperation = ["POST", "PUT", "PATCH", "DELETE"].includes(
    req.method
  );

  // Exclude lightweight heartbeat/session pings from strict rate limiting
  const isHeartbeat =
    req.path === "/api/session/ping" ||
    req.path === "/api/auth/heartbeat" ||
    req.path === "/api/auth/me";

  if (isWriteOperation && !isHeartbeat) {
    const activeConnections = getActiveConnectionsCount(userId);
    if (activeConnections >= 2) {
      return res.status(429).json({
        error: "Too many concurrent operations",
        code: "DB_CONCURRENT_OPERATION_LIMIT",
        message: "Too many concurrent write operations. Please try again.",
        activeConnections,
        maxAllowed: 2,
      });
    }

    const connectionId = randomUUID();
    const registration = registerConnection(userId, connectionId);
    if (!registration.allowed) {
      return res.status(429).json({
        error: "Too many concurrent operations",
        code: "DB_CONCURRENT_OPERATION_LIMIT",
        message: registration.reason,
      });
    }
    const release = () => unregisterConnection(userId, connectionId);
    res.once("finish", release);
    res.once("close", release);
  }

  next();
}

/**
 * Middleware to extract and validate user ID from various sources
 * This should run AFTER authentication middleware
 */
export async function extractUserIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.path.startsWith("/api/")) return next();
    const passwordChangeAllowed = PASSWORD_CHANGE_ALLOWED_PATHS.has(req.path);
    const userId =
      (req as any).session?.userId ||
      (req as any).user?.id ||
      (req as any).auth?.id;

    if (userId) {
      (req as any).userId = userId;
      return next();
    }

    const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
    if (!token) return next();

    const session = await findSessionByToken(token);
    const now = Date.now();
    if (
      session &&
      !session.revokedAt &&
      now <= session.expiresAt.getTime() &&
      now - session.lastActivityAt.getTime() <= SESSION_IDLE_TIMEOUT_SECONDS * 1000
    ) {
      if (session.mustChangePassword && !passwordChangeAllowed) {
        return res.status(403).json({
          error: "Password change required",
          message: "Change your temporary password before using the application.",
          code: "PASSWORD_CHANGE_REQUIRED",
        });
      }
      (req as any).userId = session.userId;
    }

    next();
  } catch (error) {
    next(error);
  }
}
