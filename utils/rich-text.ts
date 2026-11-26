import { FONT_WEIGHT_MAP } from "./tailwind-mapping";
import {
  importTypographyClasses,
  typographyStyleClasses,
} from "./text-typography";

/**
 * Deterministic rich-text (de)serialization for the Luova text tool.
 *
 * The text tool edits the *inner* JSX of a `Text` component. While editing,
 * Lexical owns the document model; on commit we serialize it back to Luova's
 * canonical Tailwind-JSX markup. These helpers use the DOM as the parser
 * instead of regexes over markup, which is what made the previous
 * `contentEditable` round-trip lossy and fragile.
 *
 * Canonical JSX vocabulary (what this module emits / understands):
 *   - paragraphs          -> <p>…</p>          (empty paragraph -> <br />)
 *   - bold                -> <span className="font-bold">…</span>
 *   - italic              -> <span className="italic">…</span>
 *   - underline           -> <span className="underline">…</span>
 *   - strikethrough       -> <span className="line-through">…</span>
 *   - inline code         -> <code className="…">…</code>
 *   - headings            -> <h1>…<h6> with explicit size/weight classes
 *   - blockquote          -> <blockquote className="…">…</blockquote>
 *   - lists               -> <ul>/<ol> with marker + indent classes
 *   - links               -> <a href="…" className="…">…</a>
 */

const INLINE_CLASS_TO_TAG: Record<string, string> = {
  italic: "em",
  underline: "u",
  "line-through": "s",
};

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "hr",
  "table",
]);

/** Block tags collapsed to `<p>` by a formatting reset. */
const RESET_BLOCK_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
]);

/** Inline tags unwrapped by a formatting reset once they carry nothing. */
const RESET_UNWRAP_TAGS = new Set([
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "code",
]);

/**
 * Parse a Text node's inner JSX into a DOM `Document` that Lexical's
 * `$generateNodesFromDOM` can consume. Tailwind formatting classes are
 * translated back to their semantic HTML tags so Lexical recognises them.
 */
export function richTextJsxToEditorDom(jsx: string): Document {
  // JSX uses `className`; HTML (and Lexical's importer) uses `class`.
  const normalized = jsx
    .replace(/\bclassName=/g, "class=")
    .replace(/\bhtmlFor=/g, "for=");

  const doc = new DOMParser().parseFromString(
    `<div data-luova-import-root>${normalized}</div>`,
    "text/html"
  );

  const root = doc.querySelector("[data-luova-import-root]");
  if (root) {
    normalizeForImport(root);
    doc.body.innerHTML = root.innerHTML;
  }

  ensureBlockStructure(doc);
  return doc;
}

/**
 * Convert Lexical-exported HTML into Luova's canonical Tailwind-JSX markup.
 */
export function richTextHtmlToJsx(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  normalizeInlineFormatting(doc.body);
  const parts: string[] = [];
  for (const child of Array.from(doc.body.childNodes)) {
    const out = serializeNode(child);
    if (out) parts.push(out);
  }
  return parts.join("").trim();
}

const INLINE_FORMAT_CLASSES: Record<string, string> = {
  strong: "font-bold",
  b: "font-bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "line-through",
  strike: "line-through",
  del: "line-through",
};

function canonicalClasses(classes: string[]): string[] {
  const aliases: Record<string, string> = {
    "[font-style:italic]": "italic",
    "[font-style:normal]": "not-italic",
    "[text-decoration:underline]": "underline",
    "[text-decoration:line-through]": "line-through",
    "[text-decoration:none]": "no-underline",
  };
  const unique = [...new Set(classes.map((cls) => aliases[cls] ?? cls))];
  return unique.filter((cls) => {
    const weight = cls.match(/^\[font-weight:(\d+)\]$/)?.[1];
    return (
      !weight ||
      !unique.some((other) => FONT_WEIGHT_MAP[other] === Number(weight))
    );
  });
}

