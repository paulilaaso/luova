import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useKeyboardNav } from "@/hooks/use-keyboard-nav";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

describe("global save shortcut", () => {
  it("Cmd+S dispatches luova:save-project and prevents browser default", () => {
    renderHook(() => useKeyboardNav());
    const onSave = vi.fn();
    window.addEventListener("luova:save-project", onSave);

    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    window.removeEventListener("luova:save-project", onSave);
  });

  it("Ctrl+S dispatches luova:save-project", () => {
    renderHook(() => useKeyboardNav());
    const onSave = vi.fn();
    window.addEventListener("luova:save-project", onSave);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "S",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );

    expect(onSave).toHaveBeenCalledTimes(1);
    window.removeEventListener("luova:save-project", onSave);
  });

  it("plain 's' without modifiers does not trigger save", () => {
    renderHook(() => useKeyboardNav());
    const onSave = vi.fn();
    window.addEventListener("luova:save-project", onSave);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true })
    );

    expect(onSave).not.toHaveBeenCalled();
    window.removeEventListener("luova:save-project", onSave);
  });
});

describe("delete shortcut", () => {
  function seedDeletableNode() {
    useProjectStore.setState({
      nodes: {
        root: {
          id: "root",
          type: "Container",
          props: { x: 0, y: 0 },
          code: "",
        },
        a: {
          id: "a",
          type: "Card",
          props: { x: 0, y: 0, w: 100, h: 100 },
          code: "a",
        },
      } as any,
      layerOrder: ["a"],
    });
    useUIStore.getState().selectComponents(["a"]);
  }

  it.each([
    "Backspace",
    "Delete",
  ])("%s deletes the selected component", (key) => {
    renderHook(() => useKeyboardNav());
    seedDeletableNode();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      })
    );

    expect(useProjectStore.getState().nodes.a).toBeUndefined();
  });
});
