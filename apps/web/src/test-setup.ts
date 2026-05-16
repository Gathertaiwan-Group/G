import "@testing-library/jest-dom"

// Node 25 exposes a native experimental `localStorage` global that is
// non-functional unless the process is started with a valid
// `--localstorage-file` path. jsdom cannot shadow this non-configurable
// native global, so `window.localStorage.setItem` is `undefined` in the test
// environment and any zustand `persist` write throws
// `TypeError: storage.setItem is not a function`. Install a working
// in-memory Storage so persisted stores behave as they do in a real browser.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}

const memoryLocalStorage = new MemoryStorage()
for (const target of [globalThis, window]) {
  Object.defineProperty(target, "localStorage", {
    value: memoryLocalStorage,
    configurable: true,
    writable: true,
  })
}
