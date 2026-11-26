/**
 * Compiler Web Worker
 *
 * Offloads transpilation to a background thread to prevent
 * main thread blocking during code transformation.
 *
 * Uses esbuild-wasm for high-performance transpilation and
 * runtime Tailwind v4 utility generation.
 *
 * AI-generated code uses raw HTML + Tailwind — no registry
 * virtual file bundling needed.
 */

import * as esbuild from "esbuild-wasm";
import * as ts from "typescript";
import { TAILWIND_RUNTIME_CONTEXT_CSS } from "../config/tailwind-runtime-context";
import { injectAstIndices } from "../utils/ast-indexer";
import { sanitizeInvalidJsxNesting } from "../utils/jsx-sanitize";
import { formatImportErrors, normalizeImports } from "../utils/parse-imports";
import { preprocessSandboxSource } from "../utils/sandbox-preprocessor";
import { postProcess } from "../utils/transform-engine";

export interface CompilerRequest {
  id: string;
  code: string;
  props: Record<string, unknown>;
  /** The node ID of the component being compiled. Used to update the registry. */
  nodeId?: string;
  /** All currently active node IDs on the canvas. Used to prune deleted nodes. */
  activeNodeIds?: string[];
}

export interface CompilerResponse {
  id: string;
  code: string;
  css: string;
  error: string | null;
  props: Record<string, unknown>;
}

let esbuildPromise: Promise<void> | null = null;
type TailwindCompile = typeof import("tailwindcss").compile;
let tailwindCompilePromise: Promise<TailwindCompile> | null = null;

const SIMPLE_UTILITY_CANDIDATES = new Set([
  "absolute",
  "block",
  "container",
  "contents",
  "fixed",
  "flex",
  "grid",
  "hidden",
  "inline",
  "inline-block",
  "inline-flex",
  "relative",
  "sr-only",
  "sticky",
  "table",
]);

async function ensureEsbuild() {
  if (esbuildPromise) return esbuildPromise;
  esbuildPromise = (async () => {
    try {
      const wasmURL = new URL("/esbuild.wasm", self.location.origin).href;
      await esbuild.initialize({ wasmURL, worker: false });
    } catch (error) {
      if (error instanceof Error && error.message.includes("initialize"))
        return;
      esbuildPromise = null;
      throw error;
    }
  })();
  return esbuildPromise;
}

async function ensureTailwindCompile() {
  if (tailwindCompilePromise) return tailwindCompilePromise;
  tailwindCompilePromise = import("tailwindcss")
    .then((tailwind) => tailwind.compile)
    .catch((error) => {
      tailwindCompilePromise = null;
      throw error;
    });
  return tailwindCompilePromise;
}

