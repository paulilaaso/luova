"use client";

/**
 * DynamicRenderer Component
 *
 * Renders user-provided JSX/TSX code dynamically using a native V8 execution pipeline.
 * Uses a Web Worker for transpilation (esbuild-wasm) and new Function() for evaluation,
 * bypassing any main-thread AST parsing.
 *
 * Memory Optimizations:
 * - Streaming debounce: 500ms delay during AI streaming to prevent V8 leak
 * - LRU cache: Predictable eviction of old compiled components
 * - Strict memoization: Only re-compile when transformed code actually changes
 */

import { Sparkles } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/luova-ui/button";
import { customRequire } from "@/config/runtime-scope";
import { useCompilerWorker } from "@/hooks/use-compiler-worker";
import { cn } from "@/lib/luova-utils";
import { useAiStore } from "@/stores/ai-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import {
  componentStyleManager,
  notifyComponentRendered,
} from "@/utils/canvas-style-manager";
import {
  __copyProps,
  __create,
  __defProp,
  __getOwnPropDesc,
  __getOwnPropNames,
  __getProtoOf,
  __hasOwnProp,
  __toESM,
} from "@/utils/esbuild-helpers";
import {
  loadCustomFont,
  loadGoogleFont,
  registerCustomFont,
} from "@/utils/fonts";
import { cyrb53 } from "@/utils/hash";
import { LRUCache } from "@/utils/lru-cache";
import { formatExportErrors, validateExports } from "@/utils/validate-exports";
import { CrashFallback } from "./CrashFallback";
import { LiveErrorBoundary } from "./ErrorBoundary";

const STREAMING_DEBOUNCE_MS = 500;
const MAX_COMPONENT_CACHE = 3;

const componentCache = new LRUCache<
  string,
  React.ElementType<Record<string, unknown>>
>(MAX_COMPONENT_CACHE);

type NativeProps = Record<string, unknown> & {
  value?: unknown;
  defaultValue?: unknown;
  checked?: unknown;
  defaultChecked?: unknown;
};

function sanitizeComponentProps(
  props: Record<string, unknown>
): Record<string, unknown> {
  if (!props || typeof props !== "object") return props;
  const {
    defaultValue: _defaultValue,
    defaultChecked: _defaultChecked,
    "data-ast-index": _astIndex,
    value,
    checked,
    ...rest
  } = props as NativeProps;

  const result: Record<string, unknown> = { ...rest };
  if (value !== undefined) result.value = value;
  if (checked !== undefined) result.checked = checked;

  return result;
}

/**
 * Extracts a structural fingerprint from compiled JS code — tag names,
 * React.createElement call counts, import identifiers, and require statements.
 * Attribute *values* (colors, class strings, style objects) are intentionally
 * excluded so that style-only edits do NOT change the key and therefore do NOT
 * remount the tree. Includes require() calls so import changes trigger remounting.
 */
