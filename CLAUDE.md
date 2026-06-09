# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Last updated: May 2026 | Status: Week 1 MVP complete — chat streaming stable; Week 2: memory pane

---

## 1. Project Overview

**Harness** is an open-source Mac desktop application — a personal AI agent harness for knowledge workers. It provides:
- A streaming AI chat interface (provider-agnostic: Claude, GPT-4o, Gemini, Ollama, Groq)
- A **memory pane** with themed, timeline-based notes the agent can retrieve as context
- A knowledge graph memory system (Kuzu + LanceDB) — Week 3
- A skill library that captures conversations as reusable automations — Week 4
- `/` slash commands to invoke specific sub-agents (e.g. `/memory`, `/add-to-memory`, `/logs`)
- Production-grade structured logging (pino) with opt-in telemetry

**Runtime data directory:** `~/.harness/` (created automatically on first launch)

---

## 2. Commands

```bash
npm install                        # Install dependencies
npm run dev                        # Run dev server (Electron + Vite HMR)
npm run build                      # Production build
npm run typecheck                  # Type-check all processes (no emit)
npm run lint                       # ESLint across src/
npm run rebuild                    # Rebuild native modules for arm64 (Kuzu fix)
npx vitest run                     # Run tests (none written yet — use Vitest when adding)
```

All secrets live encrypted in `~/.harness/config.json` via `safeStorage`. No `.env` file is needed for secrets.

---

## 3. Architecture

### 3.1 Process Boundaries

```
Renderer (React)  ←→  preload/index.ts (contextBridge)  ←→  Main process (Node.js)
```

**The renderer never imports from `src/main/`.** All cross-process communication goes through the IPC bridge. Shared types live in `src/shared/types.ts`.

**The `window.harness` API** (exposed by preload):
- `invoke(channel, ...args)` — two-way, awaitable
- `on(channel, callback)` — one-way push from main, returns unsubscribe fn

Both have allowlists in `src/preload/index.ts`.

---

### 3.2 IPC Contract

**`src/shared/types.ts`** is the single source of truth for all domain types and IPC channel declarations.

`src/main/ipc/types.ts` re-exports everything from `src/shared/types.ts`.

**Every IPC channel must be declared in `src/shared/types.ts` first**, then added to the preload allowlist, then handled in `src/main/ipc/handlers.ts`.

---

### 3.3 Config & Secret Storage

API keys are **immediately encrypted** in main via `configManager.encryptKey()` (OS keychain-backed via `electron.safeStorage`). Stored as base64 ciphertext in `~/.harness/config.json`. Never log or hold plaintext keys.

---

### 3.4 AI Provider Abstraction

All providers implement `AIProvider` (`src/main/ai/AIProvider.ts`):
- `chat()` — non-streaming full response
- `stream()` — async generator yielding `StreamChunk`
- `embed()` — throws for Claude/Groq
- `testConnection()` — cheap validation call

**`ProviderFactory`** is a singleton cache. Call `providerFactory.getProvider(config)`; `providerFactory.reinitialize(config)` after config changes.

---

### 3.5 Streaming Architecture

`AgentRunner.sendMessage(conversationId, message, webContents)`:
1. Append user message to SQLite
2. Run `memoryRepo.search(message)` → inject top-8 results as `<memory>` context block
3. Call `provider.stream(messages, options)` — async generator
4. Each `text_delta` → `webContents.send('stream:delta', ...)`
5. On `done` → persist assistant message + `webContents.send('stream:done', ...)`
6. On error → `webContents.send('stream:error', ...)`

---

### 3.6 Slash Command System

Commands defined in `src/main/commands/registry.ts`. `CommandDispatcher.dispatch()` routes by handler type:
- `layout` → `webContents.send('layout:command', { action })` (renderer's `layoutStore` reacts)
- `memory` → `memoryRepo.insert()` + confirmation via `chat:systemMessage`
- `builtin` → new/clear conversation, help
- `agent` / `skill` / `tool` → intentional stubs, wired in Week 2–4

---

### 3.7 Logging

Always use a category child logger:

```typescript
log.agent.info({ conversationId }, 'Conversation created');
log.memory.debug({ count }, 'Memory context injected');
log.db.error({ err }, 'Query failed');
```

Categories: `log.agent`, `log.api`, `log.db`, `log.browser`, `log.memory`, `log.skill`, `log.mcp`, `log.ui`, `log.main`.

Dev: pretty-printed to stderr + rolling log file + live UI broadcast via pino multistream. Production: rolling NDJSON to `~/.harness/logs/harness.log`.

---

### 3.8 Layout System

Panel visibility is driven by a `data-layout` attribute on the root `<div>` in `PanelLayout.tsx`. CSS transitions handle animation — no JS animation libraries.

```
data-layout="sidebar"          → sidebar visible
data-layout="memory"           → memory pane open (right column, w-80)
data-layout="logs"             → log viewer open (bottom strip, h-56)
```

Layout state lives in `layoutStore` (Zustand) and is debounced (300ms) to `config.json` via `layout:set` IPC.

---

### 3.9 Memory System

**Storage:** SQLite `memory_items` table + `memory_fts` FTS5 virtual table (same pattern as `timeline_fts`). Themes are implicit — distinct values of the `theme` column. Sync triggers keep FTS in sync with inserts/deletes.

**Repository:** `src/main/db/repositories/MemoryRepo.ts`
- `insert(theme, content, source?)` — saves item, returns it
- `listThemes()` — distinct themes sorted alphabetically
- `getByTheme(theme)` — all items for a theme, newest first
- `deleteItem(id)` — removes from base table; FTS trigger handles cleanup
- `search(query)` — FTS5 BM25 rank × recency decay (λ=0.05, ~14-day half-life), top 8

**Context injection:** `AgentRunner.sendMessage` calls `memoryRepo.search(userMessage)` before streaming. Matched items are prepended as a `<memory>` block in the messages array. Injection is silent on error — never blocks chat.

**Slash commands:**
- `/memory` — toggle memory pane
- `/add-to-memory <theme> <content>` — saves item, echoes confirmation in chat

**UI:** `src/renderer/components/memory/MemoryPane.tsx` — two-column layout: theme chips (left) + scrollable timeline (right). Zustand store in `src/renderer/stores/memoryStore.ts`.

**Week 3 Kuzu upgrade:** Run `npm run rebuild` to fix arm64 binary. Add graph nodes for items + `RELATED_TO` edges on co-occurrence. Replace FTS5 anchor with 1–2 hop Kuzu traversal.

---

## 4. Conventions

1. **IPC first:** Add channel to `src/shared/types.ts` + preload allowlist before writing any `ipcMain.handle`.

2. **Shared types only:** Both main and renderer import from `src/shared/types.ts`. Never import across process boundary.

3. **Log everything in main:** Any function touching network, disk, or AI must use a category logger.

4. **No plaintext secrets:** Encrypt immediately via `configManager.encryptKey()`.

5. **Env variable:** `process.env.ELECTRON_RENDERER_URL` (not `VITE_DEV_SERVER_URL`) for dev mode detection.

6. **CSS-only layout:** `data-layout` attribute + CSS transitions. No JS animation libs.

7. **Command stubs stay:** `agent`/`skill`/`tool` cases in `CommandDispatcher.ts` are intentional. Wire when the subsystem is ready.