function extractTailwindCandidates(source: string): string[] {
  if (!source) return [];
  if (!/class(Name|Names)/.test(source) && !/cn\(|twMerge\(/.test(source))
    return [];
  const candidates = new Set<string>();

  const sourceFile = ts.createSourceFile(
    "temp.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  function addTokens(text: string) {
    for (const token of text.split(/\s+/)) {
      const candidate = token.trim();
      // Increased limit from 180 to 500 to accommodate lengthy gradient utility classes
      // e.g., light:bg-[linear-gradient(to_right,_rgb(255,_0,_0),_rgb(0,_0,_255))]
      if (!candidate || candidate.length > 500) continue;
      if (
        candidate.startsWith("@/") ||
        candidate.startsWith("./") ||
        candidate.startsWith("../")
      )
        continue;
      if (candidate.includes("://")) continue;
      if (/\.(tsx?|jsx?|css|json|md)$/i.test(candidate)) continue;
      if (!/[a-z]/i.test(candidate)) continue;
      const hasUtilitySyntax = /[-:[\]!/]/.test(candidate);
      if (!hasUtilitySyntax && !SIMPLE_UTILITY_CANDIDATES.has(candidate))
        continue;
      candidates.add(candidate);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      addTokens(node.text);
    } else if (ts.isTemplateExpression(node)) {
      addTokens(node.head.text);
      for (const span of node.templateSpans) addTokens(span.literal.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return Array.from(candidates).sort();
}

// Registry mapping nodeId → that component's Tailwind candidates, extracted
// once when it compiles. Deleted nodes are pruned so their classes drop out of
// the next CSS build.
const componentCandidateRegistry = new Map<string, string[]>();

// Tailwind's compiler accumulates every candidate it has built and returns CSS
// for all of them, so one instance is reused while candidates are only added,
// and replaced when a removed component leaves classes nothing uses anymore.
let tailwindCompiler: { build(candidates: string[]): string } | null = null;
let builtCandidates = new Set<string>();

async function generateRuntimeCss(): Promise<string> {
  if (componentCandidateRegistry.size === 0) return "";

  // Collect all Tailwind candidates from every active component in one pass.
  // This preserves Tailwind's deterministic class ordering and prevents
  // "Specificity Wars" between independently-compiled CSS chunks.
  const activeCandidates = new Set<string>();
  for (const candidates of componentCandidateRegistry.values()) {
    for (const candidate of candidates) activeCandidates.add(candidate);
  }

  if (activeCandidates.size === 0) return "";

  let hasStale = false;
  for (const candidate of builtCandidates) {
    if (!activeCandidates.has(candidate)) {
      hasStale = true;
      break;
    }
  }
  if (!tailwindCompiler || hasStale) {
    const compile = await ensureTailwindCompile();
    tailwindCompiler = await compile(TAILWIND_RUNTIME_CONTEXT_CSS);
    builtCandidates = new Set();
  }

  let css = tailwindCompiler.build(Array.from(activeCandidates));
  builtCandidates = activeCandidates;
  css = css.replace(/(?::root|\.dark)\s*\{[^}]*\}/g, "");

  return css;
}

async function prepareForLiveProvider(
  code: string,
  props: Record<string, unknown>,
  nodeId?: string,
  activeNodeIds?: string[]
): Promise<{
  code: string;
  css: string;
  error: string | null;
  props: Record<string, unknown>;
}> {
  try {
    if (!code || code.trim() === "") {
      return { code: "", css: "", error: "No code provided", props: {} };
    }

    const preprocessedCode = preprocessSandboxSource(code);

    // Validate imports against runtime manifest BEFORE transpilation
    const { normalizedCode, errors: importErrors } =
      normalizeImports(preprocessedCode);
    if (importErrors.length > 0) {
      const errorMsg = formatImportErrors(importErrors);
      return { code: "", css: "", error: errorMsg, props: {} };
    }

    await ensureEsbuild();

    const needsReact = (src: string) =>
      !src.includes('from "react"') &&
      !src.includes("from 'react'") &&
      !src.includes("import React");

    const sanitizedCode = sanitizeInvalidJsxNesting(normalizedCode);
    const indexedCode = injectAstIndices(sanitizedCode);
    const src = needsReact(indexedCode)
      ? `import * as React from "react";\n${indexedCode}`
      : indexedCode;

    const result = await esbuild.transform(src, {
      loader: "tsx",
      format: "cjs",
      target: "es2020",
      jsx: "transform",
      jsxDev: true,
      minify: true,
      sourcemap: false,
      sourcesContent: false,
      legalComments: "none",
    });
    const { code: transformedCode } = postProcess(result.code);

    // --- Registry sync (Tasks 2 & 3) ---
    // Update the registry entry for this node.
    if (nodeId) {
      componentCandidateRegistry.set(
        nodeId,
        extractTailwindCandidates(transformedCode)
      );
    }
    // Prune entries for nodes that are no longer on the canvas.
    if (activeNodeIds && activeNodeIds.length > 0) {
      const activeSet = new Set(activeNodeIds);
      for (const key of componentCandidateRegistry.keys()) {
        if (!activeSet.has(key)) {
          componentCandidateRegistry.delete(key);
        }
      }
    }

    let css = "";
    if (transformedCode.length <= 500_000) {
      try {
        css = await generateRuntimeCss();
      } catch (tailwindError) {
        console.error("Runtime Tailwind compilation failed:", tailwindError);
      }
    }

    return { code: transformedCode, css, error: null, props };
  } catch (error) {
    return {
      code: "",
      css: "",
      error: error instanceof Error ? error.message : String(error),
      props: {},
    };
  }
}

self.onmessage = async (event: MessageEvent<CompilerRequest>) => {
  const { id, code, props, nodeId, activeNodeIds } = event.data;
  const result = await prepareForLiveProvider(
    code,
    props,
    nodeId,
    activeNodeIds
  );

  const response: CompilerResponse = {
    id,
    code: result.code,
    css: result.css,
    error: result.error,
    props: result.props ?? {},
  };

  self.postMessage(response);
};
