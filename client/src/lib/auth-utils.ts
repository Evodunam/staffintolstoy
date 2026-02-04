import { getUrlForPath } from "./subdomain-utils";

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Redirect to login with a toast notification
// Login pages should be on main domain, not app subdomain
export function redirectToLogin(toast?: (options: { title: string; description: string; variant: string }) => void) {
  if (toast) {
    toast({
      title: "Unauthorized",
      description: "You are logged out. Logging in again...",
      variant: "destructive",
    });
  }
  setTimeout(() => {
    const loginUrl = getUrlForPath("/api/login", true);
    window.location.href = loginUrl;
  }, 500);
}
