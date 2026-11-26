import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCapturedStyles } from "@/hooks/use-captured-styles";
import { componentStyleManager } from "@/utils/canvas-style-manager";

afterEach(() => componentStyleManager.clearAll());

describe("whole text typography preview", () => {
  it("overrides mixed inline runs throughout a text component during a drag", () => {
    const { result, unmount } = renderHook(() =>
      useCapturedStyles("text-1", "0", "text-1", "light", true)
    );

    act(() => {
      result.current.injectOverride("letterSpacing", 0.15);
      result.current.injectOverride("fontSize", 32);
      result.current.injectOverride("fontWeight", 600);
    });

    const css = componentStyleManager.getStyle("captured-live-text-1");
    expect(css).toContain(
      ':root:not(.dark) [data-component-id="text-1"] [data-ast-index="0"] *'
    );
    expect(css).toContain("letter-spacing: 0.15em !important;");
    expect(css).toContain("font-size: 32px !important;");
    expect(css).toContain("font-weight: 600 !important;");

    unmount();
    expect(
      componentStyleManager.getStyle("captured-live-text-1")
    ).toBeUndefined();
  });
});
