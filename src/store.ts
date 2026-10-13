import { createHash } from "node:crypto"

export type Scope = "global" | "project"

export interface Memory {
  id: string
  scope: Scope
  text: string
  pinned: boolean
  created: number
  updated: number
  source?: string
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** The subset of ctx.storage the store needs. */
export interface KV {
  get(key: string): Promise<Json | undefined>
  set(key: string, value: Json): Promise<void>
  remove(key: string): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: readonly { key: string; value: Json }[]
    next?: string
  }>
}

export interface StoreLimits {
  maxEntryChars: number
  maxPerScope: number
}

export class MemoryError extends Error {}

/** Collapses whitespace and control characters so an entry stays on one line. */
export function sanitize(text: string, maxChars: number): string {
  const clean = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (clean.length <= maxChars) return clean
  return clean.slice(0, maxChars - 1).trimEnd() + "…"
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

export function memoryID(text: string): string {
  return createHash("sha1").update(normalize(text)).digest("hex").slice(0, 10)
}

function isMemory(value: unknown): value is Memory {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    (v.scope === "global" || v.scope === "project") &&
    typeof v.text === "string" &&
    typeof v.pinned === "boolean" &&
    typeof v.created === "number" &&
    typeof v.updated === "number"
  )
}

export class MemoryStore {
  private readonly kv: KV
  private readonly limits: StoreLimits
  private readonly now: () => number

  constructor(kv: KV, limits: StoreLimits, now: () => number = Date.now) {
    this.kv = kv
    this.limits = limits
    this.now = now
  }

  private prefix(scope: Scope, projectID: string | undefined): string {
    if (scope === "global") return "mem/global/"
    if (!projectID) throw new MemoryError('No project is associated with this session; use scope "global".')
    return `mem/project/${encodeURIComponent(projectID)}/`
  }

  async list(scope: Scope, projectID?: string): Promise<Memory[]> {
    const prefix = this.prefix(scope, projectID)
    const out: Memory[] = []
    let after: string | undefined
    do {
      const page = await this.kv.scan({ prefix, limit: 100, ...(after === undefined ? {} : { after }) })
      for (const entry of page.entries) if (isMemory(entry.value)) out.push(entry.value)
      after = page.next
    } while (after !== undefined)
    return out
  }

  async remember(
    scope: Scope,
    projectID: string | undefined,
    rawText: string,
    options: { pinned?: boolean; source?: string } = {},
  ): Promise<{ memory: Memory; status: "added" | "updated" }> {
    const text = sanitize(rawText, this.limits.maxEntryChars)
    if (!text) throw new MemoryError("Memory text is empty.")
    const prefix = this.prefix(scope, projectID)
    const id = memoryID(text)
    const key = prefix + id
    const existing: unknown = await this.kv.get(key)
    const now = this.now()

    if (isMemory(existing)) {
      const memory: Memory = { ...existing, updated: now, pinned: options.pinned ?? existing.pinned }
      await this.kv.set(key, memory as unknown as Json)
      return { memory, status: "updated" }
    }

    const all = await this.list(scope, projectID)
    if (all.length >= this.limits.maxPerScope) {
      const victim = all.filter((m) => !m.pinned).sort((a, b) => a.updated - b.updated)[0]
      if (!victim) throw new MemoryError(`The ${scope} memory is full of pinned entries; forget one first.`)
      await this.kv.remove(prefix + victim.id)
    }
    const memory: Memory = {
      id,
      scope,
      text,
      pinned: options.pinned ?? false,
      created: now,
      updated: now,
      ...(options.source === undefined ? {} : { source: options.source }),
    }
    await this.kv.set(key, memory as unknown as Json)
    return { memory, status: "added" }
  }

  /** Removes the entry from the project scope first, then global. */
  async forget(id: string, projectID?: string): Promise<Scope | undefined> {
    if (projectID) {
      const key = this.prefix("project", projectID) + id
      if (isMemory(await this.kv.get(key))) {
        await this.kv.remove(key)
        return "project"
      }
    }
    const key = this.prefix("global", undefined) + id
    if (isMemory(await this.kv.get(key))) {
      await this.kv.remove(key)
      return "global"
    }
    return undefined
  }

  /** Every query word must appear in the text. An empty query lists everything. */
  async search(
    scopes: readonly Scope[],
    projectID: string | undefined,
    query: string,
    limit: number,
  ): Promise<Memory[]> {
    const words = normalize(query).split(" ").filter(Boolean)
    const found: Memory[] = []
    for (const scope of scopes) {
      if (scope === "project" && !projectID) continue
      for (const m of await this.list(scope, projectID)) {
        const haystack = m.text.toLowerCase()
        if (words.every((w) => haystack.includes(w))) found.push(m)
      }
    }
    return found.sort((a, b) => b.updated - a.updated).slice(0, limit)
  }
}
