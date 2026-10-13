import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { MemoryError, MemoryStore, memoryID, sanitize } from "../src/store.ts"
import { fakeKV } from "./helpers.ts"

function make(limits = { maxEntryChars: 100, maxPerScope: 3 }) {
  let t = 1000
  const kv = fakeKV()
  return { kv, store: new MemoryStore(kv, limits, () => ++t) }
}

describe("sanitize", () => {
  it("collapses newlines, control chars and whitespace", () => {
    assert.equal(sanitize("a\n\nb\t\u0000c   d", 100), "a b c d")
  })
  it("truncates with an ellipsis", () => {
    const out = sanitize("x".repeat(50), 10)
    assert.equal(out.length, 10)
    assert.ok(out.endsWith("…"))
  })
})

describe("MemoryStore", () => {
  it("adds and lists across pages", async () => {
    const { store } = make({ maxEntryChars: 100, maxPerScope: 50 })
    for (const t of ["one", "two", "three", "four", "five"]) await store.remember("project", "p1", t)
    assert.equal((await store.list("project", "p1")).length, 5)
  })

  it("isolates projects and global", async () => {
    const { store } = make()
    await store.remember("project", "p1", "alpha")
    await store.remember("project", "p2", "beta")
    await store.remember("global", undefined, "gamma")
    assert.deepEqual((await store.list("project", "p1")).map((m) => m.text), ["alpha"])
    assert.deepEqual((await store.list("project", "p2")).map((m) => m.text), ["beta"])
    assert.deepEqual((await store.list("global")).map((m) => m.text), ["gamma"])
  })

  it("dedupes by normalized text and refreshes updated", async () => {
    const { store } = make()
    const a = await store.remember("global", undefined, "Use  Tabs")
    const b = await store.remember("global", undefined, "use tabs", { pinned: true })
    assert.equal(a.status, "added")
    assert.equal(b.status, "updated")
    assert.equal(a.memory.id, b.memory.id)
    assert.ok(b.memory.updated > a.memory.updated)
    assert.equal(b.memory.created, a.memory.created)
    assert.equal(b.memory.pinned, true)
    assert.equal((await store.list("global")).length, 1)
  })

  it("rejects empty text and project scope without a project", async () => {
    const { store } = make()
    await assert.rejects(store.remember("global", undefined, " \n "), MemoryError)
    await assert.rejects(store.remember("project", undefined, "x"), MemoryError)
  })

  it("evicts the oldest unpinned entry at the cap", async () => {
    const { store } = make()
    await store.remember("global", undefined, "old", { pinned: true })
    await store.remember("global", undefined, "mid")
    await store.remember("global", undefined, "new")
    await store.remember("global", undefined, "newest")
    const texts = (await store.list("global")).map((m) => m.text).sort()
    assert.deepEqual(texts, ["new", "newest", "old"])
  })

  it("refuses to add when the scope is full of pinned entries", async () => {
    const { store } = make({ maxEntryChars: 100, maxPerScope: 1 })
    await store.remember("global", undefined, "a", { pinned: true })
    await assert.rejects(store.remember("global", undefined, "b"), MemoryError)
  })

  it("forgets from project first, then global, and reports misses", async () => {
    const { store } = make()
    const g = await store.remember("global", undefined, "glob")
    const p = await store.remember("project", "p1", "proj")
    assert.equal(await store.forget(p.memory.id, "p1"), "project")
    assert.equal(await store.forget(g.memory.id, "p1"), "global")
    assert.equal(await store.forget("nope", "p1"), undefined)
    assert.equal((await store.list("global")).length, 0)
  })

  it("does not forget another project's entry", async () => {
    const { store } = make()
    const p = await store.remember("project", "p1", "mine")
    assert.equal(await store.forget(p.memory.id, "p2"), undefined)
    assert.equal((await store.list("project", "p1")).length, 1)
  })

  it("searches by AND of words, newest first, honoring limit", async () => {
    const { store } = make({ maxEntryChars: 100, maxPerScope: 50 })
    await store.remember("global", undefined, "prefer pnpm over npm")
    await store.remember("project", "p1", "tests run with pnpm test")
    await store.remember("project", "p1", "deploy via gateway")
    const hits = await store.search(["project", "global"], "p1", "PNPM", 10)
    assert.deepEqual(hits.map((m) => m.text), ["tests run with pnpm test", "prefer pnpm over npm"])
    assert.equal((await store.search(["project", "global"], "p1", "pnpm tests", 10)).length, 1)
    assert.equal((await store.search(["project", "global"], "p1", "", 2)).length, 2)
    assert.equal((await store.search(["project"], undefined, "", 5)).length, 0)
  })

  it("ignores malformed stored values", async () => {
    const { store, kv } = make()
    kv.data.set("mem/global/bad", { nonsense: true })
    kv.data.set("mem/global/bad2", "str")
    await store.remember("global", undefined, "ok")
    assert.equal((await store.list("global")).length, 1)
  })

  it("memoryID is stable under case and whitespace", () => {
    assert.equal(memoryID("A  b"), memoryID("a b"))
  })
})