// Only these inherited properties can be moved between inline spans. In
// particular, decorations propagate rather than inherit, and relative sizes
// and spacing can change meaning when moved to a different parent.
function sharedInlineProperty(cls: string): string | undefined {
  if (cls === "italic" || cls === "not-italic") return "font-style";
  if (Object.hasOwn(FONT_WEIGHT_MAP, cls)) return "font-weight";
  if (/^\[font-weight:(\d+|normal|bold)\]$/.test(cls)) return "font-weight";
  return cls.match(/^\[(font-style|font-family):/)?.[1];
}

function flattenInlineProperty(cls: string): string | undefined {
  if (["underline", "line-through", "no-underline"].includes(cls))
    return "text-decoration";
  return sharedInlineProperty(cls);
}

function spanClasses(node: Node | null): string[] | null {
  if (!(node instanceof HTMLElement) || node.tagName !== "SPAN") return null;
  if (Array.from(node.attributes).some((attr) => attr.name !== "class"))
    return null;
  const classes = Array.from(node.classList);
  // Layout, backgrounds and other unknown utilities may depend on the number
  // or nesting of elements, so leave those spans as consolidation boundaries.
  return classes.every(
    (cls) =>
      flattenInlineProperty(cls) ||
      /^\[(font-size|line-height|letter-spacing|word-spacing|color|text-decoration):/.test(
        cls
      )
  )
    ? classes
    : null;
}

function setSpanClasses(span: Element, classes: string[]): void {
  if (classes.length) span.setAttribute("class", classes.join(" "));
  else span.removeAttribute("class");
}

function unwrapSpan(span: Element): void {
  span.replaceWith(...Array.from(span.childNodes));
}

function normalizeInlineFormatting(container: Element): void {
  const doc = container.ownerDocument;
  for (const element of Array.from(container.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    const format = INLINE_FORMAT_CLASSES[tag];
    if (tag !== "span" && !format) continue;
    const style = (element as HTMLElement).style;
    const alignment = /^(left|center|right|justify)$/.test(style.textAlign)
      ? [`text-${style.textAlign}`]
      : [];
    const classes = canonicalClasses([
      ...Array.from(element.classList),
      ...(format ? [format] : []),
      ...alignment,
      ...typographyStyleClasses(style),
    ]);
    // Match the serializer's inline vocabulary; editor DOM attributes are not
    // part of the saved JSX.
    const span = doc.createElement("span");
    setSpanClasses(span, classes);
    span.append(...Array.from(element.childNodes));
    element.replaceWith(span);
  }

  const consolidate = (parent: Element, inherited: Set<string>) => {
    for (const child of Array.from(parent.children)) {
      const classes = spanClasses(child);
      if (classes) {
        const own = classes.filter(
          (cls) => !flattenInlineProperty(cls) || !inherited.has(cls)
        );
        setSpanClasses(child, own);
        // A nearer override must mask the same property on an ancestor.
        const properties = new Set(
          own.map(flattenInlineProperty).filter(Boolean)
        );
        const next = new Set(
          [...inherited].filter(
            (cls) => !properties.has(flattenInlineProperty(cls))
          )
        );
        for (const cls of own) if (flattenInlineProperty(cls)) next.add(cls);
        consolidate(child, next);
        const onlyChild =
          child.childNodes.length === 1 ? child.firstChild : null;
        const inner = spanClasses(onlyChild);
        if (inner) {
          // Collapse only when no property is overridden. Keep unknown classes
          // and decoration combinations on their original elements.
          const combined = canonicalClasses([...own, ...inner]);
          const keys = combined.map(flattenInlineProperty);
          if (keys.every(Boolean) && new Set(keys).size === combined.length) {
            setSpanClasses(child, combined);
            unwrapSpan(onlyChild as Element);
          }
        }
        if (!child.getAttribute("class")) unwrapSpan(child);
      } else {
        // Links, code and blocks retain their own formatting boundaries.
        consolidate(child, new Set());
      }
    }

    let node = parent.firstChild;
    while (node) {
      const classes = spanClasses(node);
      if (!classes) {
        node = node.nextSibling;
        continue;
      }
      const siblings: Element[] = [node as Element];
      let common = classes.filter((cls) => sharedInlineProperty(cls));
      let next = node.nextSibling;
      while (next) {
        const nextClasses = spanClasses(next);
        if (!nextClasses) break;
        const intersection = common.filter((cls) => nextClasses.includes(cls));
        // Identical spans can merge even for non-inherited formatting, since
        // the wrapper stays at the same level and keeps exactly those classes.
        const identical =
          classes.length === nextClasses.length &&
          classes.every((cls) => nextClasses.includes(cls));
        if (!intersection.length && !(siblings.length === 1 && identical))
          break;
        if (siblings.length === 1 && identical) {
          (node as Element).append(...Array.from(next.childNodes));
          const following = next.nextSibling;
          next.remove();
          next = following;
          continue;
        }
        common = intersection;
        siblings.push(next as Element);
        next = next.nextSibling;
      }
      if (siblings.length > 1) {
        const wrapper = doc.createElement("span");
        setSpanClasses(wrapper, common);
        parent.insertBefore(wrapper, node);
        wrapper.append(...siblings);
        consolidate(wrapper, new Set(common));
      }
      node = next;
    }
  };
  consolidate(container, new Set());
}

/**
 * Collapse a text block's inner JSX to plain paragraphs. Used by "Reset text
 * formatting": headings/quotes/list items become paragraphs, list wrappers are
 * dropped, and inline formatting elements (spans/`strong`/`em`/…) that have
 * nothing left to carry are unwrapped. Attributes are preserved, so the block's
 * own layout classes survive; pass inner JSX that has already had its typography
 * classes stripped.
 */
export function resetInnerJsxToPlainText(jsx: string): string {
  const normalized = jsx
    .replace(/\bclassName=/g, "class=")
    .replace(/\bhtmlFor=/g, "for=");
  const doc = new DOMParser().parseFromString(
    `<div>${normalized}</div>`,
    "text/html"
  );
  const container = doc.querySelector("div");
  if (!container) return jsx;

  for (const el of Array.from(container.querySelectorAll("*"))) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    const parent = el.parentNode;
    if (!parent) continue;
    if (RESET_BLOCK_TAGS.has(tag)) {
      const paragraph = doc.createElement("p");
      for (const child of Array.from(el.childNodes)) paragraph.append(child);
      el.replaceWith(paragraph);
    } else if (tag === "ul" || tag === "ol") {
      for (const child of Array.from(el.childNodes))
        parent.insertBefore(child, el);
      parent.removeChild(el);
    } else if (
      RESET_UNWRAP_TAGS.has(tag) &&
      // Inline code is a formatting construct: unwrap it even though it
      // carries non-typography chrome classes (bg/padding/rounded).
      (tag === "code" ||
        (!el.getAttribute("class") &&
          !el.getAttribute("style") &&
          !el.getAttribute("href")))
    ) {
      for (const child of Array.from(el.childNodes))
        parent.insertBefore(child, el);
      parent.removeChild(el);
    }
  }

  return richTextHtmlToJsx(container.innerHTML);
}

/** Size/weight classes each heading tag is serialized with. */
const HEADING_CLASSES: Record<string, string[]> = {
  h1: ["text-3xl", "font-bold"],
  h2: ["text-2xl", "font-bold"],
  h3: ["text-xl", "font-bold"],
  h4: ["text-lg", "font-bold"],
  h5: ["text-base", "font-bold"],
  h6: ["text-sm", "font-bold"],
};

/** Top-level blocks whose type the block buttons can switch. */
const SWITCHABLE_BLOCKS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function parseInner(jsx: string) {
  const normalized = jsx
    .replace(/\bclassName=/g, "class=")
    .replace(/\bhtmlFor=/g, "for=");
  const doc = new DOMParser().parseFromString(
    `<div>${normalized}</div>`,
    "text/html"
  );
  return { doc, container: doc.querySelector("div") };
}

/**
 * Block type shared by every top-level block of a text element ("paragraph",
 * "h1"…), or null when they differ. Lets the block buttons show the whole
 * element's type when no editor is open.
 */
export function getInnerJsxBlockType(
  jsx: string
): "paragraph" | "h1" | "h2" | "h3" | null {
  const { container } = parseInner(jsx);
  if (!container) return null;
  const types = new Set<string>();
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) continue;
    const tag =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element).tagName.toLowerCase()
        : "p";
    if (tag === "br") continue;
    // A div reads as a paragraph, loose inline content too; lists/quotes
    // keep their own tag so a mix of them reports "differs" (null).
    if (tag === "div") types.add("p");
    else if (SWITCHABLE_BLOCKS.has(tag) || BLOCK_TAGS.has(tag)) types.add(tag);
    else types.add("p");
  }
  if (types.size !== 1) return null;
  const [only] = types;
  if (only === "p" || only === "div") return "paragraph";
  return only === "h1" || only === "h2" || only === "h3" ? only : null;
}

