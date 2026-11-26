import JSZip from "jszip";
import { TAILWIND_RUNTIME_CONTEXT_CSS } from "@/config/tailwind-runtime-context";
import { idbGetAsset } from "@/lib/asset-idb";
import type { ProjectStore } from "@/stores/project-store";
import { normalizeLayerOrder } from "@/stores/slices/canvas-hierarchy-slice";
import type { ThemeSlice } from "@/stores/types";
import type { ColorFormat } from "@/types";
import type { ContentAlignment } from "@/types/builder";
import { ASSET_FONT_ID_REGEX, ASSET_ID_REGEX } from "@/utils/asset-manager";
import { ALIGNMENT_CLASSES } from "@/utils/content-alignment";
import packageJson from "../package.json";
import { generateThemeCode } from "./generate-theme-css";

// --- Internal Ejected Assets ---

async function getLocalComponentSource(
  moduleId: string
): Promise<string | null> {
  const response = await fetch(
    `/api/local-component-source?moduleId=${encodeURIComponent(moduleId)}`
  );
  if (!response.ok) return null;

  const data = (await response.json()) as { source?: string | null };
  return data.source ?? null;
}

async function getThemeTokensCss(): Promise<string | null> {
  try {
    const response = await fetch("/theme-tokens-compiled.css");
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

/**
 * Converts Luova-specific theme style variables into standard CSS/React style properties
 * for clean, human-readable exports.
 */
function cleanProprietaryInlineStyles(code: string): string {
  let cleaned = code;

  // Rename proprietary --luova-* variables to clean design-system variables
  cleaned = cleaned.replace(/--luova-bg-light/g, "--theme-bg-light");
  cleaned = cleaned.replace(/--luova-bg-dark/g, "--theme-bg-dark");
  cleaned = cleaned.replace(/--luova-shadow-light/g, "--theme-shadow-light");
  cleaned = cleaned.replace(/--luova-shadow-dark/g, "--theme-shadow-dark");
  cleaned = cleaned.replace(/--luova-border-light/g, "--theme-border-light");
  cleaned = cleaned.replace(/--luova-border-dark/g, "--theme-border-dark");
  cleaned = cleaned.replace(/--luova-border-width/g, "--theme-border-width");

  // Rename utility classes to standard, semantic class names
  cleaned = cleaned.replace(/luova-bg-themed/g, "theme-bg-gradient");
  cleaned = cleaned.replace(/luova-shadow-themed/g, "theme-shadow");
  cleaned = cleaned.replace(/luova-border-themed/g, "theme-border-gradient");

  // Remove any remaining empty style properties, e.g., style={{}}
  cleaned = cleaned.replace(/style=\{\{\s*\}\}/g, "");

  return cleaned;
}

export async function exportProjectToZip(
  projectState: ProjectStore,
  themeState: ThemeSlice,
  options: {
    colorFormat: ColorFormat;
    tailwindVersion: "3" | "4";
    selectedNodeIds?: string[];
  }
): Promise<Blob> {
  const zip = new JSZip();
  const dataZip = zip.folder("luova-data")!;

  let canvasNodes = Object.values(projectState.nodes).filter(
    (n) =>
      n.kind !== "wireframe" &&
      n.kind !== "captured" &&
      n.id !== projectState.rootId
  );

  // Filter to selected nodes if provided
  if (options.selectedNodeIds && options.selectedNodeIds.length > 0) {
    const selectedSet = new Set(options.selectedNodeIds);
    canvasNodes = canvasNodes.filter((n) => selectedSet.has(n.id));
  }

  // 2. Process Assets — fetch only blobs referenced by the current canvas
  const assetMap: Record<string, string> = {};
  const publicAssets = dataZip.folder("public/assets");
  const publicFonts = dataZip.folder("public/fonts");

  // Collect all asset IDs referenced in node source code
  const referencedAssetIds = new Set<string>();
  for (const node of canvasNodes) {
    if (node.code) {
      for (const m of node.code.matchAll(
        new RegExp(ASSET_ID_REGEX.source, "g")
      )) {
        referencedAssetIds.add(m[0]);
      }
      for (const m of node.code.matchAll(
        new RegExp(ASSET_FONT_ID_REGEX.source, "g")
      )) {
        referencedAssetIds.add(m[0]);
      }
    }
  }
  // Also include custom fonts registered in the theme (from both light and dark variants)
  const lightFonts = themeState.themeState.styles.light.customFonts ?? [];
  const darkFonts = themeState.themeState.styles.dark.customFonts ?? [];
  const customFontIds = new Set<string>();
  const customFonts: any[] = [];
  for (const font of [...lightFonts, ...darkFonts]) {
    if (font.assetId && !customFontIds.has(font.assetId)) {
      customFontIds.add(font.assetId);
      customFonts.push(font);
      referencedAssetIds.add(font.assetId);
    }
  }

  // Fetch only the referenced blobs from IndexedDB
  const idbAssets: Record<string, string> = {};
  await Promise.all(
    Array.from(referencedAssetIds).map(async (id) => {
      const blob = await idbGetAsset(id);
      if (blob) idbAssets[id] = blob;
    })
  );

  // Map each referenced asset ID → original filename (from AssetMeta or node props)
  // so exports use human-readable names like `company-logo.png` instead of hashes.
  const assetOriginalNames: Record<string, string | undefined> = {};
  for (const shortId of referencedAssetIds) {
    const metaName = (projectState.assets as Record<string, { name?: string }>)[
      shortId
    ]?.name;
    if (metaName) {
      assetOriginalNames[shortId] = metaName;
      continue;
    }
    // Fall back to the first canvas node whose code references this asset
    const owner = canvasNodes.find(
      (n) => n.code?.includes(shortId) && typeof n.props.fileName === "string"
    );
    assetOriginalNames[shortId] =
      (owner?.props.fileName as string | undefined) ?? undefined;
  }

  const usedAssetFileNames = new Set<string>();
  const resolveReadableAssetName = (
    shortId: string,
    fallbackExt: string
  ): string => {
    const original = assetOriginalNames[shortId];
    const fallbackBase = shortId.replace("asset:", "");
    let base: string;
    let ext: string;
    if (original) {
      const clean = original.split("/").pop()?.split("\\").pop() ?? original;
      const dot = clean.lastIndexOf(".");
      if (dot > 0) {
        base = clean.slice(0, dot);
        ext = clean.slice(dot + 1).toLowerCase() || fallbackExt;
      } else {
        base = clean;
        ext = fallbackExt;
      }
    } else {
      base = fallbackBase;
      ext = fallbackExt;
    }
    // Web-safe slug: keep alphanumerics, dash, underscore; collapse the rest
    let slug =
      base
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || fallbackBase;
    if (slug.length > 60) slug = slug.slice(0, 60).replace(/-$/, "");
    let candidate = `${slug}.${ext}`;
    let counter = 2;
    while (usedAssetFileNames.has(candidate)) {
      candidate = `${slug}-${counter}.${ext}`;
      counter++;
    }
    usedAssetFileNames.add(candidate);
    return candidate;
  };

  for (const [shortId, base64] of Object.entries(idbAssets)) {
    const imageMatch = base64.match(/^data:(image\/[\w+-]+);base64,(.+)$/);
    if (imageMatch) {
      const data = imageMatch[2];
      const mimeExt = imageMatch[1].split("/")[1] || "png";
      // Normalize svg+xml → svg, jpeg → jpg-friendly handling (keep jpeg as jpg? keep original)
      const ext =
        mimeExt === "svg+xml" ? "svg" : mimeExt === "jpeg" ? "jpg" : mimeExt;
      const fileName = resolveReadableAssetName(shortId, ext);
      const binaryString = atob(data);
      const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
      publicAssets?.file(fileName, bytes);
      assetMap[shortId] = `/assets/${fileName}`;
      continue;
    }

    const fontMatch = base64.match(
      /^data:(font\/\w+|application\/\w+);base64,(.+)$/
    );
    if (fontMatch) {
      // Only export fonts that are registered in the current theme's customFonts
      if (!customFontIds.has(shortId)) {
        continue; // Skip fonts not in the theme
      }

      const data = fontMatch[2];
      const mimeType = fontMatch[1];
      let ext: string;
      if (mimeType.includes("woff2")) {
        ext = "woff2";
      } else if (mimeType.includes("woff")) {
        ext = "woff";
      } else if (mimeType.includes("ttf")) {
        ext = "ttf";
      } else if (mimeType.includes("otf")) {
        ext = "otf";
      } else {
        ext = "woff2";
      }
      const fileName = `${shortId.replace("asset:", "")}.${ext}`;
      const binaryString = atob(data);
      const bytes = Uint8Array.from(binaryString, (c) => c.charCodeAt(0));
      publicFonts?.file(fileName, bytes);
      assetMap[shortId] = `/fonts/${fileName}`;
    }
  }

  // 3. Write User-Generated Components (Deduplicated)
  const componentRegistry: Record<string, string> = {};
  const nodeToFileMap: Record<string, string> = {};
  const detectedDependencies = new Set<string>();
  const exportedSourceFiles: string[] = [];

  canvasNodes.forEach((node) => {
    let code = node.code;

    // Clean up AST indices and proprietary visual editor style definitions
    code = code.replace(/data-ast-index="[^"]*"/g, "");
    code = cleanProprietaryInlineStyles(code);

    for (const [shortId, path] of Object.entries(assetMap)) {
      code = code.split(shortId).join(path);
    }

    // Force "use client" for canvas components to resolve useState errors
    if (
      !code.trim().startsWith('"use client"') &&
      !code.trim().startsWith("'use client'")
    ) {
      code = `"use client";\n\n${code}`;
    }

    // Dynamic import scanning: parse code to collect dependencies actually imported
    for (const dep of collectImportSpecifiers(code)) {
      detectedDependencies.add(dep);
    }

    const codeHash = code.trim();
    if (componentRegistry[codeHash]) {
      nodeToFileMap[node.id] = componentRegistry[codeHash];
    } else {
      const nameMatch = code.match(/export default function\s+(\w+)/);
      const baseName = nameMatch ? nameMatch[1] : node.type || "Component";
      let fileName = `${baseName}.tsx`;
      let counter = 1;
      while (Object.values(componentRegistry).includes(fileName)) {
        fileName = `${baseName}${++counter}.tsx`;
      }
      componentRegistry[codeHash] = fileName;
      nodeToFileMap[node.id] = fileName;
      dataZip.file(`components/custom/${fileName}`, code);
      exportedSourceFiles.push(code);
    }
  });

  // ── Recursively Bundle Local Dependencies ────────────────────────────────
  // Scan imports of canvas components AND their local dependencies recursively,
  // so all @/ imports (e.g. @/lib/utils) and npm packages are captured.
  const bundledLocalFiles = new Set<string>();
  const resolveQueue = Array.from(detectedDependencies).filter((d) =>
    d.startsWith("@/")
  );

  while (resolveQueue.length > 0) {
    const dep = resolveQueue.shift()!;
    if (bundledLocalFiles.has(dep)) continue;
    bundledLocalFiles.add(dep);

    try {
      const sourceCode = await getLocalComponentSource(dep);
      if (!sourceCode) continue;

      // Write the local file to the ZIP
      const zipPath = dep.replace("@/", "");
      const hasExtension = zipPath.endsWith(".tsx") || zipPath.endsWith(".ts");
      dataZip.file(hasExtension ? zipPath : `${zipPath}.tsx`, sourceCode);
      exportedSourceFiles.push(sourceCode);

      // Scan its imports for further dependencies
      for (const subDep of collectImportSpecifiers(sourceCode)) {
        if (subDep.startsWith("@/")) {
          if (!bundledLocalFiles.has(subDep)) {
            resolveQueue.push(subDep);
          }
        } else {
          detectedDependencies.add(subDep);
        }
      }
    } catch (err) {
      console.warn(`[export] Failed to bundle local dependency ${dep}:`, err);
    }
  }

  // 4. Generate page.tsx using CSS Grid projection
  const imports: string[] = [];
  const normalizedLayerOrder = normalizeLayerOrder(
    projectState.layerOrder,
    projectState.nodes,
    projectState.rootId
  );

  // Grab all canvas nodes and sort by layerOrder to include Container types
  const orderedNodes = canvasNodes
    .filter((n) => nodeToFileMap[n.id])
    .sort((a, b) => {
      const idxA = normalizedLayerOrder.indexOf(a.id);
      const idxB = normalizedLayerOrder.indexOf(b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return 0;
    });

  // Generate imports
  orderedNodes.forEach((node) => {
    const fileName = nodeToFileMap[node.id];
    if (!fileName) return;
    const compName = fileName.replace(".tsx", "");
    if (!imports.includes(compName)) {
      imports.push(
        `import ${compName} from "@/components/custom/${compName}";`
      );
    }
  });

  // Generate CSS Grid layout
  const { colTracks, rowTracks, usages } = generateGridLayout(
    orderedNodes,
    nodeToFileMap
  );

  dataZip.file(
    "app/page.tsx",
    `
import React from "react";
${imports.join("\n")}

export default function Page() {
  return (
    <div className="min-h-screen bg-background w-full">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '${colTracks}',
          gridTemplateRows: '${rowTracks}',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
${usages.join("\n")}
      </div>
    </div>
  );
}
`.trim()
  );

  // 5. Generate Global CSS
  const arbitraryFonts: string[] = [];
  for (const node of canvasNodes) {
    if (node.code) {
      arbitraryFonts.push(...extractArbitraryFontsFromCode(node.code));
    }
  }
  const uniqueArbitraryFonts = [...new Set(arbitraryFonts)];
  const globalsCSS = generateSimpleProjectCss(
    themeState,
    options.tailwindVersion,
    uniqueArbitraryFonts,
    exportedSourceFiles
  );

  dataZip.file("app/styles/globals.css", globalsCSS);

  // The builder loads component-level theme rules (card/button/input shadows,
  // borders, radii, ...) from a separate stylesheet; ship it so the exported
  // app renders the same.
  const themeTokensCss = await getThemeTokensCss();
  if (themeTokensCss) {
    dataZip.file("app/styles/theme-tokens.css", themeTokensCss);
  }
  dataZip.file(
    "app/layout.tsx",
    generateLayoutCode(themeState.currentMode, {
      themeTokensCss: Boolean(themeTokensCss),
    })
  );
  dataZip.file(
    "AGENT_INSTRUCTIONS.md",
    generateAgentInstructions(canvasNodes, nodeToFileMap)
  );

  // 6. Generate Setup Script — Pass the dynamically scanned dependencies to the generator
  zip.file("setup.js", generateSetupScript(Array.from(detectedDependencies)));

  return await zip.generateAsync({ type: "blob" });
}

// --- Layout Generation Functions ---

/**
 * Resolves effective width/height for a node, accounting for "auto" values.
 * Falls back to component schema defaults or conservative estimates.
 */
function resolveNodeDimension(
  value: number | string | undefined,
  isHeight: boolean
): number {
  if (typeof value === "number") return value;
  // Fallback to reasonable defaults based on common UI component sizes
  // (buttons ~40px, inputs ~44px, containers ~200-300px)
  return isHeight ? 100 : 200;
}

interface CanvasFrameMetrics {
  w: number;
  h: number;
  autoW: boolean;
  autoH: boolean;
  /** clip-path matching the canvas frame clip, when the canvas clips. */
  clipPath?: string;
}

/**
 * Reads a node's frame as the canvas renders it. Auto-sized frames are
 * `max-content` on the canvas, so their stored w/h can be stale; fixed frames
 * clip their content, extended by the measured shadow bleed.
 */
function measureCanvasFrame(n: any): CanvasFrameMetrics {
  const autoW = n.props.widthMode === "auto";
  const autoH = n.props.heightMode === "auto";
  const frame =
    typeof document !== "undefined"
      ? (document.querySelector(
          `.canvas-frame[data-node-id="${n.id}"]`
        ) as HTMLElement | null)
      : null;
  const measuredW = frame?.offsetWidth || undefined;
  const measuredH = frame?.offsetHeight || undefined;
  const w =
    autoW || typeof n.props.w !== "number"
      ? (measuredW ?? resolveNodeDimension(n.props.w, false))
      : n.props.w;
  const h =
    autoH || typeof n.props.h !== "number"
      ? (measuredH ?? resolveNodeDimension(n.props.h, true))
      : n.props.h;

  let clipPath: string | undefined;
  if (!autoW && !autoH) {
    const content = frame?.querySelector(
      ":scope > .canvas-frame-content"
    ) as HTMLElement | null;
    const bleed = (side: string) =>
      Number.parseFloat(
        content?.style.getPropertyValue(`--shadow-bleed-${side}`) || "0"
      ) || 0;
    const sides = ["top", "right", "bottom", "left"].map(
      (side) => `${-bleed(side)}px`
    );
    clipPath = `inset(${sides.join(" ")})`;
  }

  return { w, h, autoW, autoH, clipPath };
}

/**
 * Generates a CSS Grid layout from absolute positioning coordinates.
 * - Normalizes origin to 0,0 to remove artificial canvas padding
 * - Intelligently assigns 1fr to the main content column to create fluidity
 */
function generateGridLayout(
  nodes: any[],
  fileMap: Record<string, string>
): { colTracks: string; rowTracks: string; usages: string[] } {
  // 1. Find the top-left origin to normalize the padding away
  let minX = Infinity;
  let minY = Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.props.x || 0);
    minY = Math.min(minY, n.props.y || 0);
  });
  if (minX === Infinity) minX = 0;
  if (minY === Infinity) minY = 0;

  const xSet = new Set<number>();
  const ySet = new Set<number>();

  // 2. Gather normalized boundaries
  const metrics = new Map(nodes.map((n) => [n.id, measureCanvasFrame(n)]));

  nodes.forEach((n) => {
    const { w, h } = metrics.get(n.id)!;

    const adjX = (n.props.x || 0) - minX;
    const adjY = (n.props.y || 0) - minY;

    xSet.add(adjX);
    xSet.add(adjX + w);
    ySet.add(adjY);
    ySet.add(adjY + h);
  });

  const xEdges = Array.from(xSet).sort((a, b) => a - b);
  const yEdges = Array.from(ySet).sort((a, b) => a - b);

  // 3. Generate Grid Tracks with Fluid Heuristic
  const colWidths = xEdges.slice(0, -1).map((x, i) => xEdges[i + 1] - x);
  const maxColWidth = Math.max(...colWidths);

  const colTracks = colWidths
    .map((w) =>
      // Make the widest structural column fluid to absorb remaining screen space
      // Use minmax(0, 1fr) instead of 1fr to prevent scrollbars when content is large
      w === maxColWidth && w > 300 ? "minmax(0, 1fr)" : `${w}px`
    )
    .join(" ");

  const rowTracks = yEdges
    .slice(0, -1)
    .map((y, i) => `${yEdges[i + 1] - y}px`)
    .join(" ");

  // 4. Map Nodes to Grid Areas
  const usages = nodes.map((n) => {
    const { w, h, autoW, autoH, clipPath } = metrics.get(n.id)!;

    // Normalize coordinates here as well
    const adjX = (n.props.x || 0) - minX;
    const adjY = (n.props.y || 0) - minY;

    const colStart = xEdges.indexOf(adjX) + 1;
    const colEnd = xEdges.indexOf(adjX + w) + 1;
    const rowStart = yEdges.indexOf(adjY) + 1;
    const rowEnd = yEdges.indexOf(adjY + h) + 1;

    const compName = fileMap[n.id].replace(".tsx", "");
    // Mirror the canvas frame: a positioned, isolated box that clips like the
    // canvas does, sizes auto axes to content, and applies content alignment.
    const style: Record<string, string> = {
      gridColumn: `${colStart} / ${colEnd}`,
      gridRow: `${rowStart} / ${rowEnd}`,
      isolation: "isolate",
    };
    if (autoW) style.width = "max-content";
    if (autoH) style.height = "max-content";
    if (clipPath) style.clipPath = clipPath;
    const alignment = n.props.alignment as ContentAlignment | undefined;
    const className = alignment
      ? `relative flex ${ALIGNMENT_CLASSES[alignment]}`
      : "relative";
    const styleLiteral = Object.entries(style)
      .map(([key, value]) => `${key}: '${value}'`)
      .join(", ");
    return `      <div className="${className}" style={{ ${styleLiteral} }}>
        <${compName} />
      </div>`;
  });

  return { colTracks, rowTracks, usages };
}

