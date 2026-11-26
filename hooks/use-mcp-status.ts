"use client";

import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5000;

/**
 * Returns true when the MCP endpoint is reachable (i.e. the Next.js server is up).
 * Used to show a connection indicator in the UI.
 */
export function useMCPStatus(enabled: boolean): boolean {
  const [reachable, setReachable] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReachable(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function check() {
      try {
        // A GET to the MCP endpoint with no session returns a 400 (expected) — still means it's up
        const res = await fetch("/api/mcp", { method: "GET" });
        if (!cancelled) setReachable(res.status < 500);
      } catch {
        if (!cancelled) setReachable(false);
      }
      if (cancelled) return;
      timer = setTimeout(check, CHECK_INTERVAL_MS);
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setReachable(false);
    };
  }, [enabled]);

  return reachable;
}
