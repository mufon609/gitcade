/**
 * Storage adapters implement the game-facing persistence API. All methods are
 * async because the production adapter ({@link BridgeStorage}) round-trips through
 * postMessage. Values are arbitrary JSON-serializable data; the adapter handles
 * (de)serialization.
 *
 * This is the interface ALL ecosystem-tier persistence flows through. Raw
 * `localStorage`/`indexedDB` use is forbidden in ecosystem games (the validator
 * fails it), because switching branches or playing a fork must never corrupt
 * saves — only the namespaced bridge guarantees that.
 */
export interface StorageAdapter {
  /** Read a value; resolves to `null` if absent. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Write a value. */
  set<T = unknown>(key: string, value: T): Promise<void>;
  /** Delete a key. */
  remove(key: string): Promise<void>;
  /** List all keys in this game's namespace. */
  keys(): Promise<string[]>;
  /** Clear all keys in this game's namespace. */
  clear(): Promise<void>;
}

/**
 * In-memory adapter. The default dev-shim for headless smoke tests and any
 * context without a parent page. Data does not persist across process restarts.
 */
export class MemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  }
  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async clear(): Promise<void> {
    this.store.clear();
  }
}

/**
 * File-backed dev-shim so `npm run dev` (and CLI runs) persist saves across
 * restarts WITHOUT a parent page. Node-only: it lazily `import`s `node:fs`, and
 * falls back to in-memory behavior if the filesystem is unavailable (e.g. a
 * browser dev server). Reads/writes the whole namespace as one JSON file — fine
 * for the small save payloads games produce.
 */
export class FileStorage implements StorageAdapter {
  private cache: Record<string, unknown> | null = null;
  private fsmod: typeof import("node:fs") | null = null;

  constructor(private readonly filePath: string) {}

  private async fs(): Promise<typeof import("node:fs") | null> {
    if (this.fsmod) return this.fsmod;
    try {
      // Computed specifier + @vite-ignore so browser bundlers don't try to
      // resolve node:fs (FileStorage is a Node-only dev shim; in the browser
      // this import simply rejects and we fall back to in-memory behavior).
      const spec = ["node", "fs"].join(":");
      this.fsmod = (await import(/* @vite-ignore */ spec)) as typeof import("node:fs");
      return this.fsmod;
    } catch {
      return null;
    }
  }

  private async load(): Promise<Record<string, unknown>> {
    if (this.cache) return this.cache;
    const fs = await this.fs();
    if (!fs) return (this.cache = {});
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      this.cache = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    const fs = await this.fs();
    if (!fs || !this.cache) return;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf8");
    } catch {
      /* best-effort dev shim */
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const data = await this.load();
    return key in data ? (data[key] as T) : null;
  }
  async set<T = unknown>(key: string, value: T): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await this.persist();
  }
  async remove(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await this.persist();
  }
  async keys(): Promise<string[]> {
    return Object.keys(await this.load());
  }
  async clear(): Promise<void> {
    this.cache = {};
    await this.persist();
  }
}
