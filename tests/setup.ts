// tests/setup.ts
import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Node 22+ ships an experimental global `localStorage`/`sessionStorage` that is
// undefined unless `--localstorage-file` is passed, and it shadows jsdom's
// Storage. Install an in-memory Storage whenever the global one is unusable.
class MemoryStorage implements Storage {
  #data = new Map<string, string>();
  get length() {
    return this.#data.size;
  }
  clear() {
    this.#data.clear();
  }
  getItem(key: string) {
    return this.#data.has(key) ? (this.#data.get(key) as string) : null;
  }
  key(index: number) {
    return Array.from(this.#data.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.#data.delete(key);
  }
  setItem(key: string, value: string) {
    this.#data.set(key, String(value));
  }
}

if (typeof window !== "undefined") {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    let usable = false;
    try {
      usable = typeof globalThis[name]?.setItem === "function";
    } catch {}
    if (!usable) {
      const storage = new MemoryStorage();
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: storage,
      });
      Object.defineProperty(window, name, {
        configurable: true,
        value: storage,
      });
    }
  }
}

// Browser-only mocks; server-side tests run with `@vitest-environment node`.
if (typeof window !== "undefined") {
  // Mock matchMedia
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {}, // deprecated
      removeListener: () => {}, // deprecated
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // Mock PointerEvent (for Slider/Drag interactions)
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;

    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button || 0;
      this.ctrlKey = props.ctrlKey || false;
      this.pointerType = props.pointerType || "mouse";
    }
  }
  window.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;

  // Mock HTMLElement prototype methods
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
}
