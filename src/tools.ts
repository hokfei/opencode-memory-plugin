import { MemoryError, type Memory, type MemoryStore, type Scope } from "./store.ts"
import type { MemoryOptions } from "./options.ts"

export interface ToolCtx {
  readonly sessionID: string
}

export interface MemoryTool {
  name: string
  description: string
  input: Record<string, unknown>
  execute: (input: unknown, ctx: ToolCtx) => Promise<{ content: string }>
}

export type ProjectResolver = (sessionID: string) => Promise<string | undefined>

function obj(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
}

function show(m: Memory): string {
  return `[${m.id}] (${m.scope}${m.pinned ? ", pinned" : ""}) ${m.text}`
}

export function buildTools(store: MemoryStore, project: ProjectResolver, options: MemoryOptions): MemoryTool[] {
  const guard = (fn: MemoryTool["execute"]): MemoryTool["execute"] => async (input, ctx) => {
    try {
      return await fn(input, ctx)
    } catch (error) {
      if (error instanceof MemoryError) return { content: `Error: ${error.message}` }
      throw error
    }
  }

  return [
    {
      name: "remember",
      description:
        "Save a short, durable fact or preference to persistent memory so future sessions see it. " +
        'Use "project" scope for repo-specific facts and "global" for user-wide preferences. ' +
        "Do not save secrets or transient task state. Saving the same text again just refreshes it.",
      input: {
        type: "object",
        properties: {
          text: { type: "string", description: "The fact to remember, one or two sentences." },
          scope: { type: "string", enum: ["project", "global"], description: `Defaults to "${options.defaultScope}".` },
          pinned: { type: "boolean", description: "Pinned entries are always injected first." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: guard(async (input, ctx) => {
        const i = obj(input)
        if (typeof i.text !== "string") throw new MemoryError("text must be a string.")
        const scope: Scope = i.scope === "global" || i.scope === "project" ? i.scope : options.defaultScope
        const projectID = scope === "project" ? await project(ctx.sessionID) : undefined
        const { memory, status } = await store.remember(scope, projectID, i.text, {
          ...(typeof i.pinned === "boolean" ? { pinned: i.pinned } : {}),
          source: ctx.sessionID,
        })
        return { content: `${status === "added" ? "Remembered" : "Refreshed"}: ${show(memory)}` }
      }),
    },
    {
      name: "forget",
      description: "Remove a memory by its id (shown in the Persistent memory block and in memory_search results).",
      input: {
        type: "object",
        properties: { id: { type: "string", description: "The memory id, e.g. a1b2c3d4e5." } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: guard(async (input, ctx) => {
        const i = obj(input)
        if (typeof i.id !== "string" || !i.id.trim()) throw new MemoryError("id must be a non-empty string.")
        const id = i.id.trim().replace(/^\[|\]$/g, "")
        const scope = await store.forget(id, await project(ctx.sessionID))
        return { content: scope ? `Forgot ${id} (${scope}).` : `No memory with id ${id}.` }
      }),
    },
    {
      name: "search",
      description:
        "Search persistent memory. Every word in the query must appear in the entry. " +
        "An empty query lists all entries, newest first.",
      input: {
        type: "object",
        properties: {
          query: { type: "string" },
          scope: { type: "string", enum: ["project", "global", "all"], description: 'Defaults to "all".' },
          limit: { type: "integer", minimum: 1, maximum: 100, description: "Defaults to 20." },
        },
        additionalProperties: false,
      },
      execute: guard(async (input, ctx) => {
        const i = obj(input)
        const query = typeof i.query === "string" ? i.query : ""
        const scopes: Scope[] = i.scope === "global" ? ["global"] : i.scope === "project" ? ["project"] : ["project", "global"]
        const limit = typeof i.limit === "number" && Number.isFinite(i.limit) ? Math.min(100, Math.max(1, Math.trunc(i.limit))) : 20
        const found = await store.search(scopes, await project(ctx.sessionID), query, limit)
        return { content: found.length ? found.map(show).join("\n") : "No matching memories." }
      }),
    },
  ]
}
