/**
 * True for typical local machine hostnames (and dev port used by this stack).
 * Does not use import.meta.env alone — production builds served from localhost
 * would otherwise expose dev-only UI.
 */
export function isLocalDevHostname(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (h === "[::1]" || h === "::1") return true;
  if (h.startsWith("192.168.")) return true;
  if (h.startsWith("10.")) return true;
  return false;
}

/** Browser: local-ish origin (LAN + legacy dev port check). */
export function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  const { hostname, port } = window.location;
  return isLocalDevHostname(hostname) || port === "2000";
}

/** Dev toolbar / test hooks: Vite dev server running on a local host only. */
export function showClientDevTools(): boolean {
  return import.meta.env.DEV && isLocalDevHost();
}
