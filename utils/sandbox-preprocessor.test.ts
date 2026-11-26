import { describe, expect, it } from "vitest";
import { preprocessSandboxSource } from "@/utils/sandbox-preprocessor";

const runtimeScope = {
  "demo-fx": {
    MetalFx: function MetalFx() {
      return null;
    },
  },
  "other-ui": {
    Button: function Button() {
      return null;
    },
  },
  "second-ui": {
    Button: function Button() {
      return null;
    },
  },
  "@radix-ui/react-dialog": {
    Root: function Root() {
      return null;
    },
  },
};

describe("preprocessSandboxSource", () => {
  it("wraps top-level JSX in a default component", () => {
    const source = `import { MetalFx } from "demo-fx";

<MetalFx preset="chromatic">
  <button>Upgrade to Pro</button>
</MetalFx>`;

    const result = preprocessSandboxSource(source, runtimeScope);

    expect(result).toContain("export default function SandboxComponent()");
    expect(result).toContain('return (<MetalFx preset="chromatic">');
    expect(result).toContain("<button>Upgrade to Pro</button>");
  });

  it("auto-imports uniquely exported JSX component names", () => {
    const result = preprocessSandboxSource(
      `<MetalFx><button>Upgrade</button></MetalFx>`,
      runtimeScope
    );

    expect(result).toContain('import { MetalFx } from "demo-fx";');
    expect(result).toContain("export default function SandboxComponent()");
  });

  it("does not auto-import ambiguous JSX component names", () => {
    const result = preprocessSandboxSource(
      `<Button>Save</Button>`,
      runtimeScope
    );

    expect(result).not.toContain("import { Button }");
    expect(result).toContain("export default function SandboxComponent()");
  });

  it("auto-imports registered namespace packages for member JSX", () => {
    const result = preprocessSandboxSource(`<Dialog.Root />`, runtimeScope);

    expect(result).toContain(
      'import * as Dialog from "@radix-ui/react-dialog";'
    );
  });

  it("leaves existing default exports alone", () => {
    const source = `export default function Demo() {
  return <MetalFx />;
}`;

    const result = preprocessSandboxSource(source, runtimeScope);

    expect(result).not.toContain("SandboxComponent");
    expect(result).toContain('import { MetalFx } from "demo-fx";');
  });
});
