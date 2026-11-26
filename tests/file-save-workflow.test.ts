/**
 * Integration tests for the persistent project file-save workflow:
 * - IndexedDB handle persistence + permission lifecycle (lib/file-handle-storage)
 * - Store handle lifecycle: setFileName/setIsSaving, loadProjectJSON handle
 *   preservation, reset clearing
 * - writeJsonToHandle writes via the handle without opening a picker
 * - Global Cmd+S / Ctrl+S shortcut dispatches `luova:save-project`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPresetThemeStyles } from "@/utils/theme-preset-helper";

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB mock (jsdom has no IndexedDB).
// Supports exactly what lib/asset-idb.ts and lib/file-handle-storage.ts use:
// open().onsuccess, createObjectStore, transaction().objectStore(),
// put/get/delete/clear/getAllKeys with onsuccess/onerror, tx.oncomplete.
// ---------------------------------------------------------------------------

type KeyMap = Map<string, any>;

const __idbDatabases = new Map<string, Map<string, KeyMap>>();

function __getStoreMap(dbName: string, storeName: string): KeyMap {
  let db = __idbDatabases.get(dbName);
  if (!db) {
    db = new Map();
    __idbDatabases.set(dbName, db);
  }
  let store = db.get(storeName);
  if (!store) {
    store = new Map();
    db.set(storeName, store);
  }
  return store;
}

function makeRequest<T>(run: () => T): any {
  const req: any = {};
  let result: T | undefined;
  let error: any;
  let ok = true;
  try {
    result = run();
  } catch (e) {
    ok = false;
    error = e;
  }
  req.result = result;
  req.error = error ?? null;
  setTimeout(() => {
    if (ok) req.onsuccess?.({ target: req });
    else req.onerror?.({ target: req });
  }, 0);
  return req;
}

function makeObjectStore(map: KeyMap): any {
  return {
    put: (value: any, key?: string) =>
      makeRequest(() => {
        // IDB put without explicit key requires the value to have a keyPath;
        // our modules always pass explicit keys.
        map.set(key as string, value);
        return key;
      }),
    get: (key: string) => makeRequest(() => map.get(key)),
    delete: (key: string) =>
      makeRequest(() => {
        map.delete(key);
        return undefined;
      }),
    clear: () =>
      makeRequest(() => {
        map.clear();
        return undefined;
      }),
    getAllKeys: () => makeRequest(() => Array.from(map.keys())),
  };
}

function installFakeIndexedDB() {
  const fakeIndexedDB = {
    open: (dbName: string, _version?: number) => {
      const req: any = {};
      setTimeout(() => {
        const db: any = {
          objectStoreNames: {
            contains: (storeName: string) =>
              __getStoreMap(dbName, storeName) !== undefined,
          },
          createObjectStore: (storeName: string) =>
            __getStoreMap(dbName, storeName),
          transaction: (storeName: string, _mode: string) => {
            const tx: any = {
              objectStore: () =>
                makeObjectStore(__getStoreMap(dbName, storeName)),
              oncomplete: null,
              onerror: null,
            };
            // Fire oncomplete async so callers can attach handlers first.
            setTimeout(() => tx.oncomplete?.({ target: tx }), 0);
            return tx;
          },
        };
        // Simulate upgrade path (our code guards with `contains`).
        req.onupgradeneeded?.({ target: { result: db } });
        req.result = db;
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };
  vi.stubGlobal("indexedDB", fakeIndexedDB);
}

function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Mock FileSystemFileHandle
// ---------------------------------------------------------------------------

function makeMockHandle(
  name = "my-project.luova",
  permission: "granted" | "denied" | "prompt" = "granted"
) {
  const written: unknown[] = [];
  const writable = {
    write: vi.fn(async (data: unknown) => {
      written.push(data);
    }),
    close: vi.fn(async () => {}),
  };
  return {
    handle: {
      name,
      queryPermission: vi.fn(async () => permission),
      requestPermission: vi.fn(async () => permission),
      createWritable: vi.fn(async () => writable),
      getFile: vi.fn(async () => new File(["{}"], name)),
    } as unknown as FileSystemFileHandle,
    writable,
    written,
  };
}

// Install the fake before importing modules that touch indexedDB at runtime.
installFakeIndexedDB();

const storage = await import("@/lib/file-handle-storage");
const { useAppStore } = await import("@/stores/app-store");

beforeEach(async () => {
  // Clear picker stubs from a previous test first. Note unstubAllGlobals also
  // removes the indexedDB stub, so reinstall it right after.
  vi.unstubAllGlobals();
  delete (window as any).showOpenFilePicker;
  delete (window as any).showSaveFilePicker;
  installFakeIndexedDB();
  storage.__resetFileHandleStorageForTests();
  __idbDatabases.clear();

  const { idbClearAllAssets } = await import("@/lib/asset-idb");
  await idbClearAllAssets().catch(() => undefined);
  useAppStore.getState().setFileHandle(null);
  useAppStore.getState().setFileName(null);
  useAppStore.getState().setIsSaving(false);
  useAppStore.getState().setSystemPrompt("");
  useAppStore.getState().setSystemPromptEnabled(false);
  // Settle the fire-and-forget IndexedDB chains above BEFORE the test body
  // runs — otherwise a stale delete can land after the test's own write.
  await flush(50);
  storage.__resetFileHandleStorageForTests();
});

describe("file-handle-storage: permission lifecycle", () => {
  it("supportsFileSystemAccess() is false without pickers, true with them", () => {
    expect(storage.supportsFileSystemAccess()).toBe(false);
    vi.stubGlobal("showOpenFilePicker", vi.fn());
    vi.stubGlobal("showSaveFilePicker", vi.fn());
    // supportsFileSystemAccess checks `window`; mirror the stubs there.
    (window as any).showOpenFilePicker = vi.fn();
    (window as any).showSaveFilePicker = vi.fn();
    expect(storage.supportsFileSystemAccess()).toBe(true);
    delete (window as any).showOpenFilePicker;
    delete (window as any).showSaveFilePicker;
  });

  it("ensure returns true without prompting when already granted", async () => {
    const { handle } = makeMockHandle("a.luova", "granted");
    expect(await storage.ensureFileHandlePermission(handle)).toBe(true);
    expect((handle as any).requestPermission).not.toHaveBeenCalled();
  });

  it("ensure prompts when state is prompt, honoring the answer", async () => {
    const granted = makeMockHandle("a.luova", "prompt");
    // Simulate the user granting on prompt.
    (granted.handle as any).requestPermission.mockResolvedValueOnce("granted");
    expect(await storage.ensureFileHandlePermission(granted.handle)).toBe(true);

    const denied = makeMockHandle("b.luova", "prompt");
    (denied.handle as any).requestPermission.mockResolvedValueOnce("denied");
    expect(await storage.ensureFileHandlePermission(denied.handle)).toBe(false);
  });

  it("ensure returns false with no handle", async () => {
    expect(await storage.ensureFileHandlePermission(null)).toBe(false);
  });
});

describe("file-handle-storage: IndexedDB persistence", () => {
  it("round-trips handle + metadata across a simulated reload", async () => {
    const { handle } = makeMockHandle("persist.luova");
    await storage.idbSetFileHandle(handle, { fileName: "persist.luova" });
    await flush();

    const record = await storage.idbGetFileHandle();
    expect(record?.handle).toBe(handle);
    expect(record?.fileName).toBe("persist.luova");
    expect(typeof record?.lastSavedAt).toBe("number");
  });

  it("idbUpdateFileHandleMeta patches metadata without replacing the handle", async () => {
    const { handle } = makeMockHandle("meta.luova");
    await storage.idbSetFileHandle(handle, { fileName: "meta.luova" });
    await flush();

    await storage.idbUpdateFileHandleMeta({ fileName: "renamed.luova" });
    await flush();

    const record = await storage.idbGetFileHandle();
    expect(record?.handle).toBe(handle);
    expect(record?.fileName).toBe("renamed.luova");
  });

  it("idbClearFileHandle removes the record", async () => {
    const { handle } = makeMockHandle("clear.luova");
    await storage.idbSetFileHandle(handle, { fileName: "clear.luova" });
    await flush();
    await storage.idbClearFileHandle();
    await flush();
    expect(await storage.idbGetFileHandle()).toBeNull();
  });
});

describe("file-handle-storage: writeJsonToHandle", () => {
  it("writes to disk via the handle without opening a picker", async () => {
    const { handle, writable, written } = makeMockHandle("save.luova");
    const showSaveFilePicker = vi.fn();
    (window as any).showSaveFilePicker = showSaveFilePicker;

    await storage.writeJsonToHandle(handle, '{"hello":1}');

    expect(handle.createWritable).toHaveBeenCalledTimes(1);
    expect(writable.write).toHaveBeenCalledWith('{"hello":1}');
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(written).toEqual(['{"hello":1}']);
    expect(showSaveFilePicker).not.toHaveBeenCalled();

    delete (window as any).showSaveFilePicker;
  });

  it("supports Blob payloads (Save As path)", async () => {
    const { handle, writable } = makeMockHandle("saveas.luova");
    const blob = new Blob(['{"a":1}'], { type: "application/json" });
    await storage.writeJsonToHandle(handle, blob);
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(writable.close).toHaveBeenCalledTimes(1);
  });
});

describe("project store: file handle lifecycle", () => {
  it("tracks fileName and isSaving", () => {
    const st = useAppStore.getState();
    expect(st.fileName).toBeNull();
    expect(st.isSaving).toBe(false);

    st.setFileName("demo.luova");
    expect(useAppStore.getState().fileName).toBe("demo.luova");

    st.setIsSaving(true);
    expect(useAppStore.getState().isSaving).toBe(true);
    st.setIsSaving(false);
    expect(useAppStore.getState().isSaving).toBe(false);
  });

  it("setFileHandle derives fileName and persists to IndexedDB", async () => {
    const { handle } = makeMockHandle("derived.luova");
    useAppStore.getState().setFileHandle(handle);
    expect(useAppStore.getState().fileHandle).toBe(handle);
    // fileName is derived from handle.name when empty.
    expect(useAppStore.getState().fileName).toBe("derived.luova");

    await flush();
    const record = await storage.idbGetFileHandle();
    expect(record?.handle).toBe(handle);
  });

  it("setFileHandle(null) clears fileName and IndexedDB", async () => {
    const { handle } = makeMockHandle("temp.luova");
    useAppStore.getState().setFileHandle(handle);
    await flush();
    expect(await storage.idbGetFileHandle()).not.toBeNull();

    useAppStore.getState().setFileHandle(null);
    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().fileName).toBeNull();
    await flush();
    expect(await storage.idbGetFileHandle()).toBeNull();
  });

  it("loadProjectJSON preserves an existing handle when no handle is passed", async () => {
    const { handle } = makeMockHandle("keep.luova");
    useAppStore.getState().setFileHandle(handle);
    useAppStore.getState().setFileName("keep.luova");

    const json = await useAppStore.getState().exportJSON();
    useAppStore.getState().loadProjectJSON(json);
    await flush(50);

    // Regression guard: parsing project content must not wipe the handle.
    expect(useAppStore.getState().fileHandle).toBe(handle);
    expect(useAppStore.getState().fileName).toBe("keep.luova");
  });

  it("loadProjectJSON binds a passed handle atomically", async () => {
    const { handle } = makeMockHandle("bound.luova");
    const json = await useAppStore.getState().exportJSON();
    useAppStore.getState().loadProjectJSON(json, {
      handle,
      fileName: "bound.luova",
    });
    await flush(50);

    expect(useAppStore.getState().fileHandle).toBe(handle);
    expect(useAppStore.getState().fileName).toBe("bound.luova");

    const record = await storage.idbGetFileHandle();
    expect(record?.handle).toBe(handle);
    expect(record?.fileName).toBe("bound.luova");
  });

  it("loadProjectJSON with handle:null explicitly detaches (New Project path)", async () => {
    const { handle } = makeMockHandle("old.luova");
    useAppStore.getState().setFileHandle(handle);
    const json = await useAppStore.getState().exportJSON();
    useAppStore.getState().loadProjectJSON(json, { handle: null });
    await flush(50);

    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().fileName).toBeNull();
  });

  it("reset() clears handle, fileName and IndexedDB", async () => {
    const { handle } = makeMockHandle("reset.luova");
    useAppStore.getState().setFileHandle(handle);
    await flush();
    expect(await storage.idbGetFileHandle()).not.toBeNull();

    useAppStore.getState().reset();
    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().fileName).toBeNull();
    await flush();
    expect(await storage.idbGetFileHandle()).toBeNull();
  });
});

describe("project store: per-project system prompt", () => {
  it("exportJSON() serializes the system prompt", async () => {
    useAppStore.getState().setSystemPrompt("Always use Tailwind.");
    useAppStore.getState().setSystemPromptEnabled(true);

    const parsed = JSON.parse(await useAppStore.getState().exportJSON());
    expect(parsed.systemPrompt).toBe("Always use Tailwind.");
    expect(parsed.systemPromptEnabled).toBe(true);
  });

  it("loadProjectJSON() restores the prompt that travelled in the file", async () => {
    useAppStore.getState().setSystemPrompt("saved prompt");
    useAppStore.getState().setSystemPromptEnabled(true);
    const json = await useAppStore.getState().exportJSON();

    // Clobber the active state, then load the saved file back.
    useAppStore.getState().setSystemPrompt("other");
    useAppStore.getState().setSystemPromptEnabled(false);
    useAppStore.getState().loadProjectJSON(json, { handle: null });
    await flush(50);

    expect(useAppStore.getState().systemPrompt).toBe("saved prompt");
    expect(useAppStore.getState().systemPromptEnabled).toBe(true);
  });

  it("loadProjectJSON() clears the prompt for files without one", async () => {
    useAppStore.getState().setSystemPrompt("stale prompt");
    useAppStore.getState().setSystemPromptEnabled(true);

    const withoutPrompt = JSON.stringify({
      nodes: { root: { id: "root", props: {} } },
      rootId: "root",
      layerOrder: [],
    });
    useAppStore.getState().loadProjectJSON(withoutPrompt, { handle: null });
    await flush(50);

    expect(useAppStore.getState().systemPrompt).toBe("");
    expect(useAppStore.getState().systemPromptEnabled).toBe(false);
  });

  it("does not clobber a prompt set while an old project is still loading", async () => {
    // Old project with assets → the deferred node/admin swap lands later.
    const project = JSON.stringify({
      nodes: { root: { id: "root", props: {} } },
      rootId: "root",
      layerOrder: [],
      assets: {},
    });
    useAppStore.getState().loadProjectJSON(project, { handle: null });
    // Simulate the user typing before the deferred block settles.
    useAppStore.getState().setSystemPrompt("typed during load");
    useAppStore.getState().setSystemPromptEnabled(true);
    await flush(50);

    expect(useAppStore.getState().systemPrompt).toBe("typed during load");
    expect(useAppStore.getState().systemPromptEnabled).toBe(true);
  });

  it("reset() clears the system prompt (New Project)", () => {
    useAppStore.getState().setSystemPrompt("clear me");
    useAppStore.getState().setSystemPromptEnabled(true);

    useAppStore.getState().reset();

    expect(useAppStore.getState().systemPrompt).toBe("");
    expect(useAppStore.getState().systemPromptEnabled).toBe(false);
  });

  it("setSystemPrompt/setSystemPromptEnabled mark the project dirty", () => {
    const store = useAppStore.getState();
    store.markSynced();
    expect(useAppStore.getState().hasUnsavedChanges()).toBe(false);

    const before = useAppStore.getState().pendingVersion;
    useAppStore.getState().setSystemPrompt("dirty text");
    expect(useAppStore.getState().pendingVersion).toBeGreaterThan(before);
    expect(useAppStore.getState().hasUnsavedChanges()).toBe(true);

    useAppStore.getState().markSynced();
    expect(useAppStore.getState().hasUnsavedChanges()).toBe(false);

    const beforeToggle = useAppStore.getState().pendingVersion;
    useAppStore.getState().setSystemPromptEnabled(true);
    expect(useAppStore.getState().pendingVersion).toBeGreaterThan(beforeToggle);
    expect(useAppStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it("does not mark dirty when a setter receives the same value", () => {
    useAppStore.getState().setSystemPrompt("same");
    useAppStore.getState().markSynced();

    const before = useAppStore.getState().pendingVersion;
    useAppStore.getState().setSystemPrompt("same");
    useAppStore
      .getState()
      .setSystemPromptEnabled(useAppStore.getState().systemPromptEnabled);
    expect(useAppStore.getState().pendingVersion).toBe(before);
    expect(useAppStore.getState().hasUnsavedChanges()).toBe(false);
  });

  it("importJSON() adopts an incoming prompt when the workspace has none", async () => {
    useAppStore.getState().reset();
    expect(useAppStore.getState().systemPrompt).toBe("");

    const imported = JSON.stringify({
      nodes: {
        root: { id: "root", props: {} },
        c1: { id: "c1", type: "Container", props: { x: 0, y: 0 } },
      },
      rootId: "root",
      layerOrder: ["c1"],
      systemPrompt: "imported prompt",
      systemPromptEnabled: true,
    });
    useAppStore.getState().importJSON(imported);
    await flush(50);

    expect(useAppStore.getState().systemPrompt).toBe("imported prompt");
    expect(useAppStore.getState().systemPromptEnabled).toBe(true);
  });

  describe("notice when an opened file brings its own prompt", () => {
    const projectWithPrompt = (systemPrompt: string) =>
      JSON.stringify({
        nodes: {
          root: { id: "root", props: {} },
          c1: { id: "c1", type: "Container", props: { x: 0, y: 0 } },
        },
        rootId: "root",
        layerOrder: ["c1"],
        systemPrompt,
        systemPromptEnabled: true,
      });

    beforeEach(() => {
      useAppStore.getState().reset();
      toastMock.warning.mockClear();
      toastMock.success.mockClear();
    });

    it("shows a warning after the Opened toast, so it stacks in front", async () => {
      // Same sequence as BuilderLayout's loadProjectFile.
      useAppStore
        .getState()
        .loadProjectJSON(projectWithPrompt("from the file"), { handle: null });
      toastMock.success("Opened project.luova");
      await flush(50);

      expect(toastMock.warning).toHaveBeenCalledTimes(1);
      expect(toastMock.warning.mock.calls[0][0]).toContain("System Prompt");
      expect(toastMock.warning.mock.invocationCallOrder[0]).toBeGreaterThan(
        toastMock.success.mock.invocationCallOrder[0]
      );
    });

    it("stays quiet when the file's prompt is the one already in use", async () => {
      useAppStore.getState().setSystemPrompt("same prompt");
      useAppStore
        .getState()
        .loadProjectJSON(projectWithPrompt("same prompt"), { handle: null });
      await flush(50);

      expect(toastMock.warning).not.toHaveBeenCalled();
    });

    it("shows a warning when an import adopts the file's prompt", async () => {
      useAppStore.getState().importJSON(projectWithPrompt("imported"));
      await flush(50);

      expect(toastMock.warning).toHaveBeenCalledTimes(1);
    });
  });

  it("importJSON() does not overwrite an existing workspace prompt", async () => {
    useAppStore.getState().reset();
    useAppStore.getState().setSystemPrompt("keep me");

    const imported = JSON.stringify({
      nodes: { root: { id: "root", props: {} } },
      rootId: "root",
      layerOrder: [],
      systemPrompt: "should not win",
    });
    useAppStore.getState().importJSON(imported);
    await flush(50);

    expect(useAppStore.getState().systemPrompt).toBe("keep me");
  });
});

describe("project file teardown and handle clearing", () => {
  it("reset() detaches fileHandle/fileName and purges IndexedDB", async () => {
    const { handle } = makeMockHandle("teardown.luova");
    useAppStore.getState().setFileHandle(handle);
    await flush();
    expect(await storage.idbGetFileHandle()).not.toBeNull();

    useAppStore.getState().reset();
    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().fileName).toBeNull();
    expect(useAppStore.getState().isSaving).toBe(false);
    expect(useAppStore.getState().pendingVersion).toBe(1);
    expect(useAppStore.getState().lastSyncedVersion).toBe(
      useAppStore.getState().pendingVersion
    );
    // Regression guard: reset must restore a valid theme (never undefined),
    // since subscribers render on every notified intermediate state.
    expect(useAppStore.getState().themeState).toBeDefined();
    expect((useAppStore.getState() as any).themeState.styles).toBeDefined();
    await flush();
    expect(await storage.idbGetFileHandle()).toBeNull();
  });

  it("reset() never notifies subscribers with an undefined themeState", () => {
    const seen: unknown[] = [];
    const unsub = useAppStore.subscribe((s) =>
      seen.push((s as any).themeState)
    );
    useAppStore.getState().reset();
    unsub();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(undefined);
  });

  it("New Project restores the same Default styles as selecting the preset", () => {
    useAppStore.getState().setThemeState({
      preset: "violet-bloom",
      styles: getPresetThemeStyles("violet-bloom"),
      currentMode: "dark",
    });
    useAppStore.getState().setCurrentMode("dark");
    const expected = getPresetThemeStyles("default");
    const seen: unknown[] = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.themeState.preset === "default") {
        seen.push(state.themeState.styles);
      }
    });

    useAppStore.getState().reset();
    unsubscribe();

    expect(seen.length).toBeGreaterThan(0);
    for (const styles of seen) expect(styles).toEqual(expected);
    expect(useAppStore.getState().currentMode).toBe("light");
    expect(useAppStore.getState().themeState.styles.light.input).toBe(
      "oklch(0.922 0 0 / 0.3)"
    );
    expect(useAppStore.getState().themeState.styles.light["input-shadow"]).toBe(
      "var(--shadow-default)"
    );
  });
});

describe("file-handle-storage: pending write tracking", () => {
  function makeSlowMockHandle() {
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const mocked = makeMockHandle("slow.luova");
    (mocked.writable.close as any).mockImplementationOnce(
      async () => closeGate
    );
    return { ...mocked, releaseClose };
  }

  it("tracks an in-flight write until its writable closes", async () => {
    const { handle, releaseClose } = makeSlowMockHandle();
    expect(storage.hasPendingFileWrites()).toBe(false);

    const writePromise = storage.writeJsonToHandle(handle, '{"a":1}');
    await flush(10);
    expect(storage.hasPendingFileWrites()).toBe(true);

    let drained = false;
    const drain = storage.awaitPendingFileWrites().then(() => (drained = true));
    await flush(10);
    expect(drained).toBe(false);

    releaseClose();
    await writePromise;
    await drain;
    expect(drained).toBe(true);
    expect(storage.hasPendingFileWrites()).toBe(false);
  });

  it("a failed write aborts the writable and releases tracking", async () => {
    const { handle, writable } = makeMockHandle("fail.luova");
    (writable.write as any).mockRejectedValueOnce(new Error("disk full"));
    (writable as any).abort = vi.fn(async () => {});

    await expect(storage.writeJsonToHandle(handle, "x")).rejects.toThrow(
      "disk full"
    );
    expect((writable as any).abort).toHaveBeenCalledTimes(1);
    expect(storage.hasPendingFileWrites()).toBe(false);
    // A subsequent drain resolves immediately (no leaked waiter).
    await storage.awaitPendingFileWrites();
  });
});

describe("project store: stale deferred loads", () => {
  it("a load started before reset() never applies its stale state", async () => {
    const { handle } = makeMockHandle("stale.luova");
    const json = await useAppStore.getState().exportJSON();
    // Start the load but reset before its deferred asset-write chain runs.
    useAppStore.getState().loadProjectJSON(json, {
      handle,
      fileName: "stale.luova",
    });
    useAppStore.getState().reset();
    await flush(100);

    expect(useAppStore.getState().fileHandle).toBeNull();
    expect(useAppStore.getState().fileName).toBeNull();
    expect(Object.keys(useAppStore.getState().nodes)).toEqual(["root"]);
  });
});

describe("z-index mutation and export", () => {
  function seedThreeNodes() {
    useAppStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0, w: 1200, h: 800 },
          code: "",
        },
        a: {
          id: "a",
          type: "Container",
          props: { x: 0, y: 0, w: 100, h: 100 },
          code: "",
        },
        b: {
          id: "b",
          type: "Container",
          props: { x: 10, y: 10, w: 100, h: 100 },
          code: "",
        },
        c: {
          id: "c",
          type: "Container",
          props: { x: 20, y: 20, w: 100, h: 100 },
          code: "",
        },
      } as any,
      layerOrder: ["a", "b", "c"],
      rootId: "root",
    });
  }

  it("exportJSON() includes normalized layerOrder", async () => {
    seedThreeNodes();
    (useAppStore.getState() as any).setNodeZIndex("a", 3);
    const json = await useAppStore.getState().exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.layerOrder).toEqual(["b", "c", "a"]);
  });

  it("loadProjectJSON() preserves custom layerOrder and node zIndex props", async () => {
    seedThreeNodes();
    (useAppStore.getState() as any).setNodeZIndex("a", 3);
    const json = await useAppStore.getState().exportJSON();

    // Scramble live state, then rehydrate from the saved payload.
    useAppStore.setState({ layerOrder: ["a", "b", "c"] } as any);
    useAppStore.getState().loadProjectJSON(json);
    await flush(200);

    const st = useAppStore.getState();
    expect(st.layerOrder).toEqual(["b", "c", "a"]);
    expect((st.nodes.b.props as any).zIndex).toBe(1);
    expect((st.nodes.c.props as any).zIndex).toBe(2);
    expect((st.nodes.a.props as any).zIndex).toBe(3);
  });
});
