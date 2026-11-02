import type { Request } from "express";

export function getLicenseHost(req: Request): string | null {
  const configuredHost = process.env.LICENSE_HOST?.trim();
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "true";

  if (!configuredHost) {
    return isProduction ? null : req.hostname.toLowerCase();
  }

  try {
    const url = new URL(`http://${configuredHost}`);
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