/**
 * Classes carried by every top-level block of a text element (e.g. an H1's
 * `text-3xl font-bold`). They override the element's own classes in CSS, so
 * the panel reads them on top to show what the text actually looks like.
 */
export function getSharedBlockClasses(jsx: string): string[] {
  const { container } = parseInner(jsx);
  if (!container) return [];
  let shared: string[] | null = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      // Loose text has no classes of its own: nothing is shared.
      if (node.textContent?.trim()) return [];
      continue;
    }
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") continue;
    if (!SWITCHABLE_BLOCKS.has(tag)) return [];
    const classes = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    shared = shared ? shared.filter((c) => classes.includes(c)) : classes;
    if (!shared.length) return [];
  }
  return shared ?? [];
}

/**
 * Turn every top-level paragraph/heading of a text element into `type`, for
 * the block buttons when no editor selection exists. The old heading's
 * size/weight classes go with it (an H1 turned back into a paragraph isn't
 * left big and bold); alignment and other classes stay. Loose inline content
 * is wrapped in a block; lists and quotes are left alone.
 */
export function setInnerJsxBlockType(
  jsx: string,
  type: "paragraph" | "h1" | "h2" | "h3"
): string {
  const { doc, container } = parseInner(jsx);
  if (!container) return jsx;
  const tag = type === "paragraph" ? "p" : type;

  let loose: Element | null = null;
  for (const node of Array.from(container.childNodes)) {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    const name = el?.tagName.toLowerCase();
    if (el && name && SWITCHABLE_BLOCKS.has(name)) {
      loose = null;
      const next = doc.createElement(tag);
      for (const attr of Array.from(el.attributes)) {
        next.setAttribute(attr.name, attr.value);
      }
      const drop = HEADING_CLASSES[name] ?? [];
      for (const cls of drop) next.classList.remove(cls);
      // The serializer reads alignment from style, so carry a text-* class
      // across as text-align.
      for (const cls of Array.from(next.classList)) {
        const align = /^text-(left|center|right|justify)$/.exec(cls)?.[1];
        if (align) {
          (next as HTMLElement).style.textAlign = align;
          next.classList.remove(cls);
        }
      }
      if (next.getAttribute("class") === "") next.removeAttribute("class");
      for (const child of Array.from(el.childNodes)) next.append(child);
      el.replaceWith(next);
    } else if (el && name && (BLOCK_TAGS.has(name) || name === "br")) {
      loose = null; // lists, quotes, empty lines: leave as they are
    } else if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      // whitespace between blocks
    } else {
      // Inline content outside any block: gather it into one.
      if (!loose) {
        loose = doc.createElement(tag);
        container.insertBefore(loose, node);
      }
      loose.append(node);
    }
  }
  return richTextHtmlToJsx(container.innerHTML);
}

