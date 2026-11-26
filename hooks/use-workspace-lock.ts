"use client";

import { useEffect, useSyncExternalStore } from "react";
import { disableWorkspacePersistence } from "@/stores/app-store";

/**
 * One editing tab at a time. Every tab saves its whole in-memory project to
 * the same localStorage key, so two live tabs silently overwrite each
 * other's work. The first tab holds a Web Lock for its lifetime; a later
 * tab stops saving and offers to take over. Taking over steals the lock —
 * the old tab stops saving — then reloads to pick up the latest project.
 *
 * The lock is requested once per page (module state, not per mount), so
 * React's dev double-mount can't make a tab lose its own lock.
 */

const LOCK_NAME = "luova-workspace";

let isActive = true;
let started = false;
const listeners = new Set<() => void>();

function deactivate() {
  disableWorkspacePersistence();
  isActive = false;
  for (const listener of listeners) listener();
}

function acquireWorkspaceLock() {
  if (started || typeof navigator === "undefined" || !navigator.locks) return;
  started = true;
  navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        deactivate();
        return;
      }
      // Hold until the page unloads.
      return new Promise<void>(() => {});
    })
    // Rejected with AbortError when another tab takes over.
    .catch(deactivate);
}

export async function takeOverWorkspace() {
  // Steal (the other tab's lock request rejects) and release right away;
  // the reloaded page then acquires the lock normally.
  await navigator.locks.request(LOCK_NAME, { steal: true }, async () => {});
  window.location.reload();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceLock(): boolean {
  useEffect(acquireWorkspaceLock, []);
  return useSyncExternalStore(
    subscribe,
    () => isActive,
    () => true
  );
}
