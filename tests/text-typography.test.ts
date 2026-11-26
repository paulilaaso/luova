import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot, $isElementNode, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
  typographyExportMap,
  typographyImportMap,
} from "@/utils/lexical-typography";
import { richTextHtmlToJsx, richTextJsxToEditorDom } from "@/utils/rich-text";

function roundtrip(jsx: string) {
  const editor = createEditor({
    namespace: "test",
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    html: { import: typographyImportMap(), export: typographyExportMap() },
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().append(
        ...$generateNodesFromDOM(editor, richTextJsxToEditorDom(jsx))
      );
    },
    { discrete: true }
  );
  let html = "";
  editor.getEditorState().read(() => {
    html = $generateHtmlFromNodes(editor);
  });
  return { editor, jsx: richTextHtmlToJsx(html), html };
}
describe("Typography survives the real Lexical import/export path", () => {
  it("keeps consolidated runs stable through repeated edits", () => {
    let jsx =
      '<p><span className="italic"><span className="italic [font-weight:400] [font-style:italic]">first </span></span><span className="italic"><span className="italic [font-size:36px] [font-weight:400] [font-style:italic]">large</span></span><span className="italic"><span className="italic [font-weight:400] [font-style:italic]"> last </span></span><span className="underline"><span className="italic"><span className="italic [font-weight:400] [letter-spacing:0.385em] [font-style:italic] [text-decoration:underline]">spaced</span></span></span></p>';
    let canonical = "";
    for (let i = 0; i < 4; i++) {
      const result = roundtrip(jsx);
      result.editor.getEditorState().read(() => {
        const runs = $getRoot().getAllTextNodes();
        expect(runs.map((run) => run.getTextContent()).join("")).toBe(
          "first large last spaced"
        );
        expect(runs.every((run) => run.hasFormat("italic"))).toBe(true);
        expect(
          runs.find((run) => run.getTextContent() === "large")?.getStyle()
        ).toContain("font-size: 36px");
        expect(runs.at(-1)?.hasFormat("underline")).toBe(true);
        expect(runs.at(-1)?.getStyle()).toContain("letter-spacing: 0.385em");
      });
      expect(result.jsx).not.toContain("[font-style:italic]");
      expect(result.jsx).not.toContain("[text-decoration:underline]");
      expect(result.jsx.match(/\bitalic\b/g)).toHaveLength(1);
      if (i === 0) canonical = result.jsx;
      else expect(result.jsx).toBe(canonical);
      jsx = result.jsx;
    }
  });

  it("preserves combined formatting and exact numeric weights", () => {
    const result = roundtrip(
      '<p><span className="font-semibold italic underline">styled</span></p>'
    );
    result.editor.getEditorState().read(() => {
      const node = $getRoot().getAllTextNodes()[0];
      expect(node.hasFormat("italic")).toBe(true);
      expect(node.hasFormat("underline")).toBe(true);
      expect(node.getStyle()).toContain("font-weight: 600");
    });
    expect(result.jsx).toContain("[font-weight:600]");
    expect(roundtrip(result.jsx).jsx).toContain("[font-weight:600]");
  });
  it("preserves arbitrary size, font, spacing and semantic color through repeated edits", () => {
    let jsx =
      '<p><span className="[font-family:&quot;Brand_Font&quot;] [font-size:23px] [font-weight:450] [letter-spacing:0.037em] [color:var(--primary)]">hello</span></p>';
    for (let i = 0; i < 3; i++) {
      const result = roundtrip(jsx);
      expect(result.jsx).toContain("[font-size:23px]");
      expect(result.jsx).toContain("[font-weight:450]");
      expect(result.jsx).toContain("[letter-spacing:0.037em]");
      expect(result.jsx).toContain("[color:var(--primary)]");
      expect(result.jsx).toContain("Brand_Font");
      jsx = result.jsx;
    }
  });
  it("preserves paragraph line height without applying it to text runs", () => {
    const { editor, jsx } = roundtrip(
      '<p className="[line-height:1.8]">hello</p>'
    );
    expect(jsx).toContain('<p className="[line-height:1.8]">');
    editor.getEditorState().read(() => {
      const block = $getRoot().getFirstChild();
      expect($isElementNode(block) && block.getStyle()).toContain(
        "line-height: 1.8"
      );
      expect($getRoot().getAllTextNodes()[0].getStyle()).not.toContain(
        "line-height"
      );
    });
  });
  it("preserves Edit mode text alignment through canvas text edits", () => {
    for (const alignment of ["left", "center", "right", "justify"]) {
      const original = `<p className="text-${alignment}">hello</p>`;
      const first = roundtrip(original);
      expect(first.jsx).toContain(`text-${alignment}`);
      expect(roundtrip(first.jsx).jsx).toContain(`text-${alignment}`);
    }
  });
  it("preserves literal entities and braces", () => {
    let jsx = "<p>&amp;lt; &#123;x&#125; &amp; y</p>";
    for (let i = 0; i < 3; i++) {
      jsx = roundtrip(jsx).jsx;
      expect(jsx).toBe("<p>&amp;lt; &#123;x&#125; &amp; y</p>");
    }
  });
  it("imports line breaks and bare text without failing root.append", () => {
    // Regression: multi-line text serializes empty lines as a top-level
    // <br />, which Lexical's root rejects unless it is wrapped in a paragraph.
    const broken = roundtrip("<p>one</p><br /><p>two</p>");
    expect(broken.jsx).toContain("<br />");
    broken.editor.getEditorState().read(() => {
      expect(
        $getRoot()
          .getChildren()
          .every((node) => $isElementNode(node))
      ).toBe(true);
    });

    const inline = roundtrip("first<br />second");
    expect(inline.jsx).toContain("<br />");
  });
});

