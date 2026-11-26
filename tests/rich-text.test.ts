import { describe, expect, it } from "vitest";
import { extractInnerJsx, wrapInnerJsx } from "@/utils/html-to-jsx";
import {
  getInnerJsxBlockType,
  getSharedBlockClasses,
  resetInnerJsxToPlainText,
  richTextHtmlToJsx,
  richTextJsxToEditorDom,
  setInnerJsxBlockType,
} from "@/utils/rich-text";

describe("richTextHtmlToJsx (Lexical HTML -> Tailwind JSX)", () => {
  it("maps inline formats to Tailwind spans", () => {
    expect(richTextHtmlToJsx("<p>Hello <strong>world</strong></p>")).toBe(
      '<p>Hello <span className="font-bold">world</span></p>'
    );
    expect(richTextHtmlToJsx("<p>a <em>b</em> <u>c</u> <s>d</s></p>")).toBe(
      '<p>a <span className="italic">b</span> <span className="underline">c</span> <span className="line-through">d</span></p>'
    );
  });

  it("converts empty paragraphs into line breaks", () => {
    expect(richTextHtmlToJsx("<p><br></p>")).toBe("<br />");
    expect(richTextHtmlToJsx("<p>one</p><p><br></p>")).toBe("<p>one</p><br />");
  });

  it("maps headings, quotes, lists and links", () => {
    expect(richTextHtmlToJsx("<h1>Title</h1>")).toBe(
      '<h1 className="text-3xl font-bold">Title</h1>'
    );
    expect(richTextHtmlToJsx("<ul><li>a</li><li>b</li></ul>")).toBe(
      '<ul className="list-disc pl-5"><li>a</li><li>b</li></ul>'
    );
    expect(richTextHtmlToJsx('<a href="https://x.dev">x</a>')).toBe(
      '<a href="https://x.dev" className="text-primary underline">x</a>'
    );
  });

  it("escapes characters that are significant in JSX text", () => {
    const out = richTextHtmlToJsx("<p>a {b} &lt; c</p>");
    expect(out).toContain("&#123;b&#125;");
    expect(out).toContain("&lt;");
  });

  it("returns an empty string for empty input", () => {
    expect(richTextHtmlToJsx("")).toBe("");
  });

  it("flattens duplicate italic wrappers and equivalent CSS declarations", () => {
    expect(
      richTextHtmlToJsx(
        '<p><i><span class="italic" style="font-style:italic;font-weight:400">hello </span></i></p>'
      )
    ).toBe('<p><span className="italic [font-weight:400]">hello </span></p>');
  });

  it("merges adjacent matching spans without losing spaces or escaping", () => {
    expect(
      richTextHtmlToJsx(
        "<p><i>Hello </i><i>{world} &amp; </i><i>friends</i></p>"
      )
    ).toBe(
      '<p><span className="italic">Hello &#123;world&#125; &amp; friends</span></p>'
    );
    expect(
      richTextHtmlToJsx(
        '<p><u>a </u><u>b</u><span style="font-size:36px">c </span><span style="font-size:36px">d</span></p>'
      )
    ).toBe(
      '<p><span className="underline">a b</span><span className="[font-size:36px]">c d</span></p>'
    );
  });

  it("shares italic formatting around runs with different sizes and spacing", () => {
    expect(
      richTextHtmlToJsx(
        '<p><i>first </i><i><span style="font-size:36px">large</span></i><i> last</i></p>'
      )
    ).toBe(
      '<p><span className="italic">first <span className="[font-size:36px]">large</span> last</span></p>'
    );
  });

  it("keeps explicit overrides and link, code, break and paragraph boundaries", () => {
    const out = richTextHtmlToJsx(
      '<p><i>a<span style="font-style:normal">normal<i>italic</i></span>b</i><br><i>c</i><a href="/x"><i>d</i></a><code>e</code></p><p><i>f</i></p>'
    );
    expect(out).toContain(
      'a<span className="not-italic">normal<span className="italic">italic</span></span>b'
    );
    expect(out).toContain(
      '</span><br /><span className="italic">c</span><a href="/x"'
    );
    expect(out).toContain(
      '<code className="font-mono text-sm bg-muted px-1 py-0.5 rounded">e</code></p><p><span className="italic">f</span></p>'
    );
  });

  it("does not move relative sizes or combine different decorations", () => {
    expect(
      richTextHtmlToJsx(
        '<p><span style="font-size:2em"><span style="font-size:2em">big</span></span><u><s>both</s></u></p>'
      )
    ).toBe(
      '<p><span className="[font-size:2em]"><span className="[font-size:2em]">big</span></span><span className="underline"><span className="line-through">both</span></span></p>'
    );
  });

  it("deduplicates equivalent weight declarations while keeping explicit normal overrides", () => {
    expect(
      richTextHtmlToJsx(
        '<p><strong style="font-weight:700">bold<span style="font-weight:400"> normal</span></strong></p>'
      )
    ).toBe(
      '<p><span className="font-bold">bold<span className="[font-weight:400]"> normal</span></span></p>'
    );
  });

  it("leaves layout classes and relative font weights on their original spans", () => {
    expect(
      richTextHtmlToJsx(
        '<p><span class="inline-block italic">a</span><span class="inline-block italic">b</span><span style="font-weight:bolder"><span style="font-weight:bolder">c</span></span></p>'
      )
    ).toBe(
      '<p><span className="inline-block italic">a</span><span className="inline-block italic">b</span><span className="[font-weight:bolder]"><span className="[font-weight:bolder]">c</span></span></p>'
    );
  });
});

