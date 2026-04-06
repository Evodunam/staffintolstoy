import type { Request } from "express";

/** Host part of the request is a local machine (not a public deploy hostname). */
export function isLocalDevHostFromRequest(req: Pick<Request, "get">): boolean {
  const raw = req.get("host") || "";
  const host = raw.split(":")[0]?.toLowerCase() || "";
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "[::1]" || host === "::1") return true;
  if (host.startsWith("192.168.")) return true;
  if (host.startsWith("10.")) return true;
  return false;
}
