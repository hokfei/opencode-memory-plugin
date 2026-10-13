import type { KV } from "../src/store.ts"

export function fakeKV(pageSize = 2): KV & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    async get(key) {
      return data.get(key) as never
    },
    async set(key, value) {
      data.set(key, value)
    },
    async remove(key) {
      data.delete(key)
    },
    async scan({ prefix, after, limit }) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix) && (after === undefined || k > after)).sort()
      const size = Math.min(limit ?? pageSize, pageSize)
      const page = keys.slice(0, size)
      return {
        entries: page.map((key) => ({ key, value: data.get(key) as never })),
        ...(keys.length > size ? { next: page[page.length - 1]! } : {}),
      }
    },
  }
}
