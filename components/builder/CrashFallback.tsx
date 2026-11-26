"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/luova-ui/button";
import { useAiStore } from "@/stores/ai-store";

interface CrashFallbackProps {
  code: string;
  error: string;
  nodeId?: string;
}

export function CrashFallback({ code, error, nodeId }: CrashFallbackProps) {
  const triggerAiFix = useAiStore((state) => state.triggerAiFix);

  return (
    <div className="p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <p className="text-sm font-medium">Component Crashed</p>
      </div>
      <pre className="text-xs overflow-auto whitespace-pre-wrap font-mono">
        {error}
      </pre>

      {nodeId && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit border-destructive/30 text-destructive hover:bg-destructive/20"
          onClick={() => triggerAiFix(nodeId, error, code)}
        >
          <Sparkles className="h-3.5 w-3.5 mr-2" />
          Fix with AI
        </Button>
      )}
    </div>
  );
}