// --- Helper Functions ---

// --- CSS Generation ---

function extractArbitraryFontsFromCode(code: string): string[] {
  const fontMatches = code.matchAll(/font-\[([^\]]+)\]/g);
  const fonts = new Set<string>();
  for (const match of fontMatches) {
    let fontName = match[1].trim();
    fontName = fontName.replace(/['"]/g, "").replace(/_/g, " ");
    if (fontName && !fontName.includes("var(") && !fontName.startsWith("--")) {
      fonts.add(fontName);
    }
  }
  return Array.from(fonts);
}

/**
 * The canvas compiles components with Luova's data-* variants (which also
 * match Radix `data-state` attributes) and the `no-scrollbar` utility; ship the
 * same definitions so those classes behave identically in the export.
 */
const CANVAS_VARIANTS_AND_UTILITIES = (() => {
  const css = TAILWIND_RUNTIME_CONTEXT_CSS;
  const start = css.indexOf("/* Custom variants */");
  const end = css.indexOf("@utility shadow-2xs");
  return start !== -1 && end > start ? css.slice(start, end).trim() : "";
})();

export function generateSimpleProjectCss(
  themeState: ThemeSlice,
  tailwindVersion: "3" | "4",
  extraGoogleFonts: string[] = [],
  exportedSourceFiles: string[] = []
): string {
  const themeCSS = generateThemeCode(
    themeState.themeState,
    "oklch",
    tailwindVersion,
    { isExport: true, extraGoogleFonts }
  );

  // Utility classes for mode-aware gradients, shadows, and borders applied via the
  // captured-element editor. These mirror the @utility blocks in globals.css.
  const globalLineHeight =
    themeState.themeState.styles.light["global-line-height"] || "1";

  const luovaUtilities = `
/* ─── Design System: default text color & borders ────────────────────────── */
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    color: var(--color-foreground);
    /* Match the canvas: unclassed text follows the theme's font scale and
       global line height (Tailwind's preflight default is 1.5), and missing
       font weights are not faux-bolded. */
    font-size: calc(1rem * var(--font-scale, 1));
    line-height: var(--global-line-height, ${globalLineHeight});
    font-synthesis-weight: none;
    text-rendering: optimizeLegibility;
  }
}

/* ─── Design System: mode-aware gradient, shadow & border utilities ──────── */
@layer utilities {
  .theme-bg-gradient {
    background-image: var(--theme-bg-light) !important;
    background-origin: border-box !important;
    background-clip: border-box !important;
    background-repeat: no-repeat !important;
  }
  .dark .theme-bg-gradient {
    background-image: var(--theme-bg-dark) !important;
    background-origin: border-box !important;
    background-clip: border-box !important;
    background-repeat: no-repeat !important;
  }
  .theme-shadow {
    box-shadow: var(--theme-shadow-light) !important;
  }
  .dark .theme-shadow {
    box-shadow: var(--theme-shadow-dark) !important;
  }
  .theme-border-gradient {
    position: relative;
    border-color: transparent !important;
  }
  .theme-border-gradient::after {
    content: "";
    position: absolute;
    inset: calc(var(--theme-border-width, 0px) * -1);
    border-radius: inherit;
    border: var(--theme-border-width, 0px) solid transparent;
    background-image: var(--theme-border-light);
    background-origin: border-box;
    background-clip: border-box;
    background-size: 100% 100%;
    background-repeat: no-repeat;
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
  }
  .dark .theme-border-gradient::after {
    background-image: var(--theme-border-dark);
  }
  @supports (corner-shape: squircle) {
    * {
      corner-shape: superellipse(calc(1 + var(--smoothing, 0) / 100));
    }
  }
}

/* ─── Shadows ───────────────────────────────────────────────────────────── */
@utility shadow-2xs { box-shadow: var(--shadow-2xs, var(--shadow-default)); }
@utility shadow-xs { box-shadow: var(--shadow-xs, var(--shadow-default)); }
@utility shadow-sm { box-shadow: var(--shadow-sm, var(--shadow-default)); }
@utility shadow { box-shadow: var(--shadow-default); }
@utility shadow-md { box-shadow: var(--shadow-md, var(--shadow-default)); }
@utility shadow-lg { box-shadow: var(--shadow-lg, var(--shadow-default)); }
@utility shadow-xl { box-shadow: var(--shadow-xl, var(--shadow-default)); }
@utility shadow-2xl { box-shadow: var(--shadow-2xl, var(--shadow-default)); }
@utility shadow-inner { box-shadow: var(--shadow-inset, inset 0 2px 4px 0 rgb(0 0 0 / 0.05)); }
@utility shadow-none { box-shadow: 0 0 #0000; }

@utility border {
  border-width: var(--border-width, 1px) !important;
  border-style: solid;
}
@utility border-t {
  border-top-width: var(--border-width, 1px) !important;
  border-top-style: solid;
}
@utility border-b {
  border-bottom-width: var(--border-width, 1px) !important;
  border-bottom-style: solid;
}
@utility border-l {
  border-left-width: var(--border-width, 1px) !important;
  border-left-style: solid;
}
@utility border-r {
  border-right-width: var(--border-width, 1px) !important;
  border-right-style: solid;
}
@utility border-x {
  border-left-width: var(--border-width, 1px) !important;
  border-left-style: solid;
  border-right-width: var(--border-width, 1px) !important;
  border-right-style: solid;
}
@utility border-y {
  border-top-width: var(--border-width, 1px) !important;
  border-top-style: solid;
  border-bottom-width: var(--border-width, 1px) !important;
  border-bottom-style: solid;
}`.trim();

  // Extract @import lines from themeCSS and hoist them above @import "tailwindcss"
  // CSS spec requires @import rules to precede all other rules.
  const importLines: string[] = [];
  const themeCSSWithoutImports = themeCSS
    .split("\n")
    .filter((line) => {
      if (line.trim().startsWith("@import ")) {
        importLines.push(line);
        return false;
      }
      return true;
    })
    .join("\n");

  const hoistedImports =
    importLines.length > 0 ? `${importLines.join("\n")}\n` : "";
  const customVariants =
    tailwindVersion === "4"
      ? `
@custom-variant dark (&:is(.dark, .dark *));
@custom-variant light (:root:not(.dark) &);

${CANVAS_VARIANTS_AND_UTILITIES}
`.trim()
      : "";
  const colorAlphaOverrides =
    tailwindVersion === "4"
      ? generatePaletteAlphaUtilityOverrides(exportedSourceFiles)
      : "";

  // The canvas compiles component utilities unlayered (see the compiler
  // worker), so they beat the theme-tokens `builder-overrides` layer — e.g.
  // `font-serif` on an h1 wins over its heading font. Mirror that here:
  // theme and preflight stay layered, utilities are imported unlayered.
  const tailwindImport =
    tailwindVersion === "4"
      ? `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css";`
      : `@import "tailwindcss";`;

  return `${hoistedImports}${tailwindImport}\n\n${customVariants}\n\n${themeCSSWithoutImports}\n\n${luovaUtilities}\n\n${colorAlphaOverrides}\n`;
}

const COLOR_ALPHA_UTILITY_PROPS: Record<string, string> = {
  bg: "background-color",
  border: "border-color",
  text: "color",
};

function extractTailwindPalette(): Map<string, string> {
  const palette = new Map<string, string>();
  const tokenPattern = /--color-([a-z]+-\d{2,3}):\s*(oklch\([^)]+\));/g;

  for (const match of TAILWIND_RUNTIME_CONTEXT_CSS.matchAll(tokenPattern)) {
    palette.set(match[1], match[2]);
  }

  return palette;
}

