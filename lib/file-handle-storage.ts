/**
 * Persistent File System Access API handle storage.
 *
 * localStorage cannot serialize `FileSystemFileHandle` objects, so the active
 * project handle is kept in IndexedDB (structured clone preserves handles
 * across reloads / browser restarts).
 */

export interface StoredFileHandleMeta {
  fileName: string | null;
  lastSavedAt: number | null;
}

export interface StoredFileHandleRecord extends StoredFileHandleMeta {
  handle: FileSystemFileHandle | null;
}

const DB_NAME = "luova-project-files";
const STORE_NAME = "file-handles";
const RECORD_KEY = "active-project-file";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  if (!hasIndexedDB()) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      dbPromise = null; // allow retry
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

function txRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let req: IDBRequest;
    try {
      req = run(store);
    } catch (err) {
      reject(err);
      return;
    }
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/** Persist the active handle + metadata. Pass `null` handle to clear. */
export async function idbSetFileHandle(
  handle: FileSystemFileHandle | null,
  meta?: { fileName?: string | null; lastSavedAt?: number | null }
): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    if (!handle) {
      await txRequest(db, "readwrite", (store) =>
        store.delete(RECORD_KEY)
      ).catch(() => undefined);
      return;
    }
    const record: StoredFileHandleRecord = {
      handle,
      fileName: meta?.fileName ?? (handle.name || null),
      lastSavedAt: meta?.lastSavedAt ?? Date.now(),
    };
    await txRequest(db, "readwrite", (store) =>
      store.put(record, RECORD_KEY)
    ).catch(() => undefined);
  } catch {
    // Persistence is best-effort: never break Save if IDB is unavailable.
  }
}

/** Retrieve the previously stored handle + metadata, if any. */
export async function idbGetFileHandle(): Promise<StoredFileHandleRecord | null> {
  if (!hasIndexedDB()) return null;
  try {
    const db = await openDB();
    const record = await txRequest<StoredFileHandleRecord | undefined>(
      db,
      "readonly",
      (store) => store.get(RECORD_KEY)
    );
    if (!record?.handle) return null;
    return record;
  } catch {
    return null;
  }
}

/** Remove the stored handle (e.g. New Project / reset). */
export async function idbClearFileHandle(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    await txRequest(db, "readwrite", (store) => store.delete(RECORD_KEY)).catch(
      () => undefined
    );
  } catch {
    // best-effort
  }
}

/** Update stored metadata without replacing the handle. */
export async function idbUpdateFileHandleMeta(
  meta: Partial<StoredFileHandleMeta>
): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const existing = await idbGetFileHandle();
    if (!existing?.handle) return;
    await idbSetFileHandle(existing.handle, {
      fileName: meta.fileName !== undefined ? meta.fileName : existing.fileName,
      lastSavedAt:
        meta.lastSavedAt !== undefined
          ? meta.lastSavedAt
          : existing.lastSavedAt,
    });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/** Whether the File System Access API pickers are available. */
export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== "undefined" &&
    "showOpenFilePicker" in window &&
    "showSaveFilePicker" in window
  );
}

function asAnyHandle(handle: unknown): any {
  return handle as any;
}

/**
 * Ensure `readwrite` permission, prompting the user if needed.
 * Must be called during a user gesture (click / Cmd+S).
 * Returns true when writing may proceed.
 */
export async function ensureFileHandlePermission(
  handle: FileSystemFileHandle | null | undefined
): Promise<boolean> {
  if (!handle) return false;
  const h = asAnyHandle(handle);
  try {
    if (typeof h.queryPermission === "function") {
      const current = await h.queryPermission({ mode: "readwrite" });
      if (current === "granted") return true;
    }
  } catch {
    // fall through to requestPermission
  }
  if (typeof h.requestPermission !== "function") {
    // Older implementations: attempt the write directly.
    return true;
  }
  try {
    const next = await h.requestPermission({ mode: "readwrite" });
    return next === "granted";
  } catch {
    return false;
  }
}

/** Reset the cached IDB connection (test-only). */
export function __resetFileHandleStorageForTests(): void {
  dbPromise = null;
  activeFileWrites = 0;
  for (const resolve of writeDrainWaiters) resolve();
  writeDrainWaiters.clear();
}

// ---------------------------------------------------------------------------
// Write helpers (unit-testable without a picker)
// ---------------------------------------------------------------------------

/**
 * Tracks open `FileSystemWritableFileStream` lifetimes. While a write is in
 * flight the OS file is locked ("already open"): opening it in a picker can
 * show the file greyed out until `close()` releases it. New Project and Open
 * Project must drain this (see `awaitPendingFileWrites`) before detaching
 * the handle or showing a picker.
 */
let activeFileWrites = 0;
const writeDrainWaiters = new Set<() => void>();

function trackWriteStart(): void {
  activeFileWrites++;
}

function trackWriteEnd(): void {
  activeFileWrites = Math.max(0, activeFileWrites - 1);
  if (activeFileWrites === 0) {
    for (const resolve of writeDrainWaiters) resolve();
    writeDrainWaiters.clear();
  }
}

/** True while a `writeJsonToHandle` writable is still open. */
export function hasPendingFileWrites(): boolean {
  return activeFileWrites > 0;
}

/** Resolves once every in-flight file write has closed or aborted. */
export function awaitPendingFileWrites(): Promise<void> {
  if (activeFileWrites === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    writeDrainWaiters.add(resolve);
  });
}

/**
 * Write project JSON to an existing handle. Never opens a file picker.
 * Throws on failure (including user-cancelled writes via `AbortError`).
 *
 * The writable is always closed or aborted — even on failure — so a failed
 * write can never leak an open stream that keeps the file locked.
 */
export async function writeJsonToHandle(
  handle: FileSystemFileHandle,
  json: string | Blob
): Promise<void> {
  trackWriteStart();
  try {
    const writable = await (handle as any).createWritable();
    try {
      await writable.write(json);
      await writable.close();
    } catch (writeError) {
      // Release the OS lock before propagating: an un-closed writable keeps
      // the file "already open" for subsequent pickers.
      try {
        await writable.abort?.();
      } catch {
        // best-effort
      }
      throw writeError;
    }
  } finally {
    trackWriteEnd();
  }
}
