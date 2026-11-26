import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DynamicRenderer from "@/components/builder/DynamicRenderer";

// Mock dependencies
vi.mock("@/config/runtime-scope", () => ({
  RUNTIME_SCOPE: {},
  customRequire: vi.fn().mockReturnValue({}),
}));

vi.mock("@/components/builder/ErrorBoundary", () => ({
  LiveErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/stores/project-store", () => ({
  useProjectStore: vi.fn(),
}));

let compiledCode =
  "return () => React.createElement('div', null, 'Test Component');";

vi.mock("@/hooks/use-compiler-worker", () => ({
  useCompilerWorker: () => ({
    code: compiledCode,
    css: ".runtime-generated { color: rgb(10, 10, 10); }",
    error: null,
    isCompiling: false,
  }),
}));

vi.mock("@/components/luova-ui/skeleton", () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className}>Loading...</div>
  ),
}));

vi.mock("@/components/luova-ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("DynamicRenderer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compiledCode =
      "return () => React.createElement('div', null, 'Test Component');";
  });

  it("preserves internal component state across unrelated prop updates", async () => {
    compiledCode = `
      return function Counter() {
        const [count, setCount] = React.useState(0);
        return React.createElement(
          'button',
          { onClick: () => setCount((c) => c + 1) },
          'Count: ' + count
        );
      };
    `;

    const { rerender } = render(
      <DynamicRenderer
        code="export default function Counter() {}"
        props={{ theme: "light" }}
      />
    );

    const btn = await screen.findByRole("button");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("Count: 1");

    rerender(
      <DynamicRenderer
        code="export default function Counter() {}"
        props={{ theme: "dark" }}
      />
    );

    expect(screen.getByRole("button")).toHaveTextContent("Count: 1");
  });

  it("injects runtime css returned by the compiler worker", async () => {
    render(<DynamicRenderer code="export default () => <div>Test</div>;" />);
    expect(await screen.findByText("Test Component")).toBeInTheDocument();
    const styleEl = document.getElementById("luova-component-styles");
    expect(styleEl?.textContent).toContain(".runtime-generated");
  });

  it("renders forwardRef component objects with React.createElement", async () => {
    compiledCode = `
      return React.forwardRef(function ForwardedButton(_props, ref) {
        return React.createElement('button', { ref }, 'Forwarded');
      });
    `;

    render(
      <DynamicRenderer code="export default React.forwardRef(() => null);" />
    );

    expect(await screen.findByRole("button")).toHaveTextContent("Forwarded");
  });
});
