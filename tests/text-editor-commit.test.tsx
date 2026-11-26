import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTextEditor from "@/components/builder/LiveTextEditor";
import { useProjectStore } from "@/stores/project-store";
import { useTextFormatStore } from "@/stores/text-format-store";
import { useUIStore } from "@/stores/ui-store";
import { updateTypographyCode } from "@/utils/typography-commit";

// Font loading touches the network/DOM; irrelevant to the commit path.
vi.mock("@/utils/fonts", () => ({
  loadCustomFont: vi.fn(),
  registerCustomFont: vi.fn(),
  loadGoogleFont: vi.fn(),
}));

const TEXT_CODE = `export default function Text() {
  return (
    <div className="text-foreground">
      hello world
    </div>
  );
}
`;

function seedProject() {
  useProjectStore.getState().reset();
  useProjectStore.setState({
    rootId: "root",
    layerOrder: ["text-1"],
    nodes: {
      root: {
        id: "root",
        type: "Container",
        props: { x: 0, y: 0, w: 1200, h: 800, positionType: "absolute" },
        code: "",
      },
      "text-1": {
        id: "text-1",
        type: "Text",
        props: { x: 0, y: 0, w: 400, h: 100 },
        code: TEXT_CODE,
      },
    },
  });
}

afterEach(cleanup);

describe("LiveTextEditor commit", () => {
  beforeEach(() => {
    seedProject();
    useTextFormatStore.setState({ session: null, controller: null });
    useUIStore.getState().clearSelection();
  });

  it("persists a merge-tagged selection change even while the word stays selected", async () => {
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });

    // EditorBridge selects the whole document on entry, so a session exists.
    const session = useTextFormatStore.getState().session;
    expect(session).not.toBeNull();

    // A live preview (merge-tagged after the first) followed by a merging
    // commit — exactly the scrub-drag shape — must still be captured by
    // OnChangePlugin, otherwise the unmount commit writes stale HTML.
    await act(async () => {
      useTextFormatStore.getState().session?.preview("letterSpacing", 0.1);
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("letterSpacing", 0.2);
    });

    // Deselect without ever collapsing the caret: the commit runs on unmount.
    await act(async () => {
      cleanup();
    });

    const code = useProjectStore.getState().nodes["text-1"]?.code ?? "";
    expect(code).toContain("letter-spacing:0.2em");
  });

  it("saves formatting on blur while the editor is still mounted", async () => {
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 31);
    });

    fireEvent.blur(document.querySelector('[aria-label="Text content"]')!);
    expect(useProjectStore.getState().nodes["text-1"].code).toContain(
      "font-size:31px"
    );
  });

  it("keeps Edit mode text alignment while editing and after a typography change", async () => {
    const alignedCode = TEXT_CODE.replace(
      "hello world",
      '<p className="text-right">hello world</p>'
    );
    useProjectStore.getState().updateComponentCode("text-1", alignedCode);
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={alignedCode} />);
      await Promise.resolve();
    });

    const editor = document.querySelector<HTMLElement>(
      '[aria-label="Text content"]'
    );
    expect(editor?.querySelector("p")?.style.textAlign).toBe("right");

    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 27);
    });
    expect(editor?.querySelector("p")?.style.textAlign).toBe("right");

    fireEvent.blur(editor!);
    const code = useProjectStore.getState().nodes["text-1"].code;
    expect(code).toContain("text-right");
    expect(code).toContain("font-size:27px");
  });

  it("keeps a fixed line height when the text editor opens", async () => {
    const code = TEXT_CODE.replace(
      "text-foreground",
      "text-foreground leading-6"
    );
    useProjectStore.getState().updateComponentCode("text-1", code);
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={code} />);
      await Promise.resolve();
    });

    const editor = document.querySelector<HTMLElement>(
      '[aria-label="Text content"]'
    );
    expect(editor?.style.lineHeight).toBe("calc(var(--spacing) * 6)");
  });

  it("saves an idle edit before the editor closes", async () => {
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 27);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(useProjectStore.getState().nodes["text-1"].code).toContain(
      "font-size:27px"
    );
    expect(
      document.querySelector('[aria-label="Text content"]')
    ).not.toBeNull();
  });

  it("flushes the editor when another node is selected", async () => {
    useUIStore.getState().selectComponent("text-1");
    useUIStore.getState().setEditingTextNodeId("text-1");
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 29);
      useUIStore.getState().selectComponent("root");
    });

    expect(useProjectStore.getState().nodes["text-1"].code).toContain(
      "font-size:29px"
    );
    expect(useUIStore.getState().editingTextNodeId).toBeNull();
  });

  it("flushes the text before project storage writes on page exit", async () => {
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 33);
    });

    fireEvent(window, new Event("beforeunload"));
    const persisted = JSON.parse(
      localStorage.getItem("luova-app-storage") ?? "{}"
    );
    expect(persisted.state.nodes["text-1"].code).toContain("font-size:33px");
  });

  it("keeps a whole-block size change after the live editor closes", async () => {
    await act(async () => {
      render(<LiveTextEditor nodeId="text-1" code={TEXT_CODE} />);
      await Promise.resolve();
    });
    await act(async () => {
      useTextFormatStore.getState().session?.apply("fontSize", 23);
    });

    const controller = useTextFormatStore.getState().controller!;
    controller.flush();
    controller.clearProperty("fontSize");
    controller.flush();
    const liveCode = useProjectStore.getState().nodes["text-1"].code;
    useProjectStore.getState().updateComponentCode(
      "text-1",
      updateTypographyCode(liveCode, 0, "fontSize", 36, "light", undefined, {
        stripDescendants: true,
      })
    );
    await act(async () => cleanup());

    const code = useProjectStore.getState().nodes["text-1"].code;
    expect(code).toContain("text-4xl");
    expect(code).not.toContain("font-size:23px");
  });
});
