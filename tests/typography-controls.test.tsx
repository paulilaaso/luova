import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SliderWithInput } from "@/components/properties/SliderWithInput";
import { TypographyControls } from "@/components/properties/TypographyControls";
import type { TypographyValues } from "@/utils/text-typography";

const values: TypographyValues = {
  fontFamily: "sans",
  fontSize: "20",
  fontWeight: "700",
  lineHeight: "150",
  letterSpacing: "0.025",
  wordSpacing: "0",
  textColor: "#000000",
  fontStyle: "normal",
  textDecoration: "none",
};

afterEach(cleanup);

describe("typography system fields", () => {
  it("shows the selected preset names and commits their numeric values", () => {
    const onChange = vi.fn();
    render(<TypographyControls values={values} onChange={onChange} system />);

    const cases = [
      ["Font size", "XL · 20", "24", "fontSize", 24],
      ["Font weight", "Bold", "500", "fontWeight", 500],
      ["Line height (%)", "Normal · 1.5", "162.5", "lineHeight", 162.5],
      ["Letter spacing (em)", "Wide · 0.025em", "0.05", "letterSpacing", 0.05],
    ] as const;
    for (const [label, token, next, property, expected] of cases) {
      const select = screen.getByRole("combobox", {
        name: label,
      }) as HTMLSelectElement;
      expect(select.selectedOptions[0].text).toBe(token);
      fireEvent.change(select, { target: { value: next } });
      expect(onChange).toHaveBeenLastCalledWith(property, expected);
    }
  });

  it("recognizes numeric equivalents instead of falling back to the first preset", () => {
    render(
      <TypographyControls
        values={{ ...values, fontSize: "20.0" }}
        onChange={vi.fn()}
        system
      />
    );
    const select = screen.getByRole("combobox", {
      name: "Font size",
    }) as HTMLSelectElement;
    expect(select.selectedOptions[0].text).toBe("XL · 20");
  });

  it("keeps custom and mixed values explicit without changing them on render", () => {
    const onChange = vi.fn();
    render(
      <TypographyControls
        values={{ ...values, fontSize: "21", fontWeight: "" }}
        onChange={onChange}
        system
      />
    );
    const size = screen.getByRole("combobox", {
      name: "Font size",
    }) as HTMLSelectElement;
    const weight = screen.getByRole("combobox", {
      name: "Font weight",
    }) as HTMLSelectElement;
    expect(size.selectedOptions[0].text).toBe("Custom (21px)");
    expect(weight.selectedOptions[0].text).toBe("Mixed");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("returns to editable numbers when System is disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TypographyControls values={values} onChange={onChange} system />
    );
    rerender(
      <TypographyControls values={values} onChange={onChange} system={false} />
    );
    const size = document.getElementById("input-font-size") as HTMLInputElement;
    expect(size.value).toBe("20");
    fireEvent.change(size, { target: { value: "23" } });
    fireEvent.blur(size);
    expect(onChange).toHaveBeenLastCalledWith("fontSize", 23);
  });
});

describe("numeric field unit spacing", () => {
  it("remeasures the unit when a hidden panel becomes visible", () => {
    let unitWidth = 0;
    let resized: (() => void) | undefined;
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({ width: unitWidth }) as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    try {
      render(
        <SliderWithInput
          label="Size"
          value={20}
          min={1}
          max={256}
          unit="px"
          onChange={() => {}}
        />
      );
      const input = screen.getByRole("spinbutton") as HTMLInputElement;
      expect(input.style.paddingInlineEnd).toBe("calc(0px + 0.875rem)");
      unitWidth = 18;
      act(() => resized?.());
      expect(input.style.paddingInlineEnd).toBe("calc(18px + 0.875rem)");
      unitWidth = 24;
      act(() => resized?.());
      expect(input.style.paddingInlineEnd).toBe("calc(24px + 0.875rem)");
    } finally {
      cleanup();
      bounds.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