function normalizeForImport(container: Element): void {
  const doc = container.ownerDocument;
  // `querySelectorAll` returns document order (outer elements first) — ideal
  // for a single-pass rewrite since replacing outer nodes preserves children.
  for (const el of Array.from(container.querySelectorAll("*"))) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    importTypographyClasses(el as HTMLElement);
    if (tag !== "span") continue;
    const formats = Object.entries(INLINE_CLASS_TO_TAG)
      .filter(([cls]) => el.classList.contains(cls))
      .map(([, tag]) => tag);
    // Only bold is semantic bold. Other numeric weights must remain exact.
    if (el.classList.contains("font-bold")) formats.unshift("strong");
    for (const format of formats) {
      const wrapper = doc.createElement(format);
      while (el.firstChild) wrapper.appendChild(el.firstChild);
      el.appendChild(wrapper);
    }
  }
}

function ensureBlockStructure(doc: Document): void {
  const body = doc.body;
  const hasBlock = Array.from(body.children).some((child) =>
    BLOCK_TAGS.has(child.tagName.toLowerCase())
  );

  // Formatting whitespace between top-level blocks (newlines/indentation in the
  // source JSX) must not become spurious empty paragraphs.
  if (hasBlock) {
    for (const node of Array.from(body.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
        node.remove();
      }
    }
  }

  if (!body.textContent?.trim() && !body.querySelector("br")) return;

  // Lexical's root only accepts element/decorator nodes. Around line breaks the
  // inner JSX contains a top-level <br /> (empty paragraphs serialize to that)
  // or bare text next to blocks; left as-is, `$generateNodesFromDOM` returns a
  // text/linebreak node that `root.append` rejects. Wrap every run of top-level
  // inline/text nodes into a paragraph.
  let paragraph: HTMLElement | null = null;
  for (const node of Array.from(body.childNodes)) {
    const isBlock =
      node.nodeType === Node.ELEMENT_NODE &&
      BLOCK_TAGS.has((node as Element).tagName.toLowerCase());
    if (isBlock) {
      paragraph = null;
      continue;
    }
    if (!paragraph) {
      paragraph = doc.createElement("p");
      body.insertBefore(paragraph, node);
    }
    paragraph.appendChild(node);
  }
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeJsxText(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const styleClasses = typographyStyleClasses(el.style);
  const attrs = (base = "") => {
    const alignment = el.style.textAlign;
    const alignmentClass = /^(left|center|right|justify)$/.test(alignment)
      ? `text-${alignment}`
      : "";
    const classes = canonicalClasses(
      [base, alignmentClass, ...styleClasses]
        .filter(Boolean)
        .flatMap((value) => value.split(/\s+/))
    ).join(" ");
    return classes ? ` className="${escapeAttr(classes)}"` : "";
  };
  const children = () => Array.from(el.childNodes).map(serializeNode).join("");

  switch (tag) {
    case "br":
      return "<br />";
    case "p":
    case "div": {
      const inner = children();
      if (!inner.trim() || inner.trim() === "<br />") return "<br />";
      return `<p${attrs()}>${inner}</p>`;
    }
    case "h1":
      return `<h1${attrs("text-3xl font-bold")}>${children()}</h1>`;
    case "h2":
      return `<h2${attrs("text-2xl font-bold")}>${children()}</h2>`;
    case "h3":
      return `<h3${attrs("text-xl font-bold")}>${children()}</h3>`;
    case "h4":
      return `<h4${attrs("text-lg font-bold")}>${children()}</h4>`;
    case "h5":
      return `<h5${attrs("text-base font-bold")}>${children()}</h5>`;
    case "h6":
      return `<h6${attrs("text-sm font-bold")}>${children()}</h6>`;
    case "blockquote":
      return `<blockquote${attrs("border-l-2 border-border pl-3 italic text-muted-foreground")}>${children()}</blockquote>`;
    case "ul":
      return `<ul${attrs("list-disc pl-5")}>${children()}</ul>`;
    case "ol":
      return `<ol${attrs("list-decimal pl-5")}>${children()}</ol>`;
    case "li":
      return `<li${attrs()}>${children()}</li>`;
    case "strong":
    case "b":
      return `<span${attrs("font-bold")}>${children()}</span>`;
    case "em":
    case "i":
      return `<span${attrs("italic")}>${children()}</span>`;
    case "u":
      return `<span${attrs("underline")}>${children()}</span>`;
    case "s":
    case "strike":
    case "del":
      return `<span${attrs("line-through")}>${children()}</span>`;
    case "code":
      return `<code${attrs("font-mono text-sm bg-muted px-1 py-0.5 rounded")}>${children()}</code>`;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      return `<a href="${escapeAttr(
        href
      )}" className="text-primary underline">${children()}</a>`;
    }
    case "span": {
      const cls = el.getAttribute("class");
      if (cls || styleClasses.length)
        return `<span${attrs(cls || "")}>${children()}</span>`;
      return children();
    }
    default:
      return children();
  }
}

/**
 * Escape decoded DOM text before writing it back into JSX.
 */
function escapeJsxText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