describe("Text component code wrapping", () => {
  it("preserves literal dollar replacement markers in edited text", () => {
    const code =
      'export default function Text() { return (<div className="text-base">old</div>); }';
    const inner = "<p>$& $' $` $1</p>";
    expect(extractInnerJsx(wrapInnerJsx(code, inner))).toBe(inner);
  });
});

describe("richTextJsxToEditorDom (Tailwind JSX -> Lexical DOM)", () => {
  it("normalizes Tailwind span classes back to semantic tags", () => {
    const doc = richTextJsxToEditorDom(
      '<p>x <span className="font-bold">b</span> <span className="italic">i</span></p>'
    );
    expect(doc.body.querySelector("strong")?.textContent).toBe("b");
    expect(doc.body.querySelector("em")?.textContent).toBe("i");
  });

  it("wraps loose text in a block so Lexical can import it", () => {
    const doc = richTextJsxToEditorDom("just text");
    expect(doc.body.querySelector("p")?.textContent).toBe("just text");
  });

  it("preserves headings and lists", () => {
    const doc = richTextJsxToEditorDom("<h2>Hi</h2><ul><li>a</li></ul>");
    expect(doc.body.querySelector("h2")?.textContent).toBe("Hi");
    expect(doc.body.querySelectorAll("li")).toHaveLength(1);
  });

  it("wraps top-level line breaks and bare text into paragraphs", () => {
    // Empty paragraphs serialize to a top-level <br />, and text can sit next
    // to blocks; both must end up inside a paragraph or Lexical's root.append
    // throws "Only element or decorator nodes can be inserted to the root node".
    const doc = richTextJsxToEditorDom("<p>one</p><br /><p>two</p>");
    expect(doc.body.children).toHaveLength(3);
    expect(
      Array.from(doc.body.children).every(
        (child) => child.tagName.toLowerCase() === "p"
      )
    ).toBe(true);

    const inline = richTextJsxToEditorDom("first<br />second");
    expect(inline.body.children).toHaveLength(1);
    expect(inline.body.firstElementChild?.tagName.toLowerCase()).toBe("p");
    expect(inline.body.querySelector("br")).not.toBeNull();
  });

  it("does not turn formatting whitespace into empty paragraphs", () => {
    const doc = richTextJsxToEditorDom("\n  <p>a</p>\n  <p>b</p>\n");
    expect(
      Array.from(doc.body.children).map((child) => child.tagName.toLowerCase())
    ).toEqual(["p", "p"]);
  });
});

describe("resetInnerJsxToPlainText", () => {
  it("collapses headings, quotes, lists and empty spans to plain paragraphs", () => {
    expect(
      resetInnerJsxToPlainText(
        "<p>a <span>edit</span> b</p><br /><h1>Hello</h1><ul><li>x</li><li>y</li></ul><blockquote>q</blockquote>"
      )
    ).toBe("<p>a edit b</p><br /><p>Hello</p><p>x</p><p>y</p><p>q</p>");
  });

  it("keeps meaningful attributes such as links", () => {
    expect(
      resetInnerJsxToPlainText('<p>link <a href="https://x.dev">x</a></p>')
    ).toBe(
      '<p>link <a href="https://x.dev" className="text-primary underline">x</a></p>'
    );
  });

  it("unwraps inline code even though it carries chrome classes", () => {
    expect(
      resetInnerJsxToPlainText(
        '<p>x <code class="font-mono text-sm bg-muted px-1 py-0.5 rounded">y</code> z</p>'
      )
    ).toBe("<p>x y z</p>");
  });
});

describe("setInnerJsxBlockType", () => {
  it("turns every paragraph into a heading", () => {
    expect(setInnerJsxBlockType("<p>One</p><p>Two</p>", "h1")).toBe(
      '<h1 className="text-3xl font-bold">One</h1><h1 className="text-3xl font-bold">Two</h1>'
    );
  });

  it("drops the old heading size/weight but keeps alignment", () => {
    expect(
      setInnerJsxBlockType(
        '<h1 className="text-3xl font-bold text-center">Title</h1>',
        "paragraph"
      )
    ).toBe('<p className="text-center">Title</p>');
  });

  it("wraps loose text and leaves lists alone", () => {
    expect(setInnerJsxBlockType("Hello <strong>you</strong>", "h2")).toBe(
      '<h2 className="text-2xl font-bold">Hello <span className="font-bold">you</span></h2>'
    );
    expect(setInnerJsxBlockType("<p>a</p><ul><li>x</li></ul>", "h3")).toContain(
      "<ul"
    );
  });
});

describe("getInnerJsxBlockType", () => {
  it("reports the shared type or null when blocks differ", () => {
    expect(getInnerJsxBlockType("<p>a</p><br /><p>b</p>")).toBe("paragraph");
    expect(getInnerJsxBlockType("plain text")).toBe("paragraph");
    expect(getInnerJsxBlockType('<h2 className="x">a</h2>')).toBe("h2");
    expect(getInnerJsxBlockType("<h1>a</h1><p>b</p>")).toBeNull();
  });
});

describe("getSharedBlockClasses", () => {
  it("returns the classes every block carries", () => {
    expect(
      getSharedBlockClasses(
        '<h1 className="text-3xl font-bold">a</h1><br /><h1 className="text-3xl font-bold text-center">b</h1>'
      )
    ).toEqual(["text-3xl", "font-bold"]);
  });

  it("returns nothing for mixed blocks or loose text", () => {
    expect(
      getSharedBlockClasses('<h1 className="text-3xl font-bold">a</h1><p>b</p>')
    ).toEqual([]);
    expect(getSharedBlockClasses("plain")).toEqual([]);
  });
});