function escapeClassName(className: string): string {
  return className.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function colorWithAlpha(color: string, opacity: string): string | null {
  const alpha = Number.parseInt(opacity, 10) / 100;
  if (!Number.isFinite(alpha)) return null;

  return color.replace(/\)$/, ` / ${alpha})`);
}

function extractClassNames(source: string): string[] {
  const classes = new Set<string>();
  const classValuePattern = /["'`]([^"'`]*\b(?:bg|border|text)-[^"'`]+)["'`]/g;

  for (const match of source.matchAll(classValuePattern)) {
    for (const className of match[1].split(/\s+/)) {
      if (className.includes("/")) {
        classes.add(className);
      }
    }
  }

  return Array.from(classes);
}

export function generatePaletteAlphaUtilityOverrides(
  exportedSourceFiles: string[]
): string {
  const palette = extractTailwindPalette();
  const rules: string[] = [];
  const seen = new Set<string>();
  const classPattern =
    /^(?:(dark|light):)?(bg|border|text)-([a-z]+-\d{2,3})\/(\d{1,3})$/;

  for (const source of exportedSourceFiles) {
    for (const className of extractClassNames(source)) {
      const match = className.match(classPattern);
      if (!match || seen.has(className)) continue;

      const [, variant, prefix, colorKey, opacity] = match;
      const color = palette.get(colorKey);
      const alphaColor = color ? colorWithAlpha(color, opacity) : null;
      if (!alphaColor) continue;

      seen.add(className);
      const prop = COLOR_ALPHA_UTILITY_PROPS[prefix];
      const escaped = escapeClassName(className);

      if (variant === "dark") {
        rules.push(
          `.dark .${escaped}, .dark.${escaped} { ${prop}: ${alphaColor}; }`
        );
      } else if (variant === "light") {
        rules.push(`:root:not(.dark) .${escaped} { ${prop}: ${alphaColor}; }`);
      } else {
        rules.push(`.${escaped} { ${prop}: ${alphaColor}; }`);
      }
    }
  }

  if (rules.length === 0) return "";

  return `
/* Export color parity: use direct alpha colors for palette opacity utilities. */
@layer utilities {
${rules.map((rule) => `  ${rule}`).join("\n")}
}
`.trim();
}

