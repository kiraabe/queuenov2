import type { RequestHandler } from "express";
import { validateLicense } from "../services/license-service";
import { getLicenseHost } from "../utils/license-host";

const PUBLIC_PATHS = new Set([
  "/ping",
  "/healthz",
  "/readyz",
  "/license/status",
  "/license/validate",
]);

export const enforceLicense: RequestHandler = async (req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();

  const host = getLicenseHost(req);
  if (!host) {
    return res.status(503).json({
      error: "The licensed server hostname is not configured.",
      code: "LICENSE_HOST_CONFIG_MISSING",
    });
  }

  try {
    const result = await validateLicense(host);
    if (!result.valid) {
      return res.status(403).json({
        error: "A valid license is required to use this service.",
        message: result.message,
        code: result.errorCode ?? "LICENSE_INVALID",
      });
    }
    next();
  } catch (error) {
    console.error("[License] Enforcement check failed:", error);
    return res.status(503).json({
      error: "License verification is temporarily unavailable.",
      code: "LICENSE_CHECK_UNAVAILABLE",
    });
  }
};
