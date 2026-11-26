"use client";

import { AlertCircle, Check, Loader2, Sparkles, Square, X } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/luova-ui/button";
import { useAiActionOrchestrator } from "@/hooks/use-ai-action-orchestrator";
import { detectAiMode } from "@/lib/ai/mode";
import { useAiStore } from "@/stores/ai-store";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

interface AiResponseOverlayProps {
  hidden?: boolean;
}

export default function AiResponseOverlay({
  hidden = false,
}: AiResponseOverlayProps) {
  const status = useAiStore((state) => state.status);
  const error = useAiStore((state) => state.error);
  const assistantText = useAiStore((state) => state.assistantText);
  const currentStatus = useAiStore((state) => state.currentStatus);
  const isFixingError = useAiStore((state) => state.isFixingError);
  const stopFix = useAiStore((state) => state.stopFix);
  const initialAppSnapshot = useAiStore((state) => state.initialAppSnapshot);
  const propertiesTab = useAiStore((state) => state.propertiesTab);
  const selectedIds = useUIStore((state) => state.selectedIds);
  const nodes = useProjectStore((state) => state.nodes);
  const { acceptAiChanges, rejectAiChanges, keepBothAiChanges } =
    useAiActionOrchestrator();

  // Detect current AI mode
  const mode = useMemo(
    () => detectAiMode(selectedIds, propertiesTab, nodes),
    [nodes, selectedIds, propertiesTab]
  );

  // Check if canvas was blank before AI generation
  const canvasWasBlank = useMemo(() => {
    if (!initialAppSnapshot) return false;
    try {
      const parsed = JSON.parse(initialAppSnapshot);
      // Canvas is blank if only root node exists (or no nodes at all)
      return Object.keys(parsed.nodes || {}).length <= 1;
    } catch {
      return false;
    }
  }, [initialAppSnapshot]);

  // Hide "Keep Both" if mode is "create" AND canvas was blank
  const showKeepBoth = !(mode === "create" && canvasWasBlank);

  if (hidden) {
    return null;
  }
  const isWorking =
    status === "thinking" || status === "submitted" || status === "streaming";
  const hasResult = !error && (Boolean(assistantText) || status === "ready");

  if (!isWorking && !isFixingError && !hasResult && !error) {
    return null;
  }

  return (
    <div
      data-app-chrome="true"
      className="pointer-events-none absolute right-4 top-4 z-50 w-90 max-w-[calc(100%-2rem)]"
    >
      <div className="pointer-events-auto border bg-background/95 p-3 shadow-lg backdrop-blur rounded-lg">
        <div className="flex items-start gap-2 min-w-0">
          {isWorking || isFixingError ? (
            <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />
          ) : hasResult ? (
            <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
          )}

          <div className="flex-1 min-w-0">
            {isFixingError && !isWorking && (
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Fixing runtime error...</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={stopFix}
                >
                  <Square className="mr-1.5 h-3 w-3" />
                  Stop
                </Button>
              </div>
            )}

            {isWorking && (
              <div className="space-y-2">
                <p className="text-sm font-medium overflow-hidden">
                  <span
                    style={{
                      background:
                        "linear-gradient(90deg, var(--muted-foreground) 0%, var(--muted-foreground) 20%, var(--foreground) 38%, color-mix(in oklch, var(--foreground) 75%, var(--background)) 50%, var(--foreground) 62%, var(--muted-foreground) 80%, var(--muted-foreground) 100%)",
                      backgroundSize: "200% auto",
                      backgroundClip: "text",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      color: "transparent",
                      animation: "ai-gradient-pan 2s linear infinite",
                      display: "inline-block",
                    }}
                  >
                    {currentStatus
                      ? currentStatus.startsWith("Planning:")
                        ? `${currentStatus.slice(10)}`
                        : currentStatus
                      : status === "streaming"
                        ? "AI is streaming results..."
                        : "AI is planning changes..."}
                  </span>
                </p>
                {assistantText && (
                  <div className="max-h-64 overflow-y-auto rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground leading-relaxed pr-1 scrollbar-thin [&_strong]:text-foreground [&_strong]:font-semibold [&_h3]:text-foreground [&_h4]:text-foreground [&_h5]:text-foreground [&_code]:text-[0.85em]">
                    <ReactMarkdown>{assistantText}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="space-y-2 min-w-0">
                <p className="text-sm font-medium text-destructive">
                  AI request failed
                </p>
                <div className="max-h-40 overflow-y-auto pr-1 scrollbar-thin">
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                    {error}
                  </p>
                </div>
                {hasResult ? (
                  <div className="pb-1" />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={rejectAiChanges}
                  >
                    <X className="mr-1.5 h-3 w-3" />
                    Dismiss
                  </Button>
                )}
              </div>
            )}

            {hasResult && !isWorking && (
              <div className="space-y-2">
                <p className="text-sm font-medium">AI changes applied</p>

                {assistantText && (
                  <div className="max-h-64 overflow-y-auto rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground leading-relaxed pr-1 scrollbar-thin [&_strong]:text-foreground [&_strong]:font-semibold [&_h3]:text-foreground [&_h4]:text-foreground [&_h5]:text-foreground [&_code]:text-[0.85em]">
                    <ReactMarkdown>{assistantText}</ReactMarkdown>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={acceptAiChanges}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Accept
                  </Button>
                  {showKeepBoth && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={keepBothAiChanges}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Keep Both
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={rejectAiChanges}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
