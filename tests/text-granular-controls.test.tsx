import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  defineExtension,
  type LexicalEditor,
} from "lexical";
import { useEffect } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { TextTypographyBridge } from "@/components/builder/TextTypographyBridge";
import { TypographyControls } from "@/components/properties/TypographyControls";
import { useTextFormatStore } from "@/stores/text-format-store";

const COMPUTED_DEFAULTS: Record<string, string> = {
  "font-size": "16px",
  "font-weight": "400",
  "line-height": "24px",
  "letter-spacing": "normal",
  "word-spacing": "normal",
  color: "rgb(0, 0, 0)",
  "font-family": "sans-serif",
  "font-style": "normal",
  "text-decoration": "none",
};

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
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  // jsdom's getComputedStyle returns empty strings; emulate a browser so the
  // bridge's value extraction yields concrete numbers and sliders render.
  globalThis.getComputedStyle = ((el: Element) => {
    const inline = (el as HTMLElement).style;
    return {
      getPropertyValue: (prop: string) =>
        inline.getPropertyValue(prop) || COMPUTED_DEFAULTS[prop] || "",
      fontSize: inline.fontSize || COMPUTED_DEFAULTS["font-size"],
    } as unknown as CSSStyleDeclaration;
  }) as typeof globalThis.getComputedStyle;
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

/** Mirrors how ComponentPropsForm wires the session into TypographyControls. */
function Sidebar() {
  const session = useTextFormatStore((s) => s.session);
  if (!session) return null;
  return (
    <TypographyControls
      values={session.values}
      system={false}
      onChange={session.apply}
      onPreview={session.preview}
    />
  );
}

function runs() {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getAllTextNodes()
      .map((n) => ({ text: n.getTextContent(), style: n.getStyle() }))
  );
}

function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number
) {
  const event = new MouseEvent(type, {
    clientX,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  fireEvent(target, event);
}

async function setup(seed: () => void) {
  render(
    <LexicalExtensionComposer
      extension={defineExtension({
        name: "[root]",
        namespace: "granular-test",
        onError: (e) => {
          throw e;
        },
      })}
      contentEditable={null}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable aria-label="Editor" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <TextTypographyBridge nodeId="text-1" />
      <Capture />
      <Sidebar />
    </LexicalExtensionComposer>
  );
  await act(async () => {
    editor.update(seed);
  });
}

describe("granular typography controls on a selected range", () => {
  it("exposes the Luova grip and applies a drag to the selected run only", async () => {
    await setup(() => {
      $getRoot().clear();
      const text = $createTextNode("hello world");
      $getRoot().append($createParagraphNode().append(text));
      text.select(0, 5);
    });

    const grip = document.querySelector('[title="Font weight"]');
    expect(grip).not.toBeNull();
    // A plain mixed input must not replace the scrub handle.
    expect(
      document.querySelector('input[aria-label="Font weight"]')
    ).toBeNull();

    if (grip) {
      pointer(grip, "pointerdown", 0);
      pointer(grip, "pointermove", 120);
      pointer(grip, "pointerup", 120);
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(runs()).toEqual([
      { text: "hello", style: "font-weight: 900;" },
      { text: " world", style: "" },
    ]);
  });

  it("scopes a drag to the word selected after the editor's initial select-all", async () => {
    await setup(() => {
      $getRoot().clear();
      const text = $createTextNode("hello world");
      $getRoot().append($createParagraphNode().append(text));
      // EditorBridge selects the entire document on entry.
      $getRoot().select(0, $getRoot().getChildrenSize());
    });
    // The user then narrows the selection to the word "hello".
    await act(async () => {
      editor.update(() => {
        $getRoot().getAllTextNodes()[0]?.select(0, 5);
      });
    });

    const grip = document.querySelector('[title="Font weight"]');
    expect(grip).not.toBeNull();
    if (grip) {
      pointer(grip, "pointerdown", 0);
      pointer(grip, "pointermove", 120);
      pointer(grip, "pointerup", 120);
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(runs()).toEqual([
      { text: "hello", style: "font-weight: 900;" },
      { text: " world", style: "" },
    ]);
  });

  it("scopes a drag to the word even after a sidebar control grabs the pointer", async () => {
    await setup(() => {
      $getRoot().clear();
      const text = $createTextNode("hello world");
      $getRoot().append($createParagraphNode().append(text));
      text.select(0, 5);
    });

    // The user grabs a sidebar control; Lexical reports a transient collapsed
    // caret even though the editor still holds focus.
    const panel = document.createElement("div");
    panel.className = "properties-panel";
    const control = document.createElement("input");
    panel.append(control);
    document.body.append(panel);
    fireEvent.pointerDown(control);
    await act(async () => {
      editor.update(() => $getRoot().selectEnd());
    });

    // The selection session must survive so the drag stays scoped to the word.
    expect(useTextFormatStore.getState().session).not.toBeNull();
    const grip = document.querySelector('[title="Font weight"]');
    expect(grip).not.toBeNull();
    if (grip) {
      pointer(grip, "pointerdown", 0);
      pointer(grip, "pointermove", 120);
      pointer(grip, "pointerup", 120);
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(runs()).toEqual([
      { text: "hello", style: "font-weight: 900;" },
      { text: " world", style: "" },
    ]);
    panel.remove();
  });

  it("keeps the grip available when the selection has mixed values", async () => {
    await setup(() => {
      $getRoot().clear();
      const a = $createTextNode("a").setStyle("font-weight: 400");
      const b = $createTextNode("b").setStyle("font-weight: 700");
      const p = $createParagraphNode().append(a, b);
      $getRoot().append(p);
      p.select(0, p.getChildrenSize());
    });

    // The bridge reports a mixed weight...
    expect(useTextFormatStore.getState().session?.values.fontWeight).toBe("");
    // ...yet the scrub handle is still rendered rather than a bare input.
    expect(
      document.querySelector('[title="Font weight · mixed"]')
    ).not.toBeNull();
    expect(
      document.querySelector('input[aria-label="Font weight"]')
    ).toBeNull();
  });
});
