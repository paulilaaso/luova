"use client";

/**
 * CodeEditor Component
 *
 * A Monaco-based code editor for editing component source code.
 * Supports JSX/TSX syntax highlighting and provides a "Convert to Custom"
 * workflow for components.
 */

import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { AlertCircle, Code, Loader2 } from "lucide-react";
import type * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Label } from "@/components/luova-ui/label";
import { MONACO_EXTRA_LIB } from "@/config/monaco-types";
import { useCodeValidationAsync } from "@/hooks/use-compiler-worker";
import { type ProjectStore, useProjectStore } from "@/stores/project-store";
import { useThemeStore } from "@/stores/theme-store";
import { useUIStore } from "@/stores/ui-store";
import { findElementByAstIndex } from "@/utils/ast-indexer";

let monacoTypesLoaded = false;

interface CodeEditorProps {
  nodeId: string;
}

export default function CodeEditor({ nodeId }: CodeEditorProps) {
  const nodes = useProjectStore((state: ProjectStore) => state.nodes);
  const node = nodes[nodeId];
  const updateComponentCode = useProjectStore(
    (state: ProjectStore) => state.updateComponentCode
  );
  const resolvedTheme = useThemeStore((state) => state.currentMode);

  const resolvedNodeId =
    node?.kind === "captured" && node.capturedMetadata?.sourceComponentId
      ? node.capturedMetadata.sourceComponentId
      : nodeId;

  const codeToDisplay =
    resolvedNodeId !== nodeId
      ? (nodes[resolvedNodeId]?.code ?? "")
      : (node?.code ?? "");

  const [isPending, startTransition] = useTransition();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCodeRef = useRef<string | null>(null);
  // Set while we push store code into Monaco via setValue(). Monaco fires
  // onChange for programmatic edits too; without this guard external updates
  // (AI edits, Reject restores, undo) would be echoed back into the store as
  // if the user typed them — e.g. re-applying rejected AI code on unmount.
  const isApplyingExternalValueRef = useRef(false);

  const validation = useCodeValidationAsync(codeToDisplay, node?.props || {});

  const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
    if (monacoTypesLoaded) return;
    monacoTypesLoaded = true;

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      checkJs: true,
    });

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      MONACO_EXTRA_LIB,
      "ts:globals.d.ts"
    );

    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
  }, []);

  const [editorReady, setEditorReady] = useState(false);
  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    setEditorReady(true);
  }, []);

  // "Go to Code" from the canvas: scroll to and select the element's tag.
  const codeReveal = useUIStore((state) => state.codeReveal);
  useEffect(() => {
    const editor = editorRef.current;
    if (!codeReveal || !editorReady || !editor) return;
    if (codeReveal.componentId !== resolvedNodeId) return;
    const model = editor.getModel();
    if (!model) return;
    useUIStore.getState().clearCodeReveal();

    const element =
      codeReveal.astIndex === null
        ? null
        : findElementByAstIndex(model.getValue(), codeReveal.astIndex);
    if (!element) {
      editor.revealLineInCenter(1);
      editor.setPosition({ lineNumber: 1, column: 1 });
    } else {
      const start = model.getPositionAt(element.getStart());
      const end = model.getPositionAt(element.getEnd());
      editor.revealRangeInCenter({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      });
      editor.setSelection({
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      });
    }
    editor.focus();
  }, [codeReveal, editorReady, resolvedNodeId]);

  useEffect(() => {
    if (codeToDisplay && editorRef.current) {
      const currentValue = editorRef.current.getValue();
      if (currentValue !== codeToDisplay) {
        // The store is the source of truth: drop any queued local edit.
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        pendingCodeRef.current = null;
        isApplyingExternalValueRef.current = true;
        try {
          editorRef.current.setValue(codeToDisplay);
        } finally {
          isApplyingExternalValueRef.current = false;
        }
      }
    }
  }, [codeToDisplay]);

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      if (isApplyingExternalValueRef.current) return;
      const newCode = value || "";
      pendingCodeRef.current = newCode;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      const timeout = setTimeout(() => {
        saveTimeoutRef.current = null;
        pendingCodeRef.current = null;
        startTransition(() => {
          updateComponentCode(resolvedNodeId, newCode);
        });
      }, 500);

      saveTimeoutRef.current = timeout;
    },
    [resolvedNodeId, updateComponentCode]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        if (pendingCodeRef.current !== null) {
          updateComponentCode(resolvedNodeId, pendingCodeRef.current);
          pendingCodeRef.current = null;
        }
      }
    };
  }, [resolvedNodeId, updateComponentCode]);

  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a component to edit its code
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Source Code</Label>
          </div>

          <div className="flex items-center gap-2">
            {isPending && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
            <span className="text-2xs text-muted-foreground uppercase font-bold tracking-wider">
              {isPending ? "Saving..." : "Live"}
            </span>
          </div>
        </div>

        {/* Validation error */}
        {validation.error && codeToDisplay.trim() !== "" && (
          <div className="p-2 rounded bg-destructive/10 border border-destructive/20 scale-95 origin-top">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertCircle className="h-3 w-3 text-destructive" />
              <p className="text-2xs text-destructive font-bold uppercase">
                Syntax Error
              </p>
            </div>
            <p className="text-xs text-destructive/80 whitespace-pre-wrap max-h-[100px] overflow-auto">
              {validation.error}
            </p>
          </div>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="typescript"
          language="typescript"
          theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
          defaultValue={codeToDisplay}
          beforeMount={handleEditorWillMount}
          onMount={handleEditorMount}
          onChange={handleCodeChange}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
            folding: true,
            bracketPairColorization: { enabled: true },
            padding: { top: 8, bottom: 8 },
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
            },
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </div>
    </div>
  );
}