/**
 * Packages that are always required in the exported project regardless of
 * the runtime scope configuration. These are utilities used by the ejected
 * component wrappers and globals.css, not by AI-generated components directly.
 */
const ALWAYS_REQUIRED_DEPS = ["tw-animate-css", "clsx", "tailwind-merge"];

/**
 * Packages that Next.js / React provide out of the box and must NOT be
 * re-installed by setup.js (they'd conflict or are already bundled).
 */
const SKIP_IN_EXPORT = new Set(["react", "react-dom"]);

const PACKAGE_VERSIONS: Record<string, string> = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

/** The exported app is scaffolded with the Next.js version Luova runs on. */
const NEXT_VERSION = PACKAGE_VERSIONS.next.replace(/^[\^~]/, "");

/**
 * Module specifiers from real import / re-export statements only. The
 * import clause may hold only identifiers, braces, commas and `*`, so
 * ordinary text such as `<p>Straight from "the team"</p>` never matches.
 */
const IMPORT_STATEMENT_REGEX =
  /^\s*(?:import\s+(?:type\s+)?(?:[\w$*{},\s]+?\s+from\s+)?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[\w$,\s]*\})\s+from\s+)["']([^"']+)["']/gm;

export function collectImportSpecifiers(code: string): string[] {
  return [...code.matchAll(IMPORT_STATEMENT_REGEX)].map((match) => match[1]);
}

