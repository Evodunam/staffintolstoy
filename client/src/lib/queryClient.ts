import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = `${res.status}: ${text}`;
    try {
      const data = JSON.parse(text) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      // keep message as status + text
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

/**
 * Fetches the current user's affiliate profile. Returns null if not an affiliate.
 * Server returns 200 with null when no affiliate (no 404), so no console error.
 */
export async function fetchAffiliateMe(): Promise<Record<string, unknown> | null> {
  const res = await fetch("/api/affiliates/me", { credentials: "include" });
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

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error: any) {
      // Handle network errors (connection refused, etc.)
      if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("Failed to fetch"))) {
        // Silently return empty data for connection errors to prevent UI crashes
        // Only log in development mode
        if (import.meta.env.DEV) {
          console.warn(`Connection error for ${queryKey.join("/")}: Server may not be running`);
        }
        
        // Return appropriate empty data structure based on query type
        const queryKeyStr = queryKey.join("/");
        if (queryKeyStr.includes("device-tokens") || queryKeyStr.includes("notifications") || queryKeyStr.includes("timesheets") || queryKeyStr.includes("payout")) {
          return [] as T;
        }
        // For other queries, return null
        return null as T;
      }
      // Re-throw other errors
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
