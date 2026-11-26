import {
  type CanvasTransform,
  screenCoordsFromEvent,
  screenPointToCanvas,
} from "@/utils/spatial-engine";

export function getRelativeCoords(
  event:
    | Pick<MouseEvent, "clientX" | "clientY">
    | { clientX: number; clientY: number },
  viewportElement: Element,
  transform: CanvasTransform
): { x: number; y: number } {
  const screenPoint = screenCoordsFromEvent(event);
  return screenPointToCanvas(screenPoint, viewportElement, transform);
}
