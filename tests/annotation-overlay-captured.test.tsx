import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import AnnotationOverlay from "@/components/builder/AnnotationOverlay";
import { useProjectStore } from "@/stores/project-store";
import { useUIStore } from "@/stores/ui-store";

const PROMPT = "Describe the edit…";
const ICON = /describe an ai edit/i;

function captureElement() {
  let id = "";
  act(() => {
    id = useProjectStore
      .getState()
      .ingestElement(0, { x: 10, y: 10, w: 100, h: 40 }, "Button", "root");
  });
  return id;
}

describe("AnnotationOverlay — captured element prompt bubble", () => {
  beforeEach(() => {
    useProjectStore.getState().reset();
    useUIStore.getState().clearSelection();
  });

  it("shows a speech-bubble button, not the full bubble, at first", () => {
    captureElement();
    render(<AnnotationOverlay />);
    expect(screen.getByRole("button", { name: ICON })).toBeTruthy();
    expect(screen.queryByPlaceholderText(PROMPT)).toBeNull();
  });

  it("expands to the focused prompt bubble when the button is clicked", () => {
    captureElement();
    render(<AnnotationOverlay />);
    fireEvent.click(screen.getByRole("button", { name: ICON }));

    const textarea = screen.getByPlaceholderText(PROMPT);
    expect(document.activeElement).toBe(textarea);
    expect(screen.queryByRole("button", { name: ICON })).toBeNull();
  });

  it("hides the button once the element is edited in the sidebar", () => {
    const id = captureElement();
    render(<AnnotationOverlay />);
    expect(screen.getByRole("button", { name: ICON })).toBeTruthy();

    act(() => useProjectStore.getState().markCapturedNodeEdited(id));
    expect(screen.queryByRole("button", { name: ICON })).toBeNull();
    // The captured node itself is kept (it tracks the manual edits).
    expect(useProjectStore.getState().nodes[id]).toBeDefined();
  });

  it("hides an expanded but empty bubble once the element is edited", () => {
    const id = captureElement();
    render(<AnnotationOverlay />);
    fireEvent.click(screen.getByRole("button", { name: ICON }));
    expect(screen.getByPlaceholderText(PROMPT)).toBeTruthy();

    act(() => useProjectStore.getState().markCapturedNodeEdited(id));
    expect(screen.queryByPlaceholderText(PROMPT)).toBeNull();
  });

  it("brings the bubble back when the edited element is selected again", () => {
    const id = captureElement();
    act(() => useUIStore.getState().selectComponent(id));
    render(<AnnotationOverlay />);

    // Edited by hand while selected: the bubble steps aside.
    act(() => useProjectStore.getState().markCapturedNodeEdited(id));
    expect(screen.queryByRole("button", { name: ICON })).toBeNull();

    // Deselected: still hidden.
    act(() => useUIStore.getState().clearSelection());
    expect(screen.queryByRole("button", { name: ICON })).toBeNull();

    // Back to the same element: the bubble returns.
    act(() => useUIStore.getState().selectComponent(id));
    expect(screen.getByRole("button", { name: ICON })).toBeTruthy();

    // Editing again in this visit doesn't hide it once more.
    act(() => useProjectStore.getState().markCapturedNodeEdited(id));
    expect(screen.getByRole("button", { name: ICON })).toBeTruthy();
  });

  it("keeps the bubble when the user already typed a prompt", () => {
    const id = captureElement();
    act(() => useProjectStore.getState().updateNodeComment(id, "make it red"));
    render(<AnnotationOverlay />);

    act(() => useProjectStore.getState().markCapturedNodeEdited(id));
    expect(screen.getByDisplayValue("make it red")).toBeTruthy();
  });
});
