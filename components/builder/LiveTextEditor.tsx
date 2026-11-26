"use client";

import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, defineExtension } from "lexical";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/luova-utils";
import { getLiveCameraState, useCanvasStore } from "@/stores/canvas-store";
import { useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { extractJsxClassNamesByAstIndex } from "@/utils/ast-modifier-v2";
import { notifyComponentRendered } from "@/utils/canvas-style-manager";
import {
  loadCustomFont,
  loadGoogleFont,
  registerCustomFont,
} from "@/utils/fonts";
import { extractInnerJsx, wrapInnerJsx } from "@/utils/html-to-jsx";
import {
  typographyExportMap,
  typographyImportMap,
} from "@/utils/lexical-typography";
import { richTextHtmlToJsx, richTextJsxToEditorDom } from "@/utils/rich-text";
import { getFontFamilyFromClasses } from "@/utils/tailwind-mapping";
import { typographyRootStyle } from "@/utils/text-typography";
import { TextTypographyBridge } from "./TextTypographyBridge";

interface LiveTextEditorProps {
  nodeId: string;
  code: string;
  style?: React.CSSProperties;
  className?: string;
}

const editorNodes = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode];

/**
 * Rich text editor overlaid on the canvas when a text node is double-clicked.
 *
 * Backed by Lexical (a real document model) rather than a bare
 * `contentEditable`. Text is captured into `latestHtmlRef` on every change, so
 * committing works even when React has already detached the editor DOM node
 * during unmount — the previous implementation read a null ref at that point
 * and silently dropped the edit.
 */
export default function LiveTextEditor({
  nodeId,
  code,
  style,
  className,
}: LiveTextEditorProps) {
  const currentMode = useThemeStore((s) => s.currentMode);
  const themeState = useThemeStore((s) => s.themeState);
  const initialCodeRef = useRef(code);
  const initialInnerJsx = useMemo(
    () => extractInnerJsx(initialCodeRef.current),
    []
  );

  // Latest serialized HTML from the editor. Updated on every content change.
  const latestHtmlRef = useRef<string>("");
  // Normalized HTML of the untouched initial content; used to skip no-op
  // commits so simply opening/closing the editor doesn't churn history.
  const baselineHtmlRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const html = latestHtmlRef.current;
    if (html === baselineHtmlRef.current) return;

    const jsx = richTextHtmlToJsx(html);
    // Always wrap into the latest code so class edits committed from the
    // properties panel during editing are preserved.
    const latestCode = useProjectStore.getState().nodes[nodeId]?.code ?? code;
    useProjectStore
      .getState()
      .updateComponentCode(nodeId, wrapInnerJsx(latestCode, jsx));
    baselineHtmlRef.current = html;
  }, [nodeId, code]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const flushRef = useRef<() => void>(() => commitRef.current());

  const scheduleCommit = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => flushRef.current(), 350);
  }, []);

  // Flush on unmount as well as after idle edits. A quick deselect must not
  // depend on a delayed onChange callback or a pending save timer.
  useEffect(() => {
    const flush = () => flushRef.current();
    // The project store flushes its debounced localStorage write on unload.
    // Capture first so its flush sees the most recent editor content.
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush, true);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", flush, true);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flush();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = useUIStore.subscribe((state) => {
      if (
        state.editingTextNodeId === nodeId &&
        !state.selectedIds.includes(nodeId)
      ) {
        flushRef.current();
        state.clearEditingTextNodeId();
      }
    });
    return unsubscribe;
  }, [nodeId]);

  useEffect(() => {
    const families = new Set([
      getFontFamilyFromClasses(extractJsxClassNamesByAstIndex(code, 0)),
    ]);
    const dom = richTextJsxToEditorDom(extractInnerJsx(code));
    for (const element of dom.querySelectorAll<HTMLElement>("[style]")) {
      const family = element.style.fontFamily.replace(/^["']|["']$/g, "");
      if (family && !family.startsWith("var(")) families.add(family);
    }
    for (const family of families) {
      const custom = themeState.styles[currentMode].customFonts?.find(
        (font) => font.family === family
      );
      if (custom) {
        registerCustomFont(family);
        loadCustomFont([custom]);
      } else if (!["sans", "serif", "mono", "heading"].includes(family))
        loadGoogleFont(family, { allWeights: true });
    }
  }, [code, themeState, currentMode]);

  // Starts empty; `EditorBridge` seeds the content from the node's JSX.
  const editorExtension = useMemo(
    () =>
      defineExtension({
        name: "[root]",
        namespace: "luova-text-editor",
        nodes: editorNodes,
        html: { import: typographyImportMap(), export: typographyExportMap() },
        theme: {},
        onError: (error: Error) => {
          console.error("[LiveTextEditor] Lexical error:", error);
        },
      }),
    []
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: signal each committed root-code repaint
  useEffect(() => {
    const frame = requestAnimationFrame(() => notifyComponentRendered(nodeId));
    return () => cancelAnimationFrame(frame);
  }, [code, nodeId]);

  const classes = extractJsxClassNamesByAstIndex(code, 0);
  const rootClasses = classes.join(" ");

  const mergedStyle: React.CSSProperties = useMemo(
    () => ({
      ...style,
      ...typographyRootStyle(rootClasses.split(/\s+/), currentMode),
      userSelect: "text",
      WebkitUserSelect: "text",
    }),
    [style, rootClasses, currentMode]
  );

  const handleCommitAndExit = () => {
    flushRef.current();
    useUIStore.getState().clearEditingTextNodeId();
  };

  return (
    <div data-component-id={nodeId} className="contents">
      <LexicalExtensionComposer
        extension={editorExtension}
        // RichTextPlugin below renders the ContentEditable.
        contentEditable={null}
        key={nodeId}
      >
        <EditorBridge
          initialJsx={initialInnerJsx}
          latestHtmlRef={latestHtmlRef}
          baselineHtmlRef={baselineHtmlRef}
          commitRef={commitRef}
          flushRef={flushRef}
          scheduleCommit={scheduleCommit}
        />
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              data-ast-index="0"
              className={cn(
                "luova-text-editor outline-none cursor-text block w-full h-full",
                rootClasses,
                className
              )}
              style={mergedStyle}
              aria-label="Text content"
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={() => flushRef.current()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  handleCommitAndExit();
                }
                // Prevent global canvas shortcuts from firing while typing.
                e.stopPropagation();
                e.nativeEvent.stopPropagation();
              }}
              onKeyUp={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopPropagation();
              }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <TextTypographyBridge
          nodeId={nodeId}
          flush={() => flushRef.current()}
        />
      </LexicalExtensionComposer>
    </div>
  );
}

