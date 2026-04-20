import { QueryClient, QueryFunction, type QueryFunctionContext } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const data = JSON.parse(text) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // HTML/plain gateway errors (e.g. DO/Cloudflare) — not from our JSON body
      if (res.status === 504) {
        message =
          "Gateway timeout (504): the load balancer gave up waiting for the app (often cold start, crash loop, or a very slow upstream like Mercury). Retry; check host logs and DO/CF timeouts.";
      } else if (res.status === 502) {
        message = "Bad gateway (502): app unreachable or overloaded. Retry shortly.";
      }
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

/**
 * GET JSON from url; on 404 returns fallback without throwing (avoids console error).
 * Use for endpoints that may not exist yet (e.g. /api/worker/payouts).
 */
export async function fetchJsonOrFallback<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url, { method: "GET", credentials: "include", cache: "no-store" });
  if (res.status === 404) return fallback;
  await throwIfResNotOk(res);
  return res.json();
}

/**
 * Fetches the current user's affiliate profile. Returns null if not an affiliate.
 * Server returns 200 with null when no affiliate (no 404), so no console error.
 */
export async function fetchAffiliateMe(): Promise<Record<string, unknown> | null> {
  const res = await fetch("/api/affiliates/me", { credentials: "include", cache: "no-store" });
  await throwIfResNotOk(res);
  const data = await res.json();
  return data ?? null;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error: any) {
    // Handle network errors (connection refused, etc.)
    if (error instanceof TypeError && (
      error.message.includes("fetch") || 
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError") ||
      error.message.includes("Network request failed")
    )) {
      throw new Error("Unable to connect to server. Please check if the server is running and try again.");
    }
    // Handle connection refused specifically
    if (error?.message?.includes("ERR_CONNECTION_REFUSED") || error?.code === "ECONNREFUSED") {
      throw new Error("Unable to connect to server. Please check if the server is running and try again.");
    }
    // Re-throw other errors
    throw error;
  }
}

/** True if the error is a network/connection failure (server down, no network). */
function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("fetch") || msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed")) {
      return true;
    }
  }
  const anyErr = error as { message?: string; code?: string };
  const msg = (anyErr?.message ?? "").toLowerCase();
  const code = anyErr?.code ?? "";
  return (
    msg.includes("connection refused") ||
    msg.includes("err_connection_refused") ||
    msg.includes("err_connection_reset") ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND"
  );
}

/** Throttle connection-error warnings per key (once per 30s) to avoid console spam when server is down. */
const connectionWarnLast = new Map<string, number>();
const CONNECTION_WARN_THROTTLE_MS = 30_000;

type UnauthorizedBehavior = "returnNull" | "throw";
export function getQueryFn<T>(options: { on401: UnauthorizedBehavior }): QueryFunction<T> {
  const { on401: unauthorizedBehavior } = options;
  return async ({ queryKey }) => {
    try {
      const res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        cache: "no-store",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null as T;
      }

      await throwIfResNotOk(res);
      return (await res.json()) as T;
    } catch (error: any) {
      if (!isConnectionError(error)) {
        throw error;
      }
      const key = queryKey.join("/");
      if (import.meta.env.DEV) {
        const now = Date.now();
        const last = connectionWarnLast.get(key) ?? 0;
        if (now - last >= CONNECTION_WARN_THROTTLE_MS) {
          connectionWarnLast.set(key, now);
          console.warn(`Connection error for ${key}: Server may not be running`);
        }
      }
      const queryKeyStr = queryKey.join("/");
      if (queryKeyStr.includes("device-tokens") || queryKeyStr.includes("notifications") || queryKeyStr.includes("timesheets") || queryKeyStr.includes("payout")) {
        return [] as T;
      }
      return null as T;
    }
  };
}

/** Clears stale session when any default query gets 401 (avoids hammering APIs after cookie expiry). */
function wrapQueryFnWith401SessionReset<T>(inner: QueryFunction<T>): QueryFunction<T> {
  return async (ctx: QueryFunctionContext) => {
    try {
      return await inner(ctx);
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 401) {
        queryClient.setQueryData(["/api/auth/user"], null);
      }
      throw e;
    }
  };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: wrapQueryFnWith401SessionReset(getQueryFn({ on401: "throw" })),
      refetchInterval: false,
      // Enable window-focus refetch so queries with explicit staleTime (job feed, timesheets, etc.)
      // automatically refresh when the user returns to the tab — without hammering queries
      // that keep staleTime: Infinity (the default below, so they're never considered stale).
      refetchOnWindowFocus: true,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
