/**
 * Utility functions for handling subdomain routing
 * Ensures app pages use app.domain.com while login pages stay on main domain
 */

/**
 * Gets the app subdomain URL (app.domain.com)
 * Falls back to current origin if subdomain detection fails
 */
export function getAppSubdomainUrl(): string {
  const currentHost = window.location.hostname;
  const currentProtocol = window.location.protocol;
  const currentPort = window.location.port;
  
  // If already on app subdomain, return current origin
  if (currentHost.startsWith('app.')) {
    return `${currentProtocol}//${currentHost}${currentPort ? `:${currentPort}` : ''}`;
  }
  
  // Extract base domain (e.g., "example.com" from "www.example.com" or "example.com")
  const parts = currentHost.split('.');
  let baseDomain: string;
  
  if (parts.length >= 2) {
    // Remove subdomain if present (e.g., "www" or "staging")
    baseDomain = parts.slice(-2).join('.');
  } else {
    // Fallback to current host if parsing fails
    baseDomain = currentHost;
  }
  
  // Construct app subdomain URL
  const appSubdomain = `app.${baseDomain}`;
  return `${currentProtocol}//${appSubdomain}${currentPort ? `:${currentPort}` : ''}`;
}

/**
 * Gets the main domain URL (without app subdomain)
 */
export function getMainDomainUrl(): string {
  const currentHost = window.location.hostname;
  const currentProtocol = window.location.protocol;
  const currentPort = window.location.port;
  
  // If on app subdomain, remove it
  if (currentHost.startsWith('app.')) {
    const baseDomain = currentHost.replace('app.', '');
    return `${currentProtocol}//${baseDomain}${currentPort ? `:${currentPort}` : ''}`;
  }
  
  // Already on main domain
  return `${currentProtocol}//${currentHost}${currentPort ? `:${currentPort}` : ''}`;
}

/**
 * Detects if the current device is mobile
 */
export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth < 768;
}

/**
 * Redirects to a path on the app subdomain
 */
export function redirectToAppSubdomain(path: string = '/'): void {
  const appUrl = getAppSubdomainUrl();
  window.location.href = `${appUrl}${path}`;
}

/**
 * Redirects to a path on the main domain (for login pages)
 */
export function redirectToMainDomain(path: string = '/'): void {
  const mainUrl = getMainDomainUrl();
  window.location.href = `${mainUrl}${path}`;
}

/**
 * Gets the appropriate URL for a given path
 * - Login/auth pages: main domain
 * - App pages: app subdomain
 */
export function getUrlForPath(path: string, isLoginPage: boolean = false): string {
  if (isLoginPage) {
    return `${getMainDomainUrl()}${path}`;
  }
  return `${getAppSubdomainUrl()}${path}`;
}