/**
 * Seeds the Lexical document from the node's existing inner JSX, selects all
 * text so typing replaces the placeholder, and records the normalized baseline
 * HTML used to detect real edits.
 */
function EditorBridge({
  initialJsx,
  latestHtmlRef,
  baselineHtmlRef,
  commitRef,
  flushRef,
  scheduleCommit,
}: {
  initialJsx: string;
  latestHtmlRef: { current: string };
  baselineHtmlRef: { current: string };
  commitRef: { current: () => void };
  flushRef: { current: () => void };
  scheduleCommit: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  // Seed the document once per editor instance. `initialJsx` and the refs are
  // intentionally excluded: re-seeding on prop changes would wipe edits.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once on mount
  useEffect(() => {
    const dom = richTextJsxToEditorDom(initialJsx ?? "");

    editor.update(
      () => {
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        root.append(...nodes);
        root.select(0, root.getChildrenSize());

        // Capture the normalized HTML of the untouched content in the same
        // commit, so a no-op open/close never rewrites the node.
        const html = $generateHtmlFromNodes(editor, null);
        baselineHtmlRef.current = html;
        latestHtmlRef.current = html;
      },
      { discrete: true }
    );

    // Read directly from the editor's committed state when saving. Lexical can
    // batch updates after the control that triggered a deselect has run.
    flushRef.current = () => {
      latestHtmlRef.current = editor.read(() =>
        $generateHtmlFromNodes(editor, null)
      );
      commitRef.current();
    };

    editor.focus();

    // Keep the caret visible as the user types long/multi-line text, so the
    // canvas camera follows the writing instead of leaving it off-screen.
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        latestHtmlRef.current = $generateHtmlFromNodes(editor, null);
      });
      if (latestHtmlRef.current !== baselineHtmlRef.current) scheduleCommit();
      keepCaretInView();
    });

    return () => {
      unregister();
    };
  }, [editor]);

  return null;
}

const CARET_MARGIN = 64;

/**
 * Nudge the canvas camera so the current text caret stays inside the viewport.
 * Mirrors the same pan math the camera hook consumes through the store.
 */
function keepCaretInView(): void {
  if (typeof document === "undefined") return;

  const container = document.querySelector<HTMLElement>(
    '[data-canvas-container="true"]'
  );
  if (!container) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const caret = selection.getRangeAt(0).getBoundingClientRect();
  if (!caret.width && !caret.height) return;

  const view = container.getBoundingClientRect();
  let dx = 0;
  let dy = 0;

  if (caret.bottom > view.bottom - CARET_MARGIN) {
    dy = view.bottom - CARET_MARGIN - caret.bottom;
  } else if (caret.top < view.top + CARET_MARGIN) {
    dy = view.top + CARET_MARGIN - caret.top;
  }

  if (caret.right > view.right - CARET_MARGIN) {
    dx = view.right - CARET_MARGIN - caret.right;
  } else if (caret.left < view.left + CARET_MARGIN) {
    dx = view.left + CARET_MARGIN - caret.left;
  }

  if (dx === 0 && dy === 0) return;

  const { panX, panY, zoom } = getLiveCameraState();
  useCanvasStore.getState().setCamera(panX + dx, panY + dy, zoom);
}
