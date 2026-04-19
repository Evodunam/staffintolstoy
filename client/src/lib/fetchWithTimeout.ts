/**
 * fetch() that aborts after `timeoutMs` so session bootstrap cannot hang the UI forever.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 20_000, signal: outer, cache, ...rest } = init ?? {};
  const ctrl = new AbortController();
  const id = setTimeout(() => {
    ctrl.abort(new DOMException(`Request exceeded ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  const onOuterAbort = () => {
    ctrl.abort(outer?.reason ?? new DOMException("Aborted", "AbortError"));
  };

  if (outer) {
    if (outer.aborted) {
      clearTimeout(id);
      throw outer.reason ?? new DOMException("Aborted", "AbortError");
    }
    outer.addEventListener("abort", onOuterAbort);
  }

  try {
    // Avoid stale "308 from disk cache" / CDN for credentialed API probes (esp. apex → app).
    return await fetch(input, { ...rest, cache: cache ?? "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(id);
    if (outer) outer.removeEventListener("abort", onOuterAbort);
  }
}
