import { Plugin } from "@opencode/plugin"
import { parseOptions } from "./options.ts"
import { renderMemory } from "./render.ts"
import { MemoryStore, type KV } from "./store.ts"
import { buildTools } from "./tools.ts"

const PROJECT_TTL_MS = 30_000

export const PLUGIN_ID = "opencode-memory"

export async function setup(ctx: Plugin.Context): Promise<void> {
  const options = parseOptions(ctx.options)
  if (!options.enabled) return

  const store = new MemoryStore(ctx.storage as unknown as KV, options)

  // A session can move between projects, so the lookup is cached only briefly.
  const cache = new Map<string, { projectID: string | undefined; at: number }>()
  const project = async (sessionID: string): Promise<string | undefined> => {
    const hit = cache.get(sessionID)
    if (hit && Date.now() - hit.at < PROJECT_TTL_MS) return hit.projectID
    const info = await ctx.session.get({ sessionID: sessionID as never })
    const projectID: string | undefined = info?.projectID
    cache.set(sessionID, { projectID, at: Date.now() })
    return projectID
  }

  ctx.tool.transform((editor) => {
    editor.namespace({ name: "memory", description: "Persistent memory across sessions" })
    for (const tool of buildTools(store, project, options)) {
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        // Direct tools, not behind Code Mode: the model should see these without extra steps.
        options: { namespace: "memory", codemode: false },
        execute: (input, toolCtx) => tool.execute(input, { sessionID: toolCtx.sessionID }),
      })
    }
  })

  await ctx.session.hook("context", async (event) => {
    try {
      const projectID = await project(event.sessionID)
      const [global, scoped] = await Promise.all([
        store.list("global"),
        projectID ? store.list("project", projectID) : Promise.resolve([]),
      ])
      const block = renderMemory(
        [
          { title: "Project", memories: scoped },
          { title: "Global", memories: global },
        ],
        options.maxChars,
      )
      if (block) event.system.push({ type: "text", text: block })
    } catch {
      // Memory is best-effort and must never break a model call.
    }
  })
}