import { getDescendantAstIndices } from "@/utils/ast-indexer";
import {
  extractJsxClassNamesByAstIndex,
  updateJsxClassNameByAstIndex,
} from "@/utils/ast-modifier-v2";
import { extractInnerJsx, wrapInnerJsx } from "@/utils/html-to-jsx";
import { resetInnerJsxToPlainText } from "@/utils/rich-text";
import {
  generateTailwindClass,
  getConflictingClasses,
  getFontWeightFromClasses,
  getLetterSpacingFromClasses,
  getWordSpacingFromClasses,
  type StyleProperty,
} from "@/utils/tailwind-mapping";
import {
  typographyFromClasses,
  typographyRootStyle,
} from "@/utils/text-typography";
import {
  updateTextAlignmentCode,
  updateTypographyCode,
} from "@/utils/typography-commit";

describe("Line height in the live text editor", () => {
  it("keeps fixed Tailwind leading as spacing instead of treating it as a percent", () => {
    expect(typographyRootStyle(["leading-6"], "light").lineHeight).toBe(
      "calc(var(--spacing) * 6)"
    );
    expect(typographyRootStyle(["light:leading-7"], "light").lineHeight).toBe(
      "calc(var(--spacing) * 7)"
    );
    expect(typographyRootStyle(["leading-normal"], "light").lineHeight).toBe(
      "1.5"
    );
  });

  it("imports paragraph leading classes at their displayed height", () => {
    const fixed = richTextJsxToEditorDom(
      '<p className="leading-6">first<br />second</p>'
    );
    expect(
      fixed.querySelector<HTMLParagraphElement>("p")?.style.lineHeight
    ).toBe("calc(var(--spacing) * 6)");
    const arbitrary = richTextJsxToEditorDom(
      '<p className="leading-[1.8]">first<br />second</p>'
    );
    expect(
      arbitrary.querySelector<HTMLParagraphElement>("p")?.style.lineHeight
    ).toBe("1.8");
  });
});

