import { isIP } from "node:net";

export interface GeoLocation {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
  network: string | null;
}

const EMPTY_GEO: GeoLocation = {
  country: null,
  countryCode: null,
  city: null,
  region: null,
  network: null,
};

const PRIVATE_NETWORK_LABEL = "Private network";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// Cache geolocation lookups for 24 hours to reduce API calls
const geoCache = new Map<string, { data: GeoLocation; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function isPrivateAddress(ip: string): boolean {
  const normalized = ip.replace(/^::ffff:/, "");
  if (normalized === "::1" || /^(fc|fd|fe80)/i.test(normalized)) return true;

  const [a, b] = normalized.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168
  );
}

/**
 * Look up geolocation and network owner for an IP address
 * Returns cached data if available, otherwise fetches from IPinfo
 */
export async function getGeolocation(ipAddress: string): Promise<GeoLocation> {
  if (!ipAddress || isIP(ipAddress) === 0) return EMPTY_GEO;
  if (isPrivateAddress(ipAddress)) return { ...EMPTY_GEO, network: PRIVATE_NETWORK_LABEL };

  const token = process.env.IPINFO_TOKEN?.trim();
  if (!token) return EMPTY_GEO;

  const cached = geoCache.get(ipAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://ipinfo.io/${encodeURIComponent(ipAddress)}/json?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(3000) },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      country?: string;
      city?: string;
      region?: string;
      org?: string;
    };

    const countryCode = data.country || null;
    const geoData: GeoLocation = {
      country: countryCode ? regionNames.of(countryCode) ?? countryCode : null,
      countryCode,
      city: data.city || null,
      region: data.region || null,
      network: data.org || null,
    };

    geoCache.set(ipAddress, { data: geoData, timestamp: Date.now() });

    return geoData;
  } catch (error) {
    console.warn(
      "Geolocation lookup failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    return EMPTY_GEO;
  }
}
