# opencode-memory-plugin

Persistent memory for [OpenCode](https://opencode.ai) v2. The agent can save durable facts and preferences, and every later session sees them.

## Install

```sh
opencode plugin add github:hokfei/opencode-memory-plugin
```

Or add it to `opencode.jsonc` (with options):

```jsonc
{
  "plugins": [
    { "package": "github:hokfei/opencode-memory-plugin", "options": { "maxChars": 4000 } }
  ]
}
```

## What it does

- **Tools** (always visible to the model, not behind Code Mode):
  - `memory_remember` saves a fact. Scope is `project` or `global`. Saving the same text again refreshes it instead of duplicating.
  - `memory_forget` removes an entry by id.
  - `memory_search` finds entries (all words must match). An empty query lists everything.
- **Context hook:** before each model call, a "Persistent memory" block is appended to the system prompt: project notes, then global notes.

Memory lives in the plugin's own storage (`ctx.storage`). Project memory is keyed by the session's `projectID`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Turn the plugin off without uninstalling |
| `maxChars` | `4000` | Budget for the injected block |
| `maxEntryChars` | `500` | Longest single entry (longer text is truncated) |
| `maxPerScope` | `200` | Entries per scope; the oldest unpinned entry is evicted at the cap |
| `defaultScope` | `"project"` | Scope when the model does not specify one |

## Design notes

- One storage key per entry (`mem/global/<id>`, `mem/project/<projectID>/<id>`), so concurrent writes never clobber a shared index. The id is a hash of the normalized text, which makes dedupe a single key lookup.
- Injection picks pinned entries first, then the most recently updated, within `maxChars`. Chosen entries are rendered in creation order so the block is stable between turns and prompt caching keeps working.
- The block goes in `system`, not in message history, so it survives compaction.
- Entries are flattened to one line with control characters removed. The block tells the model to treat notes as untrusted data, because memory could otherwise carry a persistent prompt injection from content the agent read.
- Hook failures are swallowed; memory never breaks a model call.

## Limitations

- No automatic extraction. The model saves memories only when it decides to call `memory_remember`.
- Search is simple word matching, not semantic.
- Global memory is shared by every project on the install, so don't store anything project-private there.
- Don't ask the agent to store secrets.

## Development

```sh
npm install
npm run typecheck
npm test        # runs the TypeScript directly via Node's type stripping (tested on Node 26)
```

The source uses only erasable TypeScript syntax, so no build step is needed.