function getStructuralHash(code: string): string {
  const elementPattern = /React\.createElement\s*\(\s*["']?(\w[\w.-]*)["']?/g;
  const tags: string[] = [];
  let m: RegExpExecArray | null = elementPattern.exec(code);
  while (m !== null) {
    tags.push(m[1]);
    m = elementPattern.exec(code);
  }
  const declPattern = /(?:function|const|let|var)\s+([A-Z]\w*)/g;
  m = declPattern.exec(code);
  while (m !== null) {
    tags.push(m[1]);
    m = declPattern.exec(code);
  }
  // Extract require() calls to ensure import changes trigger remounting
  const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  m = requirePattern.exec(code);
  while (m !== null) {
    tags.push(`require:${m[1]}`);
    m = requirePattern.exec(code);
  }
  return cyrb53(tags.join(","));
}

const staticModuleCache = new LRUCache<string, Record<string, unknown>>(100);

async function getCompiledComponent(
  code: string,
  requireFn: (moduleId: string) => Promise<unknown>
): Promise<React.ElementType<Record<string, unknown>>> {
  const cacheKey = cyrb53(code);

  const cached = componentCache.get(cacheKey);
  if (cached) return cached;

  const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  const needed: string[] = [];
  let m: RegExpExecArray | null = requirePattern.exec(code);
  while (m !== null) {
    if (!staticModuleCache.get(m[1])) needed.push(m[1]);
    m = requirePattern.exec(code);
  }

  if (needed.length > 0) {
    await Promise.all(
      needed.map(async (id) => {
        try {
          const mod = await requireFn(id);
          staticModuleCache.set(id, mod as Record<string, unknown>);
        } catch (err) {
          console.error(`[DynamicRenderer] Failed to load module ${id}:`, err);
          staticModuleCache.set(id, {});
        }
      })
    );
  }

  const syncRequire = (moduleId: string): Record<string, unknown> => {
    const mod = staticModuleCache.get(moduleId) ?? {};

    // Prevent esbuild from double-wrapping ES module namespaces returned by dynamic import().
    // Dynamic import() returns a Module Namespace Object which often lacks __esModule.
    // Module Namespace Objects have non-enumerable properties, so we need special handling.
    if (mod && typeof mod === "object" && !("__esModule" in mod)) {
      const wrapped: Record<string, unknown> = { __esModule: true };

      // Module Namespace Objects have non-enumerable properties
      // We need to copy them explicitly, especially 'default'
      try {
        // Copy all properties from the module namespace
        const allKeys = Reflect.ownKeys(mod);

        for (const key of allKeys) {
          if (typeof key === "string") {
            Object.defineProperty(wrapped, key, {
              get: () => (mod as any)[key],
              enumerable: true,
            });
          }
        }
      } catch (_e) {
        // Fallback: just copy 'default' if it exists
        if ("default" in mod) {
          wrapped.default = (mod as any).default;
        }
      }

      return wrapped;
    }

    return mod;
  };

  const moduleProxy = { exports: {} };
  const exportsProxy = moduleProxy.exports;

  const factory = new Function(
    "require",
    "module",
    "exports",
    "React",
    "__create",
    "__defProp",
    "__getOwnPropDesc",
    "__getOwnPropNames",
    "__getProtoOf",
    "__hasOwnProp",
    "__copyProps",
    "__toESM",
    code
  );
  const Component = factory(
    syncRequire,
    moduleProxy,
    exportsProxy,
    React,
    __create,
    __defProp,
    __getOwnPropDesc,
    __getOwnPropNames,
    __getProtoOf,
    __hasOwnProp,
    __copyProps,
    __toESM
  ) as React.ElementType<Record<string, unknown>>;

  // Nullify the reference to 'code' so the string buffer can be
  // de-allocated from the 'Compiled Code' heap by GC.
  code = "";

  componentCache.set(cacheKey, Component);
  return Component;
}

interface DynamicRendererProps {
  code: string;
  props?: Record<string, unknown>;
  className?: string;
  fillContainer?: boolean;
  alignmentClass?: string;
  showErrors?: boolean;
  onRuntimeError?: (error: string) => void;
  nodeId?: string;
  isStreaming?: boolean;
}

interface NativeRendererProps {
  originalCode: string;
  transformedCode: string;
  css: string;
  requireFn: (moduleId: string) => Promise<unknown>;
  componentProps: Record<string, unknown>;
  fillContainer: boolean;
  alignmentClass?: string;
  nodeId?: string;
}

/**
 * NativeRenderer evaluates the transpiled code string via new Function() and renders
 * the resulting component. Handles async module loading for lazy-loaded components.
 * Keeps the previous component visible while the new one compiles to avoid flashes.
 *
 * Component State Preservation Strategy:
 * - Uses a stable proxy wrapper (StableComponentProxy) to call the compiled component
 *   as a function rather than as a JSX element type. This prevents React from
 *   unmounting/remounting the tree when the component reference changes, thereby
 *   preserving internal component state (e.g., active filters, modal open states) and
 *   preventing mount-phase animations (e.g., framer-motion) from restarting.
 * - When properties are edited in the sidebar and the JSX is recompiled, the new
 *   compiled component function reference is stored in lastComponentRef.current.
 * - The StableComponentProxy calls lastComponentRef.current as a function, so React's
 *   diffing engine reconciles the returned virtual DOM nodes without unmounting the
 *   component tree, effectively patching changed attributes while preserving state.
 */
const NativeRenderer = ({
  originalCode,
  transformedCode,
  css,
  requireFn,
  componentProps,
  fillContainer,
  alignmentClass,
  nodeId,
}: NativeRendererProps) => {
  // Register the globally-sorted Tailwind CSS produced by the worker under a
  // single shared key. The worker compiles all classes seen across every
  // component together, so the resulting stylesheet is fully sorted; storing
  // it under one key (instead of per-node) prevents cross-component cascade
  // poisoning that occurred when independent CSS chunks were concatenated in
  // arbitrary insertion order.
  React.useEffect(() => {
    if (css) {
      componentStyleManager.registerStyle("GLOBAL_TAILWIND", css);
    }
  }, [css]);

  const [DynamicComponent, setDynamicComponent] =
    React.useState<React.ElementType<Record<string, unknown>> | null>(null);
  const [validationError, setValidationError] = React.useState<Error | null>(
    null
  );
  // Trigger to force the stable wrapper to pick up the new component ref
  const [, setComponentUpdateTrigger] = React.useState(0);
  // Keep the last successfully rendered component visible during transitions
  const lastComponentRef = React.useRef<React.ElementType<
    Record<string, unknown>
  > | null>(null);
  const lastCodeRef = React.useRef<string>("");

  React.useEffect(() => {
    if (transformedCode === lastCodeRef.current) return;
    lastCodeRef.current = transformedCode;
    setValidationError(null);

    // Validate exported symbols against the original TSX source (not the
    // transpiled CommonJS output, which uses require() and would fool the
    // import-based regex into finding zero imports).
    const { isValid, errors: exportErrors } = validateExports(originalCode);
    if (!isValid && exportErrors.length > 0) {
      const errorMsg = formatExportErrors(exportErrors);
      const error = new Error(`[EXPORT_VALIDATION]\n${errorMsg}`);
      setDynamicComponent(null);
      setValidationError(error);
      console.error("Export validation failed:", errorMsg);
      return;
    }

    getCompiledComponent(transformedCode, requireFn)
      .then((Component) => {
        lastComponentRef.current = Component;
        setDynamicComponent(() => Component);
        // Trigger the stable wrapper to pick up the new component
        setComponentUpdateTrigger((prev) => prev + 1);
        // Notify after the state update has been scheduled; the actual paint
        // happens one rAF later, which CapturedElementPanel accounts for.
        if (nodeId) {
          requestAnimationFrame(() => {
            notifyComponentRendered(nodeId);
          });
        }
      })
      .catch((err) => {
        console.error("Failed to compile component:", err);
        setDynamicComponent(null);
      });
  }, [transformedCode, requireFn, nodeId, originalCode]);

  const sanitizedComponentProps = useMemo(() => {
    const props = { ...sanitizeComponentProps(componentProps) };
    if (fillContainer) {
      props.className = cn(
        "w-full h-full",
        typeof props.className === "string" ? props.className : ""
      );
    }
    return props;
  }, [componentProps, fillContainer]);

  /**
   * Stable Component Proxy Wrapper
   *
   * This wrapper maintains a stable React element type across recompilations.
   * Instead of rendering ComponentToRender directly as a JSX element (which would change
   * the element type and cause React to unmount/remount the tree), we:
   *
   * 1. Store the latest compiled component function in a mutable ref
   * 2. Call it as a function directly within the stable wrapper's render pass
   * 3. This preserves the fiber tree structure, maintaining internal state and preventing animations from restarting
   *
   * Must be created unconditionally (before any early returns) to maintain hook order.
   */
  const StableComponentProxy = useMemo(() => {
    return (props: Record<string, unknown>) => {
      const currentComponent = lastComponentRef.current;

      // Directly invoke the component function instead of using it as a JSX element type
      if (currentComponent && typeof currentComponent === "function") {
        try {
          return (
            currentComponent as React.FunctionComponent<Record<string, unknown>>
          )(props);
        } catch (error) {
          console.error(
            "[StableComponentProxy] Error calling component function:",
            error
          );
          return React.createElement(currentComponent as any, props);
        }
      }

      return currentComponent
        ? React.createElement(currentComponent as any, props)
        : null;
    };
  }, []);

  // Use the last known component while the new one compiles — no blank flash
  const ComponentToRender = DynamicComponent ?? lastComponentRef.current;

  if (validationError) {
    throw validationError;
  }

  if (!ComponentToRender) {
    return (
      <div
        className={cn(
          "codex-live-preview",
          "w-full h-full relative",
          alignmentClass && "flex",
          alignmentClass
        )}
        style={{ height: "100%", width: "100%" }}
      >
        <div className="w-full h-full" />
      </div>
    );
  }

  return (
    <div
      data-node-id={nodeId}
      className={cn(
        "codex-live-preview",
        "w-full h-full relative",
        alignmentClass && "flex",
        alignmentClass
      )}
      style={{ height: "100%", width: "100%" }}
    >
      {ComponentToRender === React.Fragment ? (
        (sanitizedComponentProps as any).children
      ) : (
        <StableComponentProxy {...sanitizedComponentProps} />
      )}
    </div>
  );
};

export default function DynamicRenderer({
  code,
  props = {},
  className,
  fillContainer = true,
  alignmentClass,
  showErrors = true,
  onRuntimeError,
  nodeId,
  isStreaming = false,
}: DynamicRendererProps) {
  const previewMode = useUIStore((state) => state.previewMode);
  const [debouncedCode, setDebouncedCode] = useState<string>("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTransformedRef = useRef<string>("");
  // Keep the last good transformed code so we never flash a blank while recompiling
  const lastGoodTransformedRef = useRef<string>("");
  const lastGoodCssRef = useRef<string>("");
  const lastGoodOriginalRef = useRef<string>("");
  const triggerAiFix = useAiStore((state) => state.triggerAiFix);

  useEffect(() => {
    if (isStreaming) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedCode(code);
      }, STREAMING_DEBOUNCE_MS);
    } else {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setDebouncedCode(code);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [code, isStreaming]);

  // Automatically load any Google Fonts and custom fonts found in the code
  const themeState = useThemeStore((state) => state.themeState);
  const customFonts = themeState.styles.light.customFonts || [];

  useEffect(() => {
    if (!code) return;

    // Match font-[Font_Name] (handling both quoted and unquoted formats)
    const fontMatches = code.matchAll(/font-\[([^\]]+)\]/g);
    for (const match of fontMatches) {
      const fontFamily = match[1].replace(/_/g, " ").replace(/['"]/g, "");

      // Skip theme tokens
      if (
        ["sans", "serif", "mono", "heading"].includes(fontFamily.toLowerCase())
      )
        continue;

      // Check if this is a custom font
      const customFont = customFonts.find(
        (f: { family: string }) => f.family === fontFamily
      );
      if (customFont) {
        // Register and load custom font
        registerCustomFont(fontFamily);
        loadCustomFont([customFont]);
      } else {
        // Fallback to Google Fonts
        loadGoogleFont(fontFamily, { allWeights: true });
      }
    }
  }, [code, customFonts]);

  const codeToCompile = isStreaming ? debouncedCode : code;

  const {
    code: transformedCode,
    css,
    error: transformError,
    isCompiling: _isCompiling,
  } = useCompilerWorker(codeToCompile, props, nodeId);

  // Track the last rendered code; persist last good result to avoid blank flashes.
  useEffect(() => {
    lastTransformedRef.current = transformedCode;
    if (transformedCode) {
      lastGoodTransformedRef.current = transformedCode;
      lastGoodCssRef.current = css;
      lastGoodOriginalRef.current = codeToCompile;
    }
  }, [transformedCode, css, codeToCompile]);

  // While recompiling, fall back to the last good code so the canvas stays visible
  const codeToRender = transformedCode || lastGoodTransformedRef.current;
  const cssToRender = transformedCode ? css : lastGoodCssRef.current;
  const originalToRender = transformedCode
    ? codeToCompile
    : lastGoodOriginalRef.current;
  const shouldRender = !!codeToRender;

  // Only show compile errors when there's no previous good render to fall back to
  // This check MUST happen BEFORE the !shouldRender check so errors are visible on first render
  if (transformError && showErrors && !lastGoodTransformedRef.current) {
    return (
      <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 flex flex-col gap-3">
        <p className="text-sm font-medium text-destructive">
          Compilation Error
        </p>
        <pre className="text-xs text-destructive/80 overflow-auto whitespace-pre-wrap max-h-[200px]">
          {transformError}
        </pre>
        {nodeId && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit border-destructive/30 text-destructive hover:bg-destructive/20"
            onClick={() => triggerAiFix(nodeId, transformError, code)}
          >
            <Sparkles className="h-3.5 w-3.5 mr-2" />
            Fix with AI
          </Button>
        )}
      </div>
    );
  }

  if (!shouldRender) {
    return (
      <div className={className}>
        <div className="w-full h-24" />
      </div>
    );
  }

  return (
    <LiveErrorBoundary
      key={`${getStructuralHash(codeToRender)}-preview-${previewMode}`}
      resetOnChange={codeToRender}
      onError={(err) => onRuntimeError?.(err.message)}
      fallback={
        showErrors
          ? (err) => (
              <CrashFallback code={code} error={err.message} nodeId={nodeId} />
            )
          : undefined
      }
    >
      <div className={className}>
        <NativeRenderer
          originalCode={originalToRender}
          transformedCode={codeToRender}
          css={cssToRender}
          requireFn={customRequire}
          componentProps={props}
          fillContainer={fillContainer}
          alignmentClass={alignmentClass}
          nodeId={nodeId}
        />
      </div>
    </LiveErrorBoundary>
  );
}
