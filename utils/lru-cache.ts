export type EvictionCallback<K, V> = (key: K, value: V) => void;

export class LRUCache<K, V> {
  private data: Map<K, V> = new Map();
  constructor(
    private maxSize: number,
    private onEvict?: EvictionCallback<K, V>
  ) {}

  get(key: K): V | undefined {
    if (!this.data.has(key)) return undefined;
    const value = this.data.get(key)!;
    this.data.delete(key);
    this.data.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.data.has(key)) {
      this.data.delete(key);
    } else if (this.data.size >= this.maxSize) {
      const firstKey = this.data.keys().next().value;
      if (firstKey !== undefined) {
        const evictedValue = this.data.get(firstKey)!;
        this.data.delete(firstKey);
        this.onEvict?.(firstKey, evictedValue);
      }
    }
    this.data.set(key, value);
  }

  delete(key: K): boolean {
    if (!this.data.has(key)) return false;
    const value = this.data.get(key)!;
    this.data.delete(key);
    this.onEvict?.(key, value);
    return true;
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.data) {
        this.onEvict(key, value);
      }
    }
    this.data.clear();
  }

  get size(): number {
    return this.data.size;
  }

  get cache(): Map<K, V> {
    return this.data;
  }
}
