import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getPool } from "./store/db";
import { handleDemo } from "./routes/demo";
import { validateLicenseHandler, checkLicenseStatusHandler } from "./routes/license";
import {
  createLicenseHandler,
  listLicensesHandler,
  getLicenseKeyHandler,
  updateLicenseStatusHandler,
  deleteLicenseHandler,
  verifyLicensesPinHandler,
  requireLicensesUnlock,
} from "./routes/license-management";
import {
  clearDemo,
  seedTestData,
  getQueueSettings,
  updateQueueSettings,
  getDailyReport,
  getOverallAnalytics,
  getEmployeeStats,
  listServiceCategories,
  getCategoryServices,
  getWindowServices,
  setWindowServices,
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory,
  createService,
  updateService,
  deleteService,
} from "./routes/admin";
import { setupAdmin } from "./routes/admin-setup";
import {
  callNext,
  complete,
  createTicket,
  displayData,
  listWindows,
  recall,
  // seedDemo, // removed
  skip,
  sseHandler,
  adminSseHandler,
  transfer,
  getTicketStatus,
} from "./routes/queue";
import {
  listSessionsHandler,
  revokeSessionHandler,
  revokeAllSessionsHandler,
  sessionPing,
  login,
  logout,
  me,
  heartbeat,
  tabOpened,
  tabClosed,
  requireRole,
  requireTellerForWindowParam,
  requireAuthentication,
  switchRole,
  changePassword,
} from "./routes/auth";
import { cleanupAllStaleSessions } from "./store/sessions";
import { autoCancelExpiredHolds, DB_CONFIG } from "./store/db";
import { dbRateLimitMiddleware, strictDbRateLimitMiddleware, extractUserIdMiddleware } from "./middleware/db-rate-limit";
import { enforceLicense } from "./middleware/license-enforcement";
import { getRateLimitStatus, resetUserRateLimit, clearAllRateLimits } from "./services/query-rate-limiter";
import { tellerStats, tellerTickets } from "./routes/teller";
import {
  employeeReceivedTickets,
  employeeStats,
  employeeHistory,
  startCase,
  completeCase,
  proceedCase,
  handleStartCase,
  employeePerformanceMetrics,
  caseWorkflow,
  listCaseWorkflows,
  getStoredProgressFlow,
  requireFieldVisit,
  startFieldWork,
  completeFieldWork,
  listFieldVisitCases,
  getFieldVisitCase,
  readyForService,
  holdCase,
  resumeCase,
  getCaseHolds,
} from "./routes/employee";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listWindows as listWindowsForManagement,
  createWindow,
  updateWindow,
  deleteWindow,
  assignTellerToWindow,
  resetWindowPassword,
  resetUserPassword,
  listJobTitlesHandler,
} from "./routes/management";
import { bulkImportUsers } from "./routes/bulk-import";
import {
  getWaitingDocumentsDb,
  markDocumentsFetched,
  getDocumentStatus,
  getGlobalQueue,
  startTicket,
  getTicketDetails,
  addInternalNotes,
  updateDocumentChecklist,
  markTicketRetrieved,
  releaseTicket,
  getArchivedHistory,
  manuallyArchiveTicket,
} from "./routes/archiever";

