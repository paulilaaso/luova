"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  $patchStyleText,
  $setBlocksType,
  createDOMRange,
} from "@lexical/selection";
import {
  $createParagraphNode,
  $createRangeSelectionFromDom,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  type LexicalNode,
  type RangeSelection,
  SKIP_DOM_SELECTION_TAG,
} from "lexical";
import { useEffect, useRef } from "react";
import {
  type TextAlignment,
  type TextBlockType,
  useTextFormatStore,
} from "@/stores/text-format-store";
import {
  type TypographyProperty,
  type TypographyValues,
  typographyCss,
  typographyCssValue,
} from "@/utils/text-typography";

/**
 * Sidebar affordances that operate on the current text selection. Interacting
 * with these must not be mistaken for the user leaving the editor selection.
 */
const CONTROL_SELECTOR =
  '[data-text-format-controls], .properties-panel, [role="toolbar"][aria-label="Text formatting"], [data-slot="popover-content"], [data-slot="select-content"]';

/**
 * CSS Custom Highlight name used to keep the selected range visible after the
 * browser moves its own selection elsewhere (e.g. into the font search input).
 * Styled in globals.css to match ::selection.
 */
const SAVED_SELECTION_HIGHLIGHT = "luova-text-selection";

export function TextTypographyBridge({
  nodeId,
  flush,
}: {
  nodeId: string;
  flush?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    let saved: RangeSelection | null = null;
    let previewProperty: TypographyProperty | null = null;
    let doubleClickFrame: number | null = null;
    // Mirror the saved range as a custom highlight whenever the native
    // selection is no longer showing it inside the editor.
    const paintSavedSelection = () => {
      const root = editor.getRootElement();
      const highlights = root?.ownerDocument.defaultView?.CSS?.highlights;
      if (!root || !highlights) return;
      const native = root.ownerDocument.getSelection();
      const nativeShowsRange =
        !!native &&
        !native.isCollapsed &&
        !!native.anchorNode &&
        root.contains(native.anchorNode);
      if (!saved || nativeShowsRange) {
        highlights.delete(SAVED_SELECTION_HIGHLIGHT);
        return;
      }
      const range = saved;
      editor.getEditorState().read(() => {
        const domRange = createDOMRange(
          editor,
          range.anchor.getNode(),
          range.anchor.offset,
          range.focus.getNode(),
          range.focus.offset
        );
        if (domRange && !domRange.collapsed)
          highlights.set(SAVED_SELECTION_HIGHLIGHT, new Highlight(domRange));
        else highlights.delete(SAVED_SELECTION_HIGHLIGHT);
      });
    };
    const syncNativeSelection = () => {
      const root = editor.getRootElement();
      const native = window.getSelection();
      if (
        !root ||
        !native ||
        native.isCollapsed ||
        !native.anchorNode ||
        !native.focusNode ||
        !root.contains(native.anchorNode) ||
        !root.contains(native.focusNode)
      )
        return;

      // A browser double-click can update its DOM range after Lexical's last
      // update. Publish that range before a sidebar control steals focus.
      editor.update(
        () => {
          const range = $createRangeSelectionFromDom(native, editor);
          if (range && !range.isCollapsed()) $setSelection(range);
        },
        { discrete: true, tag: SKIP_DOM_SELECTION_TAG }
      );
    };
    const handleDoubleClick = () => {
      if (doubleClickFrame !== null) cancelAnimationFrame(doubleClickFrame);
      doubleClickFrame = requestAnimationFrame(() => {
        doubleClickFrame = null;
        syncNativeSelection();
      });
    };
    // Lexical transiently reports a collapsed caret when a pointer interaction
    // lands outside the editor (e.g. dragging a sidebar control), even though
    // the editor may still technically hold focus. We only treat a collapse as
    // "the user returned to whole-block scope" when the pointer did NOT go to a
    // formatting control; otherwise the last selected range must be kept.
    let interactingWithControls = false;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      interactingWithControls =
        target instanceof Element && target.closest(CONTROL_SELECTOR) !== null;
      if (interactingWithControls) syncNativeSelection();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    const apply = (
      property: TypographyProperty,
      value: string | number,
      tokenKey?: string,
      isPreview = false
    ) => {
      if (!saved) return;
      if (typeof value === "number" && !Number.isFinite(value)) return;
      const historyTag =
        previewProperty === property ? HISTORY_MERGE_TAG : HISTORY_PUSH_TAG;
      previewProperty = isPreview ? property : null;
      editor.update(
        () => {
          $setSelection(saved!.clone());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const cssValue =
            tokenKey && property === "textColor"
              ? `var(--${tokenKey})`
              : typographyCssValue(property, value);
          if (property === "lineHeight") {
            const blocks = new Set(
              selection.getNodes().map(paragraphFor).filter($isElementNode)
            );
            for (const block of blocks) {
              const style = document.createElement("div").style;
              style.cssText = block.getStyle();
              style.lineHeight = cssValue;
              block.setStyle(style.cssText);
            }
          } else {
            // Split boundary runs first, then clear conflicting semantic flags on
            // every selected run, including selections with mixed bold/italic.
            const formats =
              property === "fontWeight"
                ? (["bold"] as const)
                : property === "fontStyle"
                  ? (["italic"] as const)
                  : property === "textDecoration"
                    ? (["underline", "strikethrough"] as const)
                    : [];
            for (const node of selection.extract()) {
              if ($isTextNode(node))
                for (const format of formats)
                  if (node.hasFormat(format)) node.toggleFormat(format);
            }
            for (const format of formats)
              if (selection.hasFormat(format)) selection.toggleFormat(format);
            $patchStyleText(selection, { [typographyCss[property]]: cssValue });
          }
          saved = selection.clone();
        },
        { tag: [historyTag, SKIP_DOM_SELECTION_TAG] }
      );
    };
    const preview = (property: TypographyProperty, value: string | number) =>
      apply(property, value, undefined, true);
    const clear = () => {
      if (!saved) return;
      editor.update(
        () => {
          $setSelection(saved!.clone());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          // extract() splits boundary runs so unselected text is untouched.
          for (const node of selection.extract())
            if ($isTextNode(node)) node.setFormat(0).setStyle("");
          selection.setFormat(0);
          selection.setStyle("");
          for (const node of selection.getNodes()) {
            const block = paragraphFor(node);
            if ($isElementNode(block)) block.setStyle("");
          }
          saved = selection.clone();
        },
        { tag: [HISTORY_PUSH_TAG, SKIP_DOM_SELECTION_TAG] }
      );
    };
    const clearProperty = (property: TypographyProperty) => {
      editor.update(
        () => {
          const css = typographyCss[property];
          const visit = (node: LexicalNode) => {
            if ($isTextNode(node)) {
              const style = document.createElement("span").style;
              style.cssText = node.getStyle();
              style.removeProperty(css);
              node.setStyle(style.cssText);
              const formats =
                property === "fontWeight"
                  ? (["bold"] as const)
                  : property === "fontStyle"
                    ? (["italic"] as const)
                    : property === "textDecoration"
                      ? (["underline", "strikethrough"] as const)
                      : [];
              for (const format of formats)
                if (node.hasFormat(format)) node.toggleFormat(format);
            } else if ($isElementNode(node)) {
              if (property === "lineHeight" && node.getType() !== "root") {
                const style = document.createElement("div").style;
                style.cssText = node.getStyle();
                style.removeProperty(css);
                node.setStyle(style.cssText);
              }
              node.getChildren().forEach(visit);
            }
          };
          visit($getRoot());
        },
        { discrete: true }
      );
    };
    const resetText = () => {
      editor.update(
        () => {
          // 1. Clear every run/block style and inline format.
          const visit = (node: LexicalNode) => {
            if ($isTextNode(node)) {
              node.setFormat(0);
              node.setStyle("");
            } else if ($isElementNode(node)) {
              if (node.getType() !== "root") node.setStyle("");
              node.getChildren().forEach(visit);
            }
          };
          visit($getRoot());

          // 2. Collapse headings/quotes/lists back to plain paragraphs.
          const root = $getRoot();
          const paragraphs: LexicalNode[] = [];
          for (const block of root.getChildren()) {
            if (!$isElementNode(block)) continue;
            const type = block.getType();
            if (type === "list") {
              for (const item of block.getChildren()) {
                if (!$isElementNode(item)) continue;
                const paragraph = $createParagraphNode();
                item.getChildren().forEach((child) => {
                  paragraph.append(child);
                });
                paragraphs.push(paragraph);
              }
            } else if (type === "heading" || type === "quote") {
              const paragraph = $createParagraphNode();
              block.getChildren().forEach((child) => {
                paragraph.append(child);
              });
              paragraphs.push(paragraph);
            } else {
              paragraphs.push(block);
            }
          }
          root.clear();
          root.append(...paragraphs);
        },
        { discrete: true }
      );
    };
    const formatBlock = (type: TextBlockType) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        if (type === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () =>
            $createHeadingNode(type as HeadingTagType)
          );
        }
      });
    };
    const formatAlignment = (alignment: TextAlignment) => {
      editor.update(
        () => {
          if (saved) $setSelection(saved.clone());
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const blocks = new Set(
            selection.getNodes().map(paragraphFor).filter($isElementNode)
          );
          for (const block of blocks) {
            block.setFormat(alignment);
            const style = document.createElement("div").style;
            style.cssText = block.getStyle();
            style.textAlign = alignment;
            block.setStyle(style.cssText);
          }
        },
        { tag: HISTORY_PUSH_TAG }
      );
    };
    const refresh = () =>
      editor.getEditorState().read(() => {
        const visit = (node: import("lexical").LexicalNode) => {
          if ($isElementNode(node)) {
            const dom = editor.getElementByKey(node.getKey());
            if (dom && node.getType() !== "root")
              dom.style.cssText = node.getStyle();
            node.getChildren().forEach(visit);
          }
        };
        visit($getRoot());
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return; // focus in a control retains the last range

        // Structural state is meaningful with a bare caret too, so publish it
        // before deciding whether a run-level typography session exists.
        const element = selection.anchor.getNode().getTopLevelElement();
        let block: TextBlockType = "paragraph";
        if ($isHeadingNode(element)) {
          const tag = element.getTag();
          block = tag === "h1" || tag === "h2" || tag === "h3" ? tag : "h2";
        }
        const selectedBlocks = new Set(
          selection.getNodes().map(paragraphFor).filter($isElementNode)
        );
        const alignments = Array.from(selectedBlocks, (selectedBlock) => {
          const style = document.createElement("div").style;
          style.cssText = selectedBlock.getStyle();
          return style.textAlign || selectedBlock.getFormatType();
        });
        const alignment = alignments.every((value) => value === alignments[0])
          ? (alignments[0] as TextAlignment | "")
          : null;
        useTextFormatStore.setState({
          controller: {
            nodeId,
            block,
            alignment,
            formatBlock,
            formatAlignment,
            flush: () => flushRef.current?.(),
            clearProperty,
            resetText,
          },
        });

        if (selection.isCollapsed()) {
          // A collapsed caret means the user is back to whole-block scope —
          // unless the collapse was triggered while operating a sidebar
          // formatting control (dragging a scrub handle collapses the DOM
          // selection even though the editor keeps focus). In that case the
          // last selected range is kept so the session stays selection-scoped.
          if (!interactingWithControls) {
            saved = null;
            previewProperty = null;
            if (useTextFormatStore.getState().session?.nodeId === nodeId)
              useTextFormatStore.setState({ session: null });
          }
          return;
        }
        saved = selection.clone();
        const nodes = selection.getNodes().filter($isTextNode);
        const values = {} as TypographyValues;
        for (const [property, css] of Object.entries(typographyCss)) {
          const seen = nodes.map((node) => {
            const element = editor.getElementByKey(node.getKey());
            const block = paragraphFor(node);
            const blockElement = block
              ? editor.getElementByKey(block.getKey())
              : null;
            // Fall back to the block / editor root so a missing leaf element
            // never yields a spurious "mixed" (empty) reading.
            const target =
              (property === "lineHeight" ? blockElement : element) ??
              element ??
              blockElement ??
              editor.getRootElement();
            if (!target) return "";
            const computed = getComputedStyle(target);
            let explicit = target.style.getPropertyValue(css);
            if (property === "fontFamily" && !explicit) {
              for (
                let ancestor = target.parentElement;
                ancestor;
                ancestor = ancestor.parentElement
              ) {
                if (ancestor.style.fontFamily) {
                  explicit = ancestor.style.fontFamily;
                  break;
                }
                if (ancestor === editor.getRootElement()) break;
              }
            }
            const raw = explicit || computed.getPropertyValue(css);
            if (
              property === "lineHeight" &&
              explicit &&
              !/[a-z%]/i.test(explicit)
            )
              return String(Number(explicit) * 100);
            if (
              (property === "letterSpacing" || property === "wordSpacing") &&
              raw.endsWith("em")
            )
              return String(parseFloat(raw));
            if (
              property === "fontFamily" &&
              /^var\(--font-(sans|serif|mono|heading)\)$/.test(raw)
            )
              return raw.slice(11, -1);
            if (property === "fontSize") {
              const size = parseFloat(raw);
              return String(Number.isFinite(size) && size > 0 ? size : 16);
            }
            if (property === "fontWeight")
              return raw === "bold"
                ? "700"
                : raw === "normal" || !raw
                  ? "400"
                  : raw;
            if (property === "lineHeight") {
              if (raw === "normal" || !raw) return "150";
              const ratio =
                parseFloat(raw) / parseFloat(computed.fontSize || "16");
              return Number.isFinite(ratio)
                ? String(Math.round(ratio * 100))
                : "150";
            }
            if (property === "letterSpacing" || property === "wordSpacing") {
              if (raw === "normal" || !raw) return "0";
              const em =
                parseFloat(raw) / parseFloat(computed.fontSize || "16");
              return Number.isFinite(em) ? String(Number(em.toFixed(4))) : "0";
            }
            if (property === "fontFamily")
              return raw
                .split(",")[0]
                .trim()
                .replace(/^["']|["']$/g, "");
            return raw;
          });
          values[property as TypographyProperty] =
            seen.length && seen.every((v) => v === seen[0]) ? seen[0] : "";
        }
        useTextFormatStore.setState({
          session: { nodeId, values, apply, preview, clear },
        });
      });
    const handleFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        editor.getRootElement()?.contains(target)
      )
        return;
      if (target.closest(CONTROL_SELECTOR)) return;
      saved = null;
      previewProperty = null;
      paintSavedSelection();
      if (useTextFormatStore.getState().session?.nodeId === nodeId)
        useTextFormatStore.setState({ session: null });
      if (useTextFormatStore.getState().controller?.nodeId === nodeId)
        useTextFormatStore.setState({ controller: null });
    };
    document.addEventListener("focusin", handleFocus);
    document.addEventListener("selectionchange", paintSavedSelection);
    const unregister = editor.registerUpdateListener(() => {
      refresh();
      paintSavedSelection();
    });
    const observer = new MutationObserver(refresh);
    const root = editor.getRootElement();
    if (root) {
      root.addEventListener("dblclick", handleDoubleClick);
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }
    refresh();
    return () => {
      unregister();
      document.removeEventListener("selectionchange", paintSavedSelection);
      editor
        .getRootElement()
        ?.ownerDocument.defaultView?.CSS?.highlights?.delete(
          SAVED_SELECTION_HIGHLIGHT
        );
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocus);
      root?.removeEventListener("dblclick", handleDoubleClick);
      if (doubleClickFrame !== null) cancelAnimationFrame(doubleClickFrame);
      observer.disconnect();
      if (useTextFormatStore.getState().session?.nodeId === nodeId)
        useTextFormatStore.setState({ session: null });
      if (useTextFormatStore.getState().controller?.nodeId === nodeId)
        useTextFormatStore.setState({ controller: null });
    };
  }, [editor, nodeId]);
  return null;
}

function paragraphFor(node: LexicalNode) {
  let current: LexicalNode | null = node;
  while (current) {
    if (
      $isElementNode(current) &&
      ["paragraph", "heading", "quote", "listitem"].includes(current.getType())
    )
      return current;
    current = current.getParent();
  }
  return null;
}
