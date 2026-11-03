import type { Request } from "express";

const TRUST_CLOUDFLARE = process.env.TRUST_CLOUDFLARE === "true";

function normalizeIp(ip: string | null | undefined): string {
  return (ip ?? "").trim().replace(/^::ffff:/, "");
}

export function getClientIp(req: Request): string | null {
  if (TRUST_CLOUDFLARE) {
    const cfIp = normalizeIp(req.headers["cf-connecting-ip"] as string | undefined);
    if (cfIp) return cfIp;
  }
  return normalizeIp(req.ip) || normalizeIp(req.socket?.remoteAddress) || null;
}

export function describeIp(ip: string | null): "Local (loopback)" | "Private network" | "Public" | "Unknown" {
  if (!ip) return "Unknown";
  if (ip === "::1" || ip.startsWith("127.")) return "Local (loopback)";
  if (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(ip) ||
    /^(fc|fd|fe80)/i.test(ip)
  ) {
    return "Private network";
  }
  return "Public";
}