export function createServer() {
  const app = express();

  // Trust the single reverse proxy hop in front of the app.
  app.set("trust proxy", 1);

  // Middleware
  const allowedEnv = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAnyOrigin =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_ANY_ORIGIN === "true";
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowAnyOrigin) return callback(null, true);
        try {
          const u = new URL(origin);
          if (
            allowedEnv.includes(u.origin) ||
            allowedEnv.includes(u.host) ||
            allowedEnv.includes(u.hostname)
          )
            return callback(null, true);
        } catch {}
        return callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-Requested-With", "X-CSRF-Token", "Sec-CH-UA-Platform-Version"],
    }),
  );

  // Enforce HTTPS in production
  app.use((req, res, next) => {
    const isProd =
      process.env.NODE_ENV === "production" ||
      process.env.FORCE_HTTPS === "true";
    if (isProd) {
      if (!req.secure) {
        const host = req.headers.host || "";
        const url = `https://${host}${req.originalUrl}`;
        return res.redirect(301, url);
      }
    }
    // Disable strict origin checks if ALLOWED_ORIGINS is not explicitly configured
    // This allows the app to work on any origin in production without additional config
    next();
  });

  // Security headers with Helmet
  // Helmet sets secure defaults for various HTTP headers
  app.use(
    helmet({
      // Content Security Policy
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          connectSrc: ["'self'"],
          frameAncestors:
            process.env.NODE_ENV === "production" ? ["'self'"] : ["*"],
        },
      },
      // Relaxed policies for development/preview environments
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "unsafe-none" },
      crossOriginEmbedderPolicy: false,
      // Prevent browsers from MIME-type sniffing
      noSniff: true,
      frameguard:
        process.env.NODE_ENV === "production" ? { action: "sameorigin" } : false,
    }),
  );

  // Application-specific security headers (set after Helmet)
  app.use((req, res, next) => {
    // Permissions Policy (formerly Feature Policy) - disable potentially sensitive APIs
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    // Client Hints for improved OS detection (Windows 11, etc.)
    res.setHeader("Accept-CH", "Sec-CH-UA-Platform-Version");
    next();
  });

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use("/api", enforceLicense);

  // Extract user ID from authentication context for rate limiting
  app.use(extractUserIdMiddleware);

  // Apply database rate limiting to all API requests
  app.use("/api/", dbRateLimitMiddleware);

  // Stricter rate limiting for write operations
  app.use("/api/", strictDbRateLimitMiddleware);

  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())) {
      return next();
    }

    const origin = req.get("origin");
    const referer = req.get("referer");
    const source = origin || referer;
    if (!source) {
      if (req.headers.cookie?.includes("queue_session=") || req.path === "/api/auth/login") {
        return res.status(403).json({ error: "Origin required for this request" });
      }
      return next();
    }

    let sourceOrigin: string;
    try {
      sourceOrigin = new URL(source).origin;
    } catch {
      return res.status(403).json({ error: "Invalid request origin" });
    }

    const requestOrigin = `${req.protocol}://${req.get("host")}`;
    const isAllowed =
      sourceOrigin === requestOrigin ||
      allowedEnv.some((allowed) => {
        try {
          return sourceOrigin === new URL(allowed).origin;
        } catch {
          return sourceOrigin === `https://${allowed}` || sourceOrigin === `http://${allowed}`;
        }
      });

    if (!isAllowed) {
      return res.status(403).json({ error: "Invalid request origin" });
    }
    next();
  });

  // Health and example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });
  app.get("/api/healthz", (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });
  app.get("/api/readyz", async (_req, res) => {
    try {
      // Check if database is accessible
      const result = await getPool().query("SELECT 1 as ping");
      const ok = result.rowCount !== null && result.rowCount >= 0;
      res.json({
        ok,
        time: Date.now(),
        database: ok ? "connected" : "disconnected",
      });
    } catch (error) {
      console.error("Database readiness check failed:", error);
      res.status(503).json({
        ok: false,
        time: Date.now(),
        database: "disconnected",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/api/demo", handleDemo);
  app.get("/api/license/status", checkLicenseStatusHandler);
  app.post("/api/license/validate", validateLicenseHandler);

  // Auth API
  app.post("/api/auth/login", login);
  app.post("/api/auth/logout", logout);
  app.get("/api/auth/me", me);
  app.get("/api/auth/heartbeat", heartbeat);
  app.post("/api/auth/tab-opened", tabOpened);
  app.post("/api/auth/tab-closed", tabClosed);
  app.post("/api/auth/switch-role", switchRole);
  app.post("/api/auth/change-password", requireAuthentication(), changePassword);

  // New Session/Heartbeat API
  app.post("/api/session/ping", sessionPing);
  app.post("/api/session/logout", logout);

  // Queue/Teller API
  app.get("/api/events", sseHandler);
  app.get("/api/admin/events", requireRole(["admin"]), adminSseHandler);
  app.post("/api/tickets", requireRole(["reception"]), createTicket);
  app.get("/api/windows", listWindows);
  app.post(
    "/api/windows/:id/call-next",
    requireTellerForWindowParam("id"),
    callNext,
  );
  app.post(
    "/api/windows/:id/recall",
    requireTellerForWindowParam("id"),
    recall,
  );
  app.post(
    "/api/windows/:id/complete",
    requireTellerForWindowParam("id"),
    complete,
  );
  app.post("/api/windows/:id/skip", requireTellerForWindowParam("id"), skip);
  app.post(
    "/api/windows/:id/transfer",
    requireTellerForWindowParam("id"),
    transfer,
  );
  app.get("/api/display", displayData);
  app.get(
    "/api/teller/:id/stats",
    requireTellerForWindowParam("id"),
    tellerStats,
  );
  app.get(
    "/api/teller/:id/tickets",
    requireTellerForWindowParam("id"),
    tellerTickets,
  );

  // Employee API
  app.get("/api/employee/stats", requireRole(["employee"]), employeeStats);
  app.get(
    "/api/employee/tickets",
    requireRole(["employee"]),
    employeeReceivedTickets,
  );
  app.get("/api/employee/history", requireRole(["employee"]), employeeHistory);
  app.get(
    "/api/employee/performance",
    requireRole(["employee"]),
    employeePerformanceMetrics,
  );
  app.post("/api/employee/cases/start", requireRole(["employee"]), startCase);
  app.post(
    "/api/employee/cases/:id/start",
    requireRole(["employee"]),
    handleStartCase,
  );
  app.post(
    "/api/employee/cases/:id/proceed",
    requireRole(["employee"]),
    proceedCase,
  );
  app.post(
    "/api/employee/cases/:id/complete",
    requireRole(["employee"]),
    completeCase,
  );
  app.post("/api/employee/cases/:id/hold", requireRole(["employee"]), holdCase);
  app.post(
    "/api/employee/cases/:id/resume",
    requireRole(["employee"]),
    resumeCase,
  );
  app.get(
    "/api/employee/holds",
    requireRole(["employee", "teller", "admin", "archiever"]),
    getCaseHolds,
  );

  app.get(
    "/api/employee/case-workflow",
    requireRole(["employee", "teller", "admin", "archiever"]),
    caseWorkflow,
  );
  app.get(
    "/api/employee/case-workflows",
    requireRole(["employee", "teller", "admin", "archiever"]),
    listCaseWorkflows,
  );
  app.get(
    "/api/employee/progress-flow",
    requireRole(["employee", "teller", "admin", "archiever"]),
    getStoredProgressFlow,
  );

  // Field Visit Workflow endpoints
  app.post(
    "/api/employee/tickets/:ticketId/require-field-visit",
    requireRole(["employee", "admin"]),
    requireFieldVisit,
  );
  app.post(
    "/api/employee/field-visit-cases/:caseId/start",
    requireRole(["employee", "admin"]),
    startFieldWork,
  );
  app.post(
    "/api/employee/field-visit-cases/:caseId/complete",
    requireRole(["employee", "admin"]),
    completeFieldWork,
  );
  app.post(
    "/api/employee/field-visit-cases/:caseId/ready-for-service",
    requireRole(["employee", "admin"]),
    readyForService,
  );
  app.get(
    "/api/employee/field-visit-cases",
    requireRole(["employee", "admin"]),
    listFieldVisitCases,
  );
  app.get(
    "/api/employee/field-visit-cases/:caseId",
    requireRole(["employee", "admin"]),
    getFieldVisitCase,
  );

  // Archiever API
  app.get(
    "/api/archiever/documents",
    requireRole(["archiever"]),
    getWaitingDocumentsDb,
  );
  app.post(
    "/api/archiever/documents/:ticketId/fetch",
    requireRole(["archiever"]),
    markDocumentsFetched,
  );
  app.get(
    "/api/archiever/documents/:ticketId/status",
    requireRole(["archiever"]),
    getDocumentStatus,
  );

  // New Archiver Interface API Routes
  app.get(
    "/api/archiever/global-queue",
    requireRole(["archiever"]),
    getGlobalQueue,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/start",
    requireRole(["archiever"]),
    startTicket,
  );
  app.get(
    "/api/archiever/tickets/:ticketId/details",
    requireRole(["archiever"]),
    getTicketDetails,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/notes",
    requireRole(["archiever"]),
    addInternalNotes,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/document-checklist",
    requireRole(["archiever"]),
    updateDocumentChecklist,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/retrieved",
    requireRole(["archiever"]),
    markTicketRetrieved,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/release",
    requireRole(["archiever"]),
    releaseTicket,
  );
  app.get(
    "/api/archiever/history",
    requireRole(["archiever"]),
    getArchivedHistory,
  );
  app.post(
    "/api/archiever/tickets/:ticketId/manually-archive",
    requireRole(["archiever"]),
    manuallyArchiveTicket,
  );

  app.get("/api/tickets/:code", getTicketStatus);
  app.get("/api/admin/sessions", requireRole(["admin"]), listSessionsHandler);
  app.delete("/api/admin/sessions/:sessionId", requireRole(["admin"]), revokeSessionHandler);
  app.post("/api/auth/revoke-all-sessions", requireAuthentication(), revokeAllSessionsHandler);
  app.post("/api/admin/clear-demo", requireRole(["admin"]), clearDemo);
  app.post("/api/admin/seed-test-data", requireRole(["admin"]), seedTestData);
  app.get(
    "/api/admin/queue-settings",
    requireRole(["admin"]),
    getQueueSettings,
  );
  app.post(
    "/api/admin/queue-settings",
    requireRole(["admin"]),
    updateQueueSettings,
  );
  app.get("/api/admin/daily-report", requireRole(["admin"]), getDailyReport);
  app.get("/api/admin/overall-analytics", requireRole(["admin"]), getOverallAnalytics);
  app.get(
    "/api/admin/employee-stats",
    requireRole(["admin"]),
    getEmployeeStats,
  );

  // License management endpoints
  app.post(
    "/api/admin/licenses/verify-pin",
    requireRole(["admin"]),
    verifyLicensesPinHandler,
  );
  app.post(
    "/api/admin/licenses",
    requireRole(["admin"]),
    requireLicensesUnlock,
    createLicenseHandler,
  );
  app.get(
    "/api/admin/licenses",
    requireRole(["admin"]),
    requireLicensesUnlock,
    listLicensesHandler,
  );
  app.get(
    "/api/admin/licenses/:licenseId/key",
    requireRole(["admin"]),
    requireLicensesUnlock,
    getLicenseKeyHandler,
  );
  app.put(
    "/api/admin/licenses/:licenseId/status",
    requireRole(["admin"]),
    requireLicensesUnlock,
    updateLicenseStatusHandler,
  );
  app.delete(
    "/api/admin/licenses/:licenseId",
    requireRole(["admin"]),
    requireLicensesUnlock,
    deleteLicenseHandler,
  );

  // Service categories and services endpoints (public for reception console)
  app.get("/api/service-categories", listServiceCategories);
  app.get("/api/service-categories/:categoryId/services", getCategoryServices);

  // Window and user management endpoints
  app.get(
    "/api/admin/users",
    requireRole(["admin", "employee", "teller", "reception", "archiever"]),
    listUsers,
  );
  app.post("/api/admin/users", requireRole(["admin"]), createUser);
  app.post("/api/admin/users/bulk-import", requireRole(["admin"]), bulkImportUsers);
  app.put("/api/admin/users/:id", requireRole(["admin"]), updateUser);
  app.delete("/api/admin/users/:id", requireRole(["admin"]), deleteUser);
  app.post(
    "/api/admin/users/:userId/reset-password",
    requireRole(["admin"]),
    resetUserPassword,
  );
  app.get(
    "/api/admin/job-titles",
    requireRole(["admin", "employee", "teller", "archiever", "reception"]),
    listJobTitlesHandler,
  );
  app.get(
    "/api/admin/windows",
    requireRole(["admin"]),
    listWindowsForManagement,
  );
  app.post("/api/admin/windows", requireRole(["admin"]), createWindow);
  app.put("/api/admin/windows/:id", requireRole(["admin"]), updateWindow);
  app.delete("/api/admin/windows/:id", requireRole(["admin"]), deleteWindow);
  app.post(
    "/api/admin/windows/:windowId/reset-password",
    requireRole(["admin"]),
    resetWindowPassword,
  );
  app.post(
    "/api/admin/users/:userId/assign-window",
    requireRole(["admin"]),
    assignTellerToWindow,
  );

  // Window service restrictions endpoints
  app.get(
    "/api/admin/windows/:windowId/services",
    requireTellerForWindowParam("windowId"),
    getWindowServices,
  );
  app.put(
    "/api/admin/windows/:windowId/services",
    requireRole(["admin"]),
    setWindowServices,
  );

  // Service category endpoints
  app.post(
    "/api/admin/service-categories",
    requireRole(["admin"]),
    createServiceCategory,
  );
  app.put(
    "/api/admin/service-categories/:categoryId",
    requireRole(["admin"]),
    updateServiceCategory,
  );
  app.delete(
    "/api/admin/service-categories/:categoryId",
    requireRole(["admin"]),
    deleteServiceCategory,
  );

  // Service endpoints
  app.post("/api/admin/services", requireRole(["admin"]), createService);
  app.put(
    "/api/admin/services/:serviceId",
    requireRole(["admin"]),
    updateService,
  );
  app.delete(
    "/api/admin/services/:serviceId",
    requireRole(["admin"]),
    deleteService,
  );

  app.post("/api/admin/setup", setupAdmin);

  // Global error handler with sanitization and optional Sentry reporting
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use(async (err: any, _req: any, res: any, _next: any) => {
    console.error("Error caught by global handler:", {
      message: err?.message,
      status: err?.status,
      code: err?.code,
      stack: err?.stack,
    });
    try {
      // Attempt dynamic Sentry integration if available
      if (process.env.SENTRY_DSN) {
        try {
          // @ts-ignore - Sentry is optional, may not be installed
          const S = await import("@sentry/node").catch(() => null);
          if (S?.init) {
            S.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.0 });
            S.captureException(err);
          }
        } catch {}
      }
    } catch {}
    const status = err?.status || 500;
    const message =
      status >= 500 ? "Internal Server Error" : String(err?.message || "Error");
    res.status(status).json({ error: message });
  });

  // Perform initial cleanup of stale sessions on startup
  (async () => {
    try {
      const cleaned = await cleanupAllStaleSessions();
      if (cleaned > 0) {
        console.log(`[Sessions] Initial cleanup removed ${cleaned} stale sessions`);
      }
    } catch (error) {
      console.error("[Sessions] Initial cleanup failed:", error);
    }
  })();

  // Periodic cleanup of stale sessions (every minute)
  setInterval(async () => {
    try {
      const cleaned = await cleanupAllStaleSessions();
      if (cleaned > 0) {
        console.log(`[Sessions] Cleaned up ${cleaned} stale sessions`);
      }
    } catch (error) {
      console.error("[Sessions] Cleanup failed:", error);
    }
  }, 1 * 60 * 1000);

  // Perform initial check for expired holds on startup
  (async () => {
    try {
      await autoCancelExpiredHolds();
    } catch (error) {
      console.error("[Holds] Initial expiration check failed:", error);
    }
  })();

  // Periodic check for expired holds (every 5 minutes)
  setInterval(async () => {
    try {
      await autoCancelExpiredHolds();
    } catch (error) {
      console.error("[Holds] Expiration check failed:", error);
    }
  }, 5 * 60 * 1000);

  return app;
}
