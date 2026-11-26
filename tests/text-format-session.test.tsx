import { ListItemNode, ListNode } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  defineExtension,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TextTypographyBridge } from "@/components/builder/TextTypographyBridge";
import { useTextFormatStore } from "@/stores/text-format-store";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    right: 100,
    bottom: 20,
    left: 0,
    toJSON: () => ({}),
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(cleanup);
let editor: LexicalEditor;
function Capture() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => {
    editor = instance;
  }, [instance]);
  return null;
}
async function setup() {
  render(
    <LexicalExtensionComposer
      extension={defineExtension({
        name: "[root]",
        namespace: "session-test",
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
        onError: (e) => {
          throw e;
        },
      })}
      contentEditable={null}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Editor"
            style={{ fontSize: "16px", fontWeight: 400 }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <TextTypographyBridge nodeId="text-1" />
      <Capture />
    </LexicalExtensionComposer>
  );
  await act(async () => {
    editor.update(() => {
      $getRoot().clear();
      const text = $createTextNode("hello world");
      $getRoot().append($createParagraphNode().append(text));
      text.select(0, 5);
    });
  });
}
function runs() {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getAllTextNodes()
      .map((n) => ({ text: n.getTextContent(), style: n.getStyle() }))
  );
}

describe("Shared selection formatting session", () => {
  it("aligns the selected paragraph and retains alignment after styling", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().controller?.formatAlignment("center");
    });
    const paragraph = editor.getRootElement()?.querySelector("p");
    expect(paragraph?.style.textAlign).toBe("center");
    expect(useTextFormatStore.getState().controller?.alignment).toBe("center");

    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 23);
    });
    expect(paragraph?.style.textAlign).toBe("center");
  });
  it("publishes a double-clicked native word selection", async () => {
    await setup();
    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });
    expect(useTextFormatStore.getState().session).toBeNull();

    const text = editor
      .getRootElement()
      ?.querySelector("[data-lexical-text]")?.firstChild;
    expect(text).toBeTruthy();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frame = callback;
        return 1;
      });
    fireEvent.doubleClick(editor.getRootElement()!);
    expect(useTextFormatStore.getState().session).toBeNull();
    await act(async () => frame?.(0));
    requestFrame.mockRestore();

    expect(useTextFormatStore.getState().session?.nodeId).toBe("text-1");
  });

  it("captures a double-clicked DOM range before a formatting control takes focus", async () => {
    await setup();
    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });
    const text = editor
      .getRootElement()
      ?.querySelector("[data-lexical-text]")?.firstChild;
    expect(text).toBeTruthy();
    const range = document.createRange();
    range.setStart(text!, 6);
    range.setEnd(text!, 11);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    // No selectionchange has reached Lexical yet. The control's pointerdown
    // must capture the visible native range before the control changes focus.
    const control = document.createElement("button");
    control.setAttribute("data-text-format-controls", "true");
    document.body.append(control);
    await act(async () => {
      fireEvent.pointerDown(control);
    });
    expect(useTextFormatStore.getState().session?.nodeId).toBe("text-1");
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 23);
    });
    expect(runs()).toEqual([
      { text: "hello ", style: "" },
      { text: "world", style: "font-size: 23px;" },
    ]);
    control.remove();
  });
  it("keeps a selection across control focus and only formats that range", async () => {
    await setup();
    expect(useTextFormatStore.getState().session?.nodeId).toBe("text-1");
    await act(async () => {
      editor.update(() => $setSelection(null));
    });
    expect(useTextFormatStore.getState().session).not.toBeNull();
    await act(async () => {
      useTextFormatStore.getState().session!.apply("fontSize", 23);
    });
    expect(runs()).toEqual([
      { text: "hello", style: "font-size: 23px;" },
      { text: " world", style: "" },
    ]);
    expect(useTextFormatStore.getState().session?.values.fontSize).toBe("23");
  });
  it("keeps a granular live preview and its commit scoped to the selection", async () => {
    await setup();
    // Mirrors SliderWithInput: onChangeImmediate fires previews, onCommit the
    // final apply.
    await act(async () => {
      useTextFormatStore.getState().session!.preview("fontWeight", 600);
    });
    await act(async () => {
      useTextFormatStore.getState().session!.preview("fontWeight", 700);
    });
    await act(async () => {
      useTextFormatStore.getState().session!.apply("fontWeight", 700);
    });
    expect(runs()).toEqual([
      { text: "hello", style: "font-weight: 700;" },
      { text: " world", style: "" },
    ]);
    expect(useTextFormatStore.getState().session?.values.fontWeight).toBe(
      "700"
    );
  });
  it("reports mixed values and clears only selected runs", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().session!.apply("fontWeight", 600);
    });
    await act(async () => {
      editor.update(() => $getRoot().select(0, $getRoot().getChildrenSize()));
    });
    expect(useTextFormatStore.getState().session?.values.fontWeight).toBe("");
    await act(async () => {
      editor.update(() => $getRoot().getAllTextNodes()[0].select(0, 2));
    });
    await act(async () => {
      useTextFormatStore.getState().session!.clear();
    });
    const result = runs();
    expect(result[0]).toEqual({ text: "he", style: "" });
    expect(result[1].style).toContain("font-weight: 600");
  });
  it("applies line height to paragraphs and supports undo and redo", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().session!.apply("lineHeight", 180);
    });
    const root = editor.getRootElement()!;
    expect(root.querySelector("p")?.style.lineHeight).toBe("1.8");
    expect(runs()[0].style).not.toContain("line-height");
    await act(async () => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(root.querySelector("p")?.style.lineHeight).toBe("");
    await act(async () => {
      editor.dispatchCommand(REDO_COMMAND, undefined);
    });
    expect(root.querySelector("p")?.style.lineHeight).toBe("1.8");
  });
  it("groups live color previews and the final commit into one undo step", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().session!.preview("textColor", "#ff0000");
    });
    await act(async () => {
      useTextFormatStore.getState().session!.preview("textColor", "#00ff00");
    });
    await act(async () => {
      useTextFormatStore.getState().session!.apply("textColor", "#0000ff");
    });
    expect(runs()[0].style).toContain("color: #0000ff");
    await act(async () => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(runs()).toEqual([{ text: "hello world", style: "" }]);
  });

  it("returns to block scope for a caret and clears the session on unmount", async () => {
    await setup();
    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });
    expect(useTextFormatStore.getState().session).toBeNull();
    await act(async () => {
      editor.update(() => $getRoot().select(0, $getRoot().getChildrenSize()));
    });
    expect(useTextFormatStore.getState().session).not.toBeNull();
    cleanup();
    expect(useTextFormatStore.getState().session).toBeNull();
  });

  it("keeps the selected range when focus moves to sidebar controls", async () => {
    await setup();
    // The user is dragging a sidebar control; the pointerdown lands outside the
    // editor and Lexical reports a transient collapsed caret.
    const sidebar = document.createElement("div");
    sidebar.className = "properties-panel";
    document.body.append(sidebar);
    const control = document.createElement("input");
    sidebar.append(control);
    fireEvent.pointerDown(control);

    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });

    // The selection-scoped session must survive the sidebar interaction.
    expect(useTextFormatStore.getState().session).not.toBeNull();
    await act(async () => {
      useTextFormatStore.getState().session?.apply("letterSpacing", 0.2);
    });
    // ...and the change must land on the selected word only, not the block.
    expect(runs()).toEqual([
      { text: "hello", style: "letter-spacing: 0.2em;" },
      { text: " world", style: "" },
    ]);
    sidebar.remove();
  });

  it("publishes a structural controller even with a bare caret", async () => {
    await setup();
    expect(useTextFormatStore.getState().controller?.nodeId).toBe("text-1");
    expect(useTextFormatStore.getState().controller?.block).toBe("paragraph");

    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });
    // The run-level session needs a range, but the controller must survive.
    expect(useTextFormatStore.getState().session).toBeNull();
    expect(useTextFormatStore.getState().controller?.nodeId).toBe("text-1");

    await act(async () => {
      useTextFormatStore.getState().controller?.formatBlock("h2");
    });
    expect(editor.getRootElement()?.querySelector("h2")?.textContent).toBe(
      "hello world"
    );
    expect(useTextFormatStore.getState().controller?.block).toBe("h2");
  });

  it("switches between headings and paragraph from the controller", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().controller?.formatBlock("h3");
    });
    expect(editor.getRootElement()?.querySelector("h3")).not.toBeNull();
    expect(useTextFormatStore.getState().controller?.block).toBe("h3");

    await act(async () => {
      useTextFormatStore.getState().controller?.formatBlock("paragraph");
    });
    expect(editor.getRootElement()?.querySelector("h3")).toBeNull();
    expect(useTextFormatStore.getState().controller?.block).toBe("paragraph");
  });

  it("clears every run and block style through the controller (reset button)", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontWeight", 700);
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("lineHeight", 180);
    });
    expect(runs()[0].style).toContain("font-weight: 700");
    expect(editor.getRootElement()?.querySelector("p")?.style.lineHeight).toBe(
      "1.8"
    );

    await act(async () => {
      useTextFormatStore.getState().controller?.resetText();
    });

    expect(runs().every((r) => r.style === "")).toBe(true);
    expect(editor.getRootElement()?.querySelector("p")?.style.lineHeight).toBe(
      ""
    );
  });

  it("collapses headings back to plain paragraphs on reset", async () => {
    await setup();
    await act(async () => {
      useTextFormatStore.getState().controller?.formatBlock("h2");
    });
    expect(editor.getRootElement()?.querySelector("h2")).not.toBeNull();

    await act(async () => {
      useTextFormatStore.getState().controller?.resetText();
    });

    expect(editor.getRootElement()?.querySelector("h2")).toBeNull();
    expect(editor.getRootElement()?.querySelector("p")?.textContent).toBe(
      "hello world"
    );
  });
});
