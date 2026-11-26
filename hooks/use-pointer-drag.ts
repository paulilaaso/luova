import { useCallback, useRef } from "react";

export interface UsePointerDragOptions {
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export interface PointerHandlers {
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
}

export function usePointerDrag(options: UsePointerDragOptions = {}) {
  const handlersRef = useRef<PointerHandlers | null>(null);

  const cleanup = useCallback(() => {
    if (handlersRef.current) {
      window.removeEventListener("pointermove", handlersRef.current.onMove);
      window.removeEventListener("pointerup", handlersRef.current.onUp);
      window.removeEventListener("pointercancel", handlersRef.current.onUp);
      handlersRef.current = null;
    }
    document.body.classList.remove("is-color-dragging");
    options.onDragEnd?.();
  }, [options]);

  const startDrag = useCallback(
    (handlers: PointerHandlers) => {
      handlersRef.current = handlers;

      document.body.classList.add("is-color-dragging");
      options.onDragStart?.();

      window.addEventListener("pointermove", handlers.onMove);
      window.addEventListener("pointerup", handlers.onUp);
      window.addEventListener("pointercancel", handlers.onUp);
    },
    [options]
  );

  return { startDrag, cleanup };
}
