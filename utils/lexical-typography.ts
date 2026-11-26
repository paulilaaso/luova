import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $isElementNode,
  $isTextNode,
  type DOMConversionMap,
  type DOMExportOutputMap,
  getStaticNodeConfig,
  ParagraphNode,
  TextNode,
} from "lexical";
import { typographyCss } from "./text-typography";

// Preserve exact typography on imported runs; Lexical's default importer only
// recognizes a subset of CSS and otherwise drops e.g. size and numeric weight.
export function typographyImportMap(): DOMConversionMap {
  const map: DOMConversionMap = {};
  const factories: Record<string, NonNullable<DOMConversionMap[string]>[]> = {};
  for (const Klass of [
    TextNode,
    ParagraphNode,
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
  ]) {
    const defaults =
      getStaticNodeConfig(Klass).ownNodeConfig?.importDOM ||
      Klass.importDOM?.() ||
      {};
    for (const [tag, factory] of Object.entries(defaults)) {
      factories[tag] ??= [];
      factories[tag].push(factory);
    }
  }
  for (const [tag, candidates] of Object.entries(factories)) {
    map[tag] = (dom) => {
      const original = candidates
        .map((factory) => factory(dom))
        .filter((candidate) => candidate !== null)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
      if (!original) return null;
      return {
        priority: 4,
        conversion: (element) => {
          const result = original.conversion(element);
          if (!result) return null;
          if (!(element instanceof HTMLElement)) return result;
          const inline = !/^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(
            element.tagName
          );
          const inherited = document.createElement("span").style;
          const ancestors: HTMLElement[] = [];
          for (
            let current: HTMLElement | null = element;
            current &&
            !/^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(current.tagName);
            current = current.parentElement
          )
            ancestors.unshift(current);
          for (const ancestor of ancestors)
            inherited.cssText += ancestor.style.cssText;
          const styles = Object.values(typographyCss)
            .filter((p) => p !== "line-height")
            .filter((p) => inline && inherited.getPropertyValue(p))
            .map((p) => `${p}: ${inherited.getPropertyValue(p)};`)
            .join(" ");
          if (!Array.isArray(result.node) && $isElementNode(result.node)) {
            const blockStyle = document.createElement("span").style;
            if (element.style.lineHeight)
              blockStyle.lineHeight = element.style.lineHeight;
            if (element.style.textAlign)
              blockStyle.textAlign = element.style.textAlign;
            if (blockStyle.cssText) result.node.setStyle(blockStyle.cssText);
          }
          return {
            ...result,
            forChild: (child, parent) => {
              const next = result.forChild
                ? result.forChild(child, parent)
                : child;
              if ($isTextNode(next) && styles)
                next.setStyle(`${next.getStyle()} ${styles}`);
              return next;
            },
          };
        },
      };
    };
  }
  return map;
}

export function typographyExportMap(): DOMExportOutputMap {
  const map: DOMExportOutputMap = new Map();
  for (const Klass of [
    ParagraphNode,
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
  ]) {
    map.set(Klass, (editor, node) => {
      const output = node.exportDOM(editor);
      if ($isElementNode(node) && output.element instanceof HTMLElement)
        output.element.style.cssText += node.getStyle();
      return output;
    });
  }
  return map;
}
