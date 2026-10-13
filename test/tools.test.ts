import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DEFAULTS, parseOptions } from "../src/options.ts"
import { MemoryStore } from "../src/store.ts"
import { buildTools, type MemoryTool } from "../src/tools.ts"
import { setup } from "../src/setup.ts"
import { fakeKV } from "./helpers.ts"

function tools(projectID: string | null = "p1", options = DEFAULTS) {
  const store = new MemoryStore(fakeKV(), options)
  const list = buildTools(store, async () => projectID ?? undefined, options)
  const by = (name: string): MemoryTool => list.find((t) => t.name === name)!
  return { store, by, ctx: { sessionID: "s1" } }
}

describe("options", () => {
  it("falls back to defaults and clamps", () => {
    assert.deepEqual(parseOptions(undefined), DEFAULTS)
    const o = parseOptions({ maxChars: 1, maxPerScope: "x", defaultScope: "global", enabled: false })
    assert.equal(o.maxChars, 200)
    assert.equal(o.maxPerScope, DEFAULTS.maxPerScope)
    assert.equal(o.defaultScope, "global")
    assert.equal(o.enabled, false)
  })
})

describe("tools", () => {
  it("remember uses the default scope and the session's project", async () => {
    const { by, store, ctx } = tools()
    const r = await by("remember").execute({ text: "uses gradle" }, ctx)
    assert.match(r.content, /^Remembered: \[\w+\] \(project\) uses gradle/)
    assert.equal((await store.list("project", "p1")).length, 1)
    assert.equal((await store.list("global")).length, 0)
  })

  it("remember reports a refresh for duplicates", async () => {
    const { by, ctx } = tools()
    await by("remember").execute({ text: "x" }, ctx)
    assert.match((await by("remember").execute({ text: "x" }, ctx)).content, /^Refreshed/)
  })

  it("returns an error message, not a throw, for bad input or no project", async () => {
    const { by, ctx } = tools(null)
    assert.match((await by("remember").execute({ text: 5 }, ctx)).content, /^Error: text must be a string/)
    assert.match((await by("remember").execute({ text: "x" }, ctx)).content, /^Error: No project/)
    assert.match((await by("remember").execute({ text: "x", scope: "global" }, ctx)).content, /^Remembered/)
    assert.match((await by("forget").execute({}, ctx)).content, /^Error/)
    assert.match((await by("remember").execute(null, ctx)).content, /^Error/)
  })

  it("forget accepts a bracketed id and reports misses", async () => {
    const { by, ctx, store } = tools()
    const { memory } = await store.remember("project", "p1", "temp")
    assert.match((await by("forget").execute({ id: `[${memory.id}]` }, ctx)).content, /^Forgot/)
    assert.match((await by("forget").execute({ id: "zzz" }, ctx)).content, /^No memory/)
  })

  it("search returns matches and an empty message", async () => {
    const { by, ctx } = tools()
    await by("remember").execute({ text: "alpha beta" }, ctx)
    assert.match((await by("search").execute({ query: "alpha" }, ctx)).content, /alpha beta/)
    assert.equal((await by("search").execute({ query: "zzz" }, ctx)).content, "No matching memories.")
  })

  it("input schemas are strict JSON schemas", () => {
    const { by } = tools()
    for (const name of ["remember", "forget", "search"]) {
      const schema = by(name).input as { type: string; additionalProperties: boolean }
      assert.equal(schema.type, "object")
      assert.equal(schema.additionalProperties, false)
    }
  })
})

describe("setup", () => {
  function fakeCtx(options: Record<string, unknown> = {}, projectID: string | undefined = "p1") {
    const kv = fakeKV()
    const registered: Array<{ name: string; options: unknown; execute: Function }> = []
    let namespace: unknown
    let hook: ((e: { sessionID: string; system: unknown[] }) => Promise<void>) | undefined
    const ctx = {
      options,
      storage: kv,
      session: {
        get: async () => (projectID ? { projectID } : undefined),
        hook: async (name: string, fn: typeof hook) => {
          assert.equal(name, "context")
          hook = fn
        },
      },
      tool: {
        transform: (fn: (e: unknown) => void) =>
          fn({ namespace: (n: unknown) => (namespace = n), add: (t: never) => registered.push(t) }),
      },
    }
    return { ctx, registered, getHook: () => hook, getNamespace: () => namespace, kv }
  }

  it("registers three direct tools under the memory namespace", async () => {
    const f = fakeCtx()
    await setup(f.ctx as never)
    assert.deepEqual(f.registered.map((t) => t.name), ["remember", "forget", "search"])
    for (const t of f.registered) assert.deepEqual(t.options, { namespace: "memory", codemode: false })
    assert.deepEqual(f.getNamespace(), { name: "memory", description: "Persistent memory across sessions" })
  })

  it("does nothing when disabled", async () => {
    const f = fakeCtx({ enabled: false })
    await setup(f.ctx as never)
    assert.equal(f.registered.length, 0)
    assert.equal(f.getHook(), undefined)
  })

  it("injects remembered entries into the system prompt via the tools", async () => {
    const f = fakeCtx()
    await setup(f.ctx as never)
    const remember = f.registered.find((t) => t.name === "remember")!
    await remember.execute({ text: "project uses maven" }, { sessionID: "s1" })
    await remember.execute({ text: "user prefers terse replies", scope: "global" }, { sessionID: "s1" })
    const event = { sessionID: "s1", system: [] as unknown[] }
    await f.getHook()!(event)
    assert.equal(event.system.length, 1)
    const text = (event.system[0] as { type: string; text: string }).text
    assert.match(text, /project uses maven/)
    assert.match(text, /user prefers terse replies/)
  })

  it("injects nothing when memory is empty and never throws if storage fails", async () => {
    const f = fakeCtx()
    await setup(f.ctx as never)
    const event = { sessionID: "s1", system: [] as unknown[] }
    await f.getHook()!(event)
    assert.equal(event.system.length, 0)

    f.kv.scan = async () => {
      throw new Error("db down")
    }
    await assert.doesNotReject(f.getHook()!(event))
    assert.equal(event.system.length, 0)
  })
})
