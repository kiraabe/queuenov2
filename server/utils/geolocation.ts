import { isIP } from "node:net";
import { describeIp } from "./getClientIp";

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

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

// Cache geolocation lookups for 24 hours to reduce API calls
const geoCache = new Map<string, { data: GeoLocation; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Look up geolocation and network owner for an IP address
 * Returns cached data if available, otherwise fetches from IPinfo
 */
export async function getGeolocation(ipAddress: string): Promise<GeoLocation> {
  if (!ipAddress || isIP(ipAddress) === 0) return EMPTY_GEO;
  const ipLabel = describeIp(ipAddress);
  if (ipLabel !== "Public") return { ...EMPTY_GEO, network: ipLabel };

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