const NPM_PACKAGE_NAME =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** "@scope/pkg/sub/path" → "@scope/pkg", "pkg/sub" → "pkg"; null for local paths. */
function packageNameOf(specifier: string): string | null {
  if (/^(?:\.|@\/|node:)/.test(specifier)) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  return NPM_PACKAGE_NAME.test(name) ? name : null;
}

export function generateSetupScript(
  usedDeps: string[],
  exportedAt: Date = new Date()
): string {
  // Merge the detected dependencies with the core requirements (clsx,
  // tailwind-merge, etc.). Only packages Luova itself ships are installed,
  // pinned to the versions the canvas ran with — a name from a component's
  // code never reaches `npm install` otherwise.
  const deps = new Set(ALWAYS_REQUIRED_DEPS);
  for (const specifier of usedDeps) {
    const name = packageNameOf(specifier);
    if (!name || SKIP_IN_EXPORT.has(name)) continue;
    if (!PACKAGE_VERSIONS[name]) {
      console.warn(`[export] Skipping unknown dependency "${specifier}"`);
      continue;
    }
    deps.add(name);
  }

  const installArgs = Array.from(deps)
    .map((pkg) => `"${pkg}@${PACKAGE_VERSIONS[pkg]}"`)
    .join(" ");

  return `
const { execSync } = require('child_process');
const fs = require('fs');

function log(msg) { console.log(\`\\x1b[32m🚀 \${msg}\\x1b[0m\`); }

// Install only package versions that already existed when this project was
// exported, so a package version published (or hijacked) later can never be
// pulled in. Exact versions are saved; package-lock.json pins the rest.
const npmEnv = {
  ...process.env,
  npm_config_before: '${exportedAt.toISOString()}',
  npm_config_save_exact: 'true',
};

try {
  log("Initializing Next.js project...");
  execSync('npx --yes create-next-app@${NEXT_VERSION} luova-app --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --disable-git --yes', { stdio: 'inherit', env: npmEnv });

  log("Integrating Luova UI Components & Theme...");
  process.chdir('luova-app');

  // Clean up existing Next.js boilerplate using native fs methods
  ['app', 'components', 'lib'].forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  log("Injecting components and theme...");
  // Copy directories from luova-data if they exist
  ['app', 'components', 'lib', 'hooks', 'public'].forEach(folder => {
    const srcPath = \`../luova-data/\${folder}\`;
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, folder, { recursive: true, force: true });
    }
  });

  // Copy AGENT_INSTRUCTIONS.md from luova-data root if it exists
  if (fs.existsSync('../luova-data/AGENT_INSTRUCTIONS.md')) {
    fs.cpSync('../luova-data/AGENT_INSTRUCTIONS.md', './AGENT_INSTRUCTIONS.md', { force: true });
  }

  // Ensure fonts and assets directories exist in public
  if (!fs.existsSync('public/fonts')) {
    fs.mkdirSync('public/fonts', { recursive: true });
  }
  if (!fs.existsSync('public/assets')) {
    fs.mkdirSync('public/assets', { recursive: true });
  }

  log("Installing Dependencies...");
  execSync('npm install ${installArgs}', { stdio: 'inherit', env: npmEnv });

  // Pin package.json to exactly what was installed (create-next-app writes
  // ranges like "^4"), and keep future additions exact too.
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  ['dependencies', 'devDependencies'].forEach(field => {
    Object.keys(pkg[field] || {}).forEach(name => {
      const locked = lock.packages && lock.packages['node_modules/' + name];
      if (locked && locked.version) pkg[field][name] = locked.version;
    });
  });
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  fs.writeFileSync('.npmrc', 'save-exact=true\\n');

  log("✅ Setup complete!");
  console.log("\\ncd luova-app && npm run dev");
} catch (e) {
  console.error("❌ Setup failed:", e.message);
  process.exit(1);
}
`.trim();
}

