/**
 * Helpers for detecting whether the app is currently running on the dedicated
 * admin subdomain (admin.estimatrix.io). Used to:
 *   - Lock down post-login redirects so admins always land on /admin.
 *   - Wrap admin routes with AdminHostShell instead of the worker/company chrome.
 *   - Show the admin-specific MFA grace banner.
 *
 * Single source of truth so we never sprinkle hostname comparisons across
 * components. SSR-safe: returns false when window is undefined.
 */

export const ADMIN_HOSTNAME_CONST = "admin.estimatrix.io";
export const ADMIN_HOST_LOGIN_LANDING = "/admin";

export function isOnAdminHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  // Match exact and any future admin.* variant we add.
  return host === ADMIN_HOSTNAME_CONST || host.startsWith("admin.");
}

