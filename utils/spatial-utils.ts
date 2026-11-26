import type { GridConfig } from "@/types/builder";
import {
  normalizeDimensions,
  normalizeWidth,
  snapDimensions,
  snapPosition,
} from "@/utils/spatial-engine";

export function calculateNewPosition(
  _current: { x: number; y: number },
  target: { x: number; y: number },
  gridConfig?: GridConfig
) {
  if (!gridConfig?.snapToGrid) return target;
  const snapped = snapPosition(target.x, target.y, gridConfig);
  return { x: Math.round(snapped.x), y: Math.round(snapped.y) };
}

export function calculateNewSize(
  _current: { width: number; height: number },
  target: { width: number; height: number },
  gridConfig?: GridConfig
) {
  const snapped = gridConfig?.snapToGrid
    ? snapDimensions(target.width, target.height, gridConfig)
    : target;
  const normalized = normalizeDimensions(snapped.width, snapped.height);
  return {
    width: Math.round(normalized.width),
    height: Math.round(normalized.height),
  };
}

export function normalizeProps(
  props: Record<string, unknown>
): Record<string, unknown> {
  let changed = false;
  const nextProps = { ...props };

  if (typeof nextProps.w === "number") {
    const newVal = normalizeWidth(nextProps.w);
    if (newVal !== nextProps.w) {
      nextProps.w = newVal;
      changed = true;
    }
  }
  if (typeof nextProps.x === "number") {
    const newVal = Math.round(nextProps.x);
    if (newVal !== nextProps.x) {
      nextProps.x = newVal;
      changed = true;
    }
  }
  if (typeof nextProps.y === "number") {
    const newVal = Math.round(nextProps.y);
    if (newVal !== nextProps.y) {
      nextProps.y = newVal;
      changed = true;
    }
  }
  if (typeof nextProps.h === "number") {
    const newVal = Math.round(nextProps.h);
    if (newVal !== nextProps.h) {
      nextProps.h = newVal;
      changed = true;
    }
  }

  return changed ? nextProps : props;
}