/**
 * The exported app has no theme toggle, so it opens in whichever mode the
 * builder was showing at export time. Dark mode is driven by the `.dark`
 * class (see the `@custom-variant dark` rule in globals.css); `color-scheme`
 * makes native UI such as scrollbars and form controls match.
 */
export function generateLayoutCode(
  mode: "light" | "dark" = "light",
  { themeTokensCss = false }: { themeTokensCss?: boolean } = {}
): string {
  const htmlAttrs =
    mode === "dark" ? ` className="dark" style={{ colorScheme: "dark" }}` : "";
  // Imported after globals.css so its `builder-overrides` layer is declared
  // after Tailwind's layers and wins over utilities, as in the builder.
  const themeTokensImport = themeTokensCss
    ? `\nimport "./styles/theme-tokens.css";`
    : "";
  return `
import type { Metadata } from "next";
import "./styles/globals.css";${themeTokensImport}

export const metadata: Metadata = {
  title: "Luova Export",
  description: "Generated by Luova Builder",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en"${htmlAttrs} suppressHydrationWarning>
      <body className="style-nova antialiased font-sans font-normal">
        {children}
      </body>
    </html>
  );
}
`.trim();
}

function generateAgentInstructions(
  nodes: any[],
  fileMap: Record<string, string>
): string {
  const layoutTable = nodes
    .map(
      (n) =>
        `| ${fileMap[n.id].replace(".tsx", "")} | ${n.id.slice(0, 8)} | ${n.props.x} | ${n.props.y} | ${n.props.w} | ${n.props.h} |`
    )
    .join("\n");

  return `
# 🎨 AI AGENT INSTRUCTIONS: Reconstruction Guide

This folder contains a professional Next.js 16+ project export from Luova. Your goal is to reconstruct the 2D canvas layout into a functional web page with 1:1 visual fidelity.

## 📐 Layout Overview

Your layout has been **automatically projected into CSS Grid** for native responsiveness and semantic HTML. The exported \`app/page.tsx\` uses:

- **CSS Grid Layout** — Canvas coordinates are converted into grid column/row tracks
- **Grid Cell Positioning** — Each component is mapped to its grid area using gridColumn and gridRow
- **Responsive by Default** — Grid adapts naturally to different screen sizes

### Technical Details

The builder extracted unique X and Y boundaries from your canvas coordinates to create optimal grid tracks. For example:

\`\`\`tsx
// Canvas coordinates are converted to grid:
<div style={{
  display: 'grid',
  gridTemplateColumns: '100px 200px 150px',  // Extracted from unique X boundaries
  gridTemplateRows: '50px 100px 75px',       // Extracted from unique Y boundaries
}}>
  <div style={{ gridColumn: '2 / 3', gridRow: '2 / 3' }}>
    <Component />
  </div>
</div>
\`\`\`

### Component Coordinate Map (for reference)
| Component | ID | X | Y | W | H |
| :--- | :--- | :--- | :--- | :--- | :--- |
${layoutTable}

### Implementation Tips:
- **Styling Fidelity**: The components in \`components/ui\` are already themed to match the builder canvas. They consume the CSS variables defined in \`app/styles/globals.css\`.
- **Primitive Extensions**: If the canvas used a customized variant not found in \`components/ui\`, you can extend the primitives using the standard Tailwind/CVA patterns.
- **Grid Responsiveness**: The CSS Grid layout automatically scales on different viewport sizes. Test at mobile, tablet, and desktop to verify fidelity.

## 📋 Further Refinement
Refactor the CSS Grid into semantic Flexbox containers with responsive Tailwind classes:

1. **Analyze** the grid structure in \`app/page.tsx\` to understand visual groupings
2. **Identify** natural container boundaries (rows, columns, groups of components)
3. **Refactor** into semantic \`<section>\`, \`<div>\` wrappers with Tailwind \`flex\`, \`gap-*\`, \`md:\` breakpoints
4. **Test** at multiple screen sizes to ensure the layout remains visually accurate

This produces the most maintainable, production-grade code.
`.trim();
}
