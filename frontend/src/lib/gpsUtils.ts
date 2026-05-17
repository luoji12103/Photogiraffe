/**
 * Parse GPS coordinate strings to decimal degrees.
 * Handles two formats:
 *   1. Decimal string: "48.143056"
 *   2. exifread DMS string: "[48, 8, 17173/500]" or "48, 8, 34.346"
 */
export function parseGPSCoords(
  latStr: string,
  lngStr: string
): [number, number] | null {
  const parseSingle = (s: string): number | null => {
    if (!s) return null;
    // Try direct decimal first
    const direct = parseFloat(s);
    if (!isNaN(direct) && !s.includes(",") && !s.includes("[")) return direct;
    // Parse "[deg, min, sec/denom]" format from exifread
    const tokens = s.match(/(\d+)(?:\/(\d+))?/g);
    if (!tokens || tokens.length < 3) return null;
    const parts = tokens.map((t) => {
      const [n, d] = t.split("/");
      return d ? parseInt(n, 10) / parseInt(d, 10) : parseInt(n, 10);
    });
    return parts[0] + parts[1] / 60 + parts[2] / 3600;
  };

  const lat = parseSingle(latStr);
  const lng = parseSingle(lngStr);
  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null; // likely invalid
  return [lat, lng];
}

/** Format decimal degrees as a human-readable string */
export function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}
