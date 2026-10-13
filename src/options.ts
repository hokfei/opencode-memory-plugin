export interface MemoryOptions {
  enabled: boolean
  /** Character budget for the block injected into the system prompt. */
  maxChars: number
  /** Maximum characters kept per memory entry. */
  maxEntryChars: number
  /** Maximum entries per scope (global, and each project). */
  maxPerScope: number
  /** Scope used by memory_remember when the model does not pass one. */
  defaultScope: "project" | "global"
}

export const DEFAULTS: MemoryOptions = {
  enabled: true,
  maxChars: 4000,
  maxEntryChars: 500,
  maxPerScope: 200,
  defaultScope: "project",
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): MemoryOptions {
  const o = raw ?? {}
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULTS.enabled,
    maxChars: int(o.maxChars, DEFAULTS.maxChars, 200, 50_000),
    maxEntryChars: int(o.maxEntryChars, DEFAULTS.maxEntryChars, 20, 5_000),
    maxPerScope: int(o.maxPerScope, DEFAULTS.maxPerScope, 1, 5_000),
    defaultScope: o.defaultScope === "global" ? "global" : "project",
  }
}
