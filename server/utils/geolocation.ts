import { isIP } from "node:net";

/**
 * Geolocation utility for IP address lookup
 */

export interface GeoLocation {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  region: string | null;
}

// Cache geolocation lookups for 24 hours to reduce API calls
const geoCache = new Map<string, { data: GeoLocation; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Look up geolocation data for an IP address
 * Returns cached data if available, otherwise fetches from IPinfo Core
 */
export async function getGeolocation(ipAddress: string): Promise<GeoLocation> {
  if (
    !ipAddress ||
    isIP(ipAddress) === 0 ||
    ipAddress === "127.0.0.1" ||
    ipAddress === "::1" ||
    ipAddress.startsWith("::ffff:127.")
  ) {
    return { country: null, countryCode: null, city: null, region: null };
  }

  const token = process.env.IPINFO_TOKEN?.trim();
  if (!token) return { country: null, countryCode: null, city: null, region: null };

  // Check cache
  const cached = geoCache.get(ipAddress);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `https://api.ipinfo.io/lookup/${encodeURIComponent(ipAddress)}?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(3000) },
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      geo?: {
        country?: string;
        country_code?: string;
        city?: string;
        region?: string;
      };
    };

    const geoData: GeoLocation = {
      country: data.geo?.country || null,
      countryCode: data.geo?.country_code || null,
      city: data.geo?.city || null,
      region: data.geo?.region || null,
    };

    // Cache the result
    geoCache.set(ipAddress, { data: geoData, timestamp: Date.now() });

    return geoData;
  } catch (error) {
    console.warn(
      "Geolocation lookup failed:",
      error instanceof Error ? error.name : "Unknown error",
    );
    // Return null values on failure, don't throw
    return { country: null, countryCode: null, city: null, region: null };
  }
}