describe("Shared block typography commits", () => {
  it("replaces nested alignment while preserving other typography", () => {
    const code =
      'export default function Text() { return <div className="text-left text-2xl"><p className="text-right font-bold">one</p><p className="text-center">two</p></div>; }';
    const updated = updateTextAlignmentCode(code, "justify");
    expect(updated).toContain("text-2xl text-justify");
    expect(updated).not.toContain("text-left");
    expect(updated).not.toContain("text-right");
    expect(updated).not.toContain("text-center");
    expect(updated).toContain("font-bold");
  });
  it("targets a captured element without changing the root or rich-text children", () => {
    const code =
      'export default function Component() { return <div className="font-serif"><p className="text-base"><span className="font-bold">Hello</span></p></div>; }';
    const updated = updateTypographyCode(code, 1, "fontSize", 23, "light");
    expect(extractJsxClassNamesByAstIndex(updated, 0)).toEqual(["font-serif"]);
    expect(extractJsxClassNamesByAstIndex(updated, 1)).toContain("text-[23px]");
    expect(extractJsxClassNamesByAstIndex(updated, 2)).toEqual(["font-bold"]);
  });
  it("keeps the opposite theme color when changing one mode", () => {
    const code =
      'export default function Component() { return <div className="light:text-red-500 dark:text-blue-500">Hello</div>; }';
    const updated = updateTypographyCode(
      code,
      0,
      "textColor",
      "#123456",
      "light"
    );
    const classes = extractJsxClassNamesByAstIndex(updated, 0);
    expect(classes).toContain("dark:text-blue-500");
    expect(classes).toContain("light:text-[#123456]");
    expect(classes).not.toContain("light:text-red-500");
  });
  it("preserves exact letter spacing and independent arbitrary font weights", () => {
    const cls = generateTailwindClass("letterSpacing", 0.037, "light")!;
    expect(getLetterSpacingFromClasses([cls])).toBe(0.037);
    expect(getConflictingClasses("letterSpacing", [cls])).toEqual([cls]);
    expect(
      getConflictingClasses("fontFamily", ["font-['Brand_Font']", "font-[450]"])
    ).toEqual(["font-['Brand_Font']"]);
  });
  it("reads the editor's arbitrary CSS-property vocabulary", () => {
    expect(getFontWeightFromClasses(["[font-weight:450]"])).toBe(450);
    expect(getLetterSpacingFromClasses(["[letter-spacing:0.037em]"])).toBe(
      0.037
    );
    expect(getWordSpacingFromClasses(["[word-spacing:-0.05em]"])).toBe(-0.05);
    const values = typographyFromClasses(
      [
        "[font-size:23px]",
        "[font-weight:600]",
        "[word-spacing:0.2em]",
        "[font-style:italic]",
        "[text-decoration:underline]",
      ],
      "light"
    );
    expect(values.fontSize).toBe("23");
    expect(values.fontWeight).toBe("600");
    expect(values.wordSpacing).toBe("0.2");
    expect(values.fontStyle).toBe("italic");
    expect(values.textDecoration).toBe("underline");
  });
  it("removes className entirely when a reset clears every class", () => {
    const code =
      'export default function Text() { return <div className="text-foreground"><p><span className="[font-weight:900] italic">edit</span></p></div>; }';
    const updated = updateJsxClassNameByAstIndex(
      code,
      2,
      [],
      ["[font-weight:900]", "italic"]
    );
    expect(updated).toContain("<span>edit</span>");
    expect(updated).not.toContain('className=""');
  });

  it("full reset strips typography and collapses structure to plain paragraphs", () => {
    const code = `export default function Text() {
  return (
    <div className="text-foreground min-w-[1ch] break-words whitespace-pre-wrap tracking-tighter italic [word-spacing:0.5em] font-['Agbalumo']">
      <p>Double click to <span className="[font-weight:900] [letter-spacing:0.295em]">edit</span> text</p><br /><p><span className="[font-size:36px]">Hello</span></p><br /><h1 className="text-3xl font-bold">This is some more text</h1>
    </div>
  );
}`;
    const propsToReset: StyleProperty[] = [
      "fontSize",
      "fontWeight",
      "fontFamily",
      "lineHeight",
      "letterSpacing",
      "wordSpacing",
      "fontStyle",
      "textDecoration",
      "textColor",
    ];
    const astIndices = [0, ...getDescendantAstIndices(code, 0)];
    let updated = code;
    for (const astIndex of astIndices) {
      const classes = extractJsxClassNamesByAstIndex(updated, astIndex);
      const classesToRemove = propsToReset.flatMap((prop) =>
        getConflictingClasses(prop, classes)
      );
      if (classesToRemove.length) {
        updated = updateJsxClassNameByAstIndex(
          updated,
          astIndex,
          [],
          classesToRemove
        );
      }
    }
    updated = wrapInnerJsx(
      updated,
      resetInnerJsxToPlainText(extractInnerJsx(updated))
    );

    // Layout classes on the block survive; every typography class is gone.
    expect(updated).toContain(
      '<div className="min-w-[1ch] break-words whitespace-pre-wrap">'
    );
    // Spans unwrap and the heading collapses back to a paragraph.
    expect(updated).toContain(
      "<p>Double click to edit text</p><br /><p>Hello</p><br /><p>This is some more text</p>"
    );
    expect(updated).not.toContain("<span");
    expect(updated).not.toContain("<h1");
  });

  it("overrides per-run typography in descendants at block scope", () => {
    const code =
      'export default function Text() { return <div className="text-foreground"><p><span className="text-xl font-bold">Hi</span></p></div>; }';
    expect(getDescendantAstIndices(code, 0)).toEqual([1, 2]);

    const sized = updateTypographyCode(
      code,
      0,
      "fontSize",
      30,
      "light",
      undefined,
      { stripDescendants: true }
    );
    expect(extractJsxClassNamesByAstIndex(sized, 0)).toContain("text-3xl");
    expect(extractJsxClassNamesByAstIndex(sized, 2)).not.toContain("text-xl");
    // A font-size commit must not disturb the child's font weight.
    expect(extractJsxClassNamesByAstIndex(sized, 2)).toContain("font-bold");

    const weighted = updateTypographyCode(
      code,
      0,
      "fontWeight",
      700,
      "light",
      undefined,
      { stripDescendants: true }
    );
    expect(extractJsxClassNamesByAstIndex(weighted, 2)).not.toContain(
      "font-bold"
    );
  });
  it("strips arbitrary CSS-property run overrides at block scope", () => {
    const code =
      'export default function Text() { return <div className="text-foreground"><p><span className="[font-weight:600] [font-size:23px]">Hi</span></p></div>; }';

    // The editor's arbitrary CSS-property vocabulary must register as conflicting.
    expect(getConflictingClasses("fontWeight", ["[font-weight:600]"])).toEqual([
      "[font-weight:600]",
    ]);
    expect(getConflictingClasses("fontSize", ["[font-size:23px]"])).toEqual([
      "[font-size:23px]",
    ]);

    const weighted = updateTypographyCode(
      code,
      0,
      "fontWeight",
      700,
      "light",
      undefined,
      { stripDescendants: true }
    );
    // The run-level weight override is removed so the block weight wins.
    expect(extractJsxClassNamesByAstIndex(weighted, 2)).not.toContain(
      "[font-weight:600]"
    );
    // Unrelated run typography survives the strip.
    expect(extractJsxClassNamesByAstIndex(weighted, 2)).toContain(
      "[font-size:23px]"
    );
  });
});
