export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number
): ((...args: TArgs) => void) & { cancel: () => void } {
  let timeoutId: NodeJS.Timeout;

  const debounced = function (this: unknown, ...args: TArgs) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  } as ((...args: TArgs) => void) & { cancel: () => void };

  debounced.cancel = () => {
    clearTimeout(timeoutId);
  };

  return debounced;
}
