const COLOR_CONTROL_ID_PREFIX = "color-control-";

export function getColorControlId(name: string): string {
  return `${COLOR_CONTROL_ID_PREFIX}${name}`;
}
