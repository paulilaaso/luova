"use client";

/**
 * Hook to compile code using a Web Worker.
 *
 * Offloads transpilation to a background thread to keep
 * the main thread responsive during code editing.
 *
 * AI-generated code uses raw HTML + Tailwind — no registry
 * virtual file resolution needed.
 */

import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/project-store";
import { ASSET_ID_REGEX, resolveAssetToBlobUrl } from "@/utils/asset-manager";
import { LRUCache } from "@/utils/lru-cache";

interface CompilerResult {
  code: string;
  css: string;
  error: string | null;
  isCompiling: boolean;
  props: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (result: {
    code: string;
    css: string;
    error: string | null;
    props: Record<string, unknown>;
  }) => void;
}

const EMPTY_CODE_RESULT: CompilerResult = {
  code: "",
  css: "",
  error: "No code provided",
  isCompiling: false,
  props: {},
};

let workerInstance: Worker | null = null;
const pendingRequests: Map<string, PendingRequest> = new Map();
let requestId = 0;

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null;

  if (!workerInstance) {
    workerInstance = new Worker(
      new URL("../workers/compiler.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerInstance.onmessage = (event) => {
      const { id, code, css, error, props } = event.data;
      const pending = pendingRequests.get(id);
      if (pending) {
        pending.resolve({ code, css: css ?? "", error, props: props ?? {} });
        pendingRequests.delete(id);
      }
    };

    workerInstance.onerror = (error) => {
      console.error("Compiler worker error:", error);
    };
  }

  return workerInstance;
}

const COMPILER_TIMEOUT_MS = 10_000;
const MAX_CACHE_SIZE = 20;

/**
 * Resolves all asset:image-* IDs in code to browser Blob URLs.
 * Fetches base64 data from IndexedDB via the asset manager.
 */
async function resolveAssets(code: string): Promise<string> {
  const matches = Array.from(new Set(code.match(ASSET_ID_REGEX) ?? []));
  if (matches.length === 0) return code;

  let resolved = code;

  await Promise.all(
    matches.map(async (assetId) => {
      try {
        const blobUrl = await resolveAssetToBlobUrl(assetId);
        resolved = resolved.replaceAll(assetId, blobUrl);
      } catch {
        // Asset not found in IDB — leave the ID as-is
      }
    })
  );

  return resolved;
}

async function compileAsync(
  code: string,
  props: Record<string, unknown>,
  nodeId?: string
): Promise<{
  code: string;
  css: string;
  error: string | null;
  props: Record<string, unknown>;
}> {
  const worker = getWorker();

  if (!worker) {
    return Promise.resolve({
      code: "",
      css: "",
      error: "Worker not available",
      props: {},
    });
  }

  const resolvedCode = await resolveAssets(code);

  return new Promise((resolve) => {
    jobQueue.push({ worker, code: resolvedCode, props, nodeId, resolve });
    pumpQueue();
  });
}

interface CompileJob {
  worker: Worker;
  code: string;
  props: Record<string, unknown>;
  nodeId?: string;
  resolve: PendingRequest["resolve"];
}

// The worker compiles one request at a time, so jobs are sent one by one and
// each timeout covers only that job's own compile. Timing from enqueue would
// fail the tail of a large scene that is merely waiting its turn.
const jobQueue: CompileJob[] = [];
let jobRunning = false;

function pumpQueue(): void {
  if (jobRunning) return;
  const job = jobQueue.shift();
  if (!job) return;
  jobRunning = true;

  const id = `compile-${++requestId}`;
  let settled = false;
  const finish = (res: Parameters<PendingRequest["resolve"]>[0]) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    pendingRequests.delete(id);
    job.resolve(res);
    jobRunning = false;
    pumpQueue();
  };
  const timeoutId = setTimeout(
    () =>
      finish({
        code: "",
        css: "",
        error: "Compilation timed out.",
        props: {},
      }),
    COMPILER_TIMEOUT_MS
  );
  pendingRequests.set(id, { resolve: finish });

  // Read active nodes at send time so the worker prunes against the current canvas.
  job.worker.postMessage({
    id,
    code: job.code,
    props: job.props,
    nodeId: job.nodeId,
    activeNodeIds: Object.keys(useProjectStore.getState().nodes),
  });
}

export async function validateCodeWithCompilerWorker(
  code: string,
  props: Record<string, unknown> = {},
  nodeId?: string
): Promise<{
  isValid: boolean;
  error: string | null;
  transformedCode: string;
}> {
  const normalizedCode = code.trim();
  if (!normalizedCode) {
    return { isValid: false, error: "No code provided", transformedCode: "" };
  }
  const result = await compileAsync(normalizedCode, props, nodeId);
  return {
    isValid: !result.error && !!result.code,
    error: result.error,
    transformedCode: result.code,
  };
}

const codeCache = new LRUCache<
  number,
  { code: string; css: string; error: string | null }
>(MAX_CACHE_SIZE);

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function useCompilerWorker(
  code: string,
  props: Record<string, unknown> = {},
  nodeId?: string
): CompilerResult {
  const normalizedCode = code.trim();
  const hasCode = normalizedCode.length > 0;

  const [result, setResult] = useState<CompilerResult>({
    code: "",
    css: "",
    error: null,
    isCompiling: true,
    props: {},
  });

  const latestRequestRef = useRef(0);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    if (!hasCode) return;

    const currentRequest = ++latestRequestRef.current;
    queueMicrotask(() => {
      setResult((prev) => ({ ...prev, isCompiling: true }));
    });

    compileAsync(normalizedCode, propsRef.current, nodeId).then(
      (compileResult) => {
        if (currentRequest !== latestRequestRef.current) return;
        if (!compileResult.error && compileResult.code) {
          const cacheKey = hashString(normalizedCode);
          codeCache.set(cacheKey, {
            code: compileResult.code,
            css: compileResult.css,
            error: compileResult.error,
          });
        }
        setResult({ ...compileResult, isCompiling: false });
      }
    );
  }, [hasCode, normalizedCode, nodeId]);

  if (!hasCode) return EMPTY_CODE_RESULT;
  return result;
}

export function useCodeValidationAsync(
  code: string,
  props: Record<string, unknown> = {},
  nodeId?: string
) {
  const {
    code: transformedCode,
    error,
    isCompiling,
  } = useCompilerWorker(code, props, nodeId);
  return {
    isValid: !error && !!transformedCode,
    error,
    transformedCode,
    isValidating: isCompiling,
  };
}
