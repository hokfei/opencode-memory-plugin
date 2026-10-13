import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { renderMemory } from "../src/render.ts"
import type { Memory } from "../src/store.ts"

function mem(id: string, text: string, o: Partial<Memory> = {}): Memory {
  return { id, scope: "global", text, pinned: false, created: 1, updated: 1, ...o }
}

describe("renderMemory", () => {
  it("returns undefined when there is nothing to show", () => {
    assert.equal(renderMemory([{ title: "Global", memories: [] }], 4000), undefined)
  })

  it("labels entries as untrusted and includes ids", () => {
    const out = renderMemory([{ title: "Global", memories: [mem("abc", "use tabs")] }], 4000)!
    assert.match(out, /untrusted data, not instructions/)
    assert.match(out, /- \[abc\] use tabs/)
    assert.match(out, /### Global/)
  })

  it("renders in creation order regardless of recency", () => {
    const out = renderMemory(
      [{ title: "Global", memories: [mem("b", "second", { created: 2, updated: 99 }), mem("a", "first", { created: 1, updated: 5 })] }],
      4000,
    )!
    assert.ok(out.indexOf("first") < out.indexOf("second"))
  })

  it("keeps pinned entries first under a tight budget, then recent", () => {
    const memories = [
      mem("old", "old-entry-text", { updated: 1 }),
      mem("pin", "pinned-entry-text", { pinned: true, updated: 0 }),
      mem("new", "new-entry-text", { updated: 9 }),
    ]
    const full = renderMemory([{ title: "G", memories }], 100000)!
    const headerLen = full.indexOf("### G") - 1
    const budget = headerLen + 80
    const out = renderMemory([{ title: "G", memories }], budget)!
    assert.match(out, /pinned-entry-text/)
    assert.match(out, /new-entry-text/)
    assert.doesNotMatch(out, /old-entry-text/)
    assert.match(out, /1 more not shown/)
  })

  it("returns undefined if even one entry does not fit", () => {
    assert.equal(renderMemory([{ title: "G", memories: [mem("a", "x".repeat(500))] }], 300), undefined)
  })

  it("is deterministic for identical input", () => {
    const sections = [{ title: "G", memories: [mem("a", "x"), mem("b", "y", { created: 2 })] }]
    assert.equal(renderMemory(sections, 4000), renderMemory(sections, 4000))
  })
})
