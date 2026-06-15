<div align="center">

<img src="https://raw.githubusercontent.com/unison-labs-ai/unison-brain/main/assets/brain.svg" alt="Unison Brain" width="180" />

# @unisonlabs/mastra

### Long-term memory for Mastra agents, powered by the Unison brain.

[![CI](https://github.com/unison-labs-ai/unison-mastra/actions/workflows/ci.yml/badge.svg)](https://github.com/unison-labs-ai/unison-mastra/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@unisonlabs/mastra)](https://www.npmjs.com/package/@unisonlabs/mastra)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/unison-labs-ai/unison-mastra?style=social)](https://github.com/unison-labs-ai/unison-mastra)

[**Install**](#install) • [**Quick start**](#quick-start) • [**Options**](#options) • [**Exports**](#exports) • [**For agents**](#agents)

</div>

---

> **🤖 Reading this as an AI agent?** Jump to [`AGENTS.md`](./AGENTS.md) — it covers
> install, auth, attaching `UnisonMastraMemory` to a Mastra `Agent`, and the
> full env-var reference.

`UnisonMastraMemory` extends Mastra's `MastraMemory` class. Before each LLM turn,
Mastra calls `getSystemMessage()` — this package uses that hook to recall relevant
context from the Unison brain and inject it as a `[UNISON MEMORY]` block in the
system prompt. Messages saved after each turn are automatically persisted to the
Unison brain for future recall. Thread and message state is kept in-process;
the Unison brain is the durable long-term store.

**Targeted API:** `@mastra/core` **^0.10.x** (tested on 0.10.15)

---

## Install

```bash
npm i @unisonlabs/mastra @mastra/core
```

---

## Quick start

```ts
import { Agent } from "@mastra/core";
import { openai } from "@ai-sdk/openai";
import { UnisonMastraMemory } from "@unisonlabs/mastra";

const memory = new UnisonMastraMemory({
  token: process.env.UNISON_TOKEN,   // usk_live_...
  recallK: 5,
});

const agent = new Agent({
  name: "my-assistant",
  instructions: "You are a helpful assistant with long-term memory.",
  model: openai("gpt-4o"),
  memory,
});

// Mastra calls memory.getSystemMessage() automatically before each LLM call.
const thread = await memory.createThread({ resourceId: "user_123" });

const response = await agent.generate("What did we discuss last week?", {
  memory: { thread: thread.id, resource: "user_123" },
});

// Persist the exchange to the Unison brain for future recall.
await memory.persistTurn(thread.id, [
  { role: "user",      content: "What did we discuss last week?" },
  { role: "assistant", content: response.text },
]);
```

---

## Standalone usage (no Mastra coupling)

```ts
import { UnisonMemory } from "@unisonlabs/mastra";

const mem = new UnisonMemory({ token: process.env.UNISON_TOKEN });

const { contextMd, weakEvidence } = await mem.recall("project status");
if (!weakEvidence) console.log(contextMd);

await mem.persist(
  [
    { role: "user",      content: "What is the project?" },
    { role: "assistant", content: "A long-term memory provider for Mastra." },
  ],
  "session_abc"
);
```

---

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | `process.env.UNISON_TOKEN` | Unison bearer token (`usk_live_...`). |
| `apiUrl` | `string` | `process.env.UNISON_API_URL` or `https://brain.unisonlabs.ai` | Base URL for the Unison brain API. |
| `recallK` | `number` | `5` | Number of hits to retrieve per recall call. |
| `includeWeakEvidence` | `boolean` | `false` | Inject recalled context even when the brain signals weak evidence. |

## Environment variables

| Variable | Description |
|---|---|
| `UNISON_TOKEN` | Unison bearer token. Used when the `token` option is omitted. |
| `UNISON_API_URL` | Override the brain base URL. Useful for self-hosted deployments. |

---

## Exports

| Export | Description |
|---|---|
| `UnisonMastraMemory` | Full `MastraMemory` subclass — attach via `new Agent({ memory })`. |
| `UnisonMemory` | Standalone facade with `recall()` and `persist()` — zero Mastra coupling. |
| `UnisonMemoryProcessor` | `MemoryProcessor` subclass for the processor pattern. |
| `UnisonClient` | Low-level typed HTTP client for `GET /v1/brain/context` and `POST /v1/brain/ingest`. |

---

## Agents

See [`AGENTS.md`](./AGENTS.md) for the full agent onboarding guide: install, auth,
attaching `UnisonMastraMemory` to a Mastra `Agent`, env vars, and contributor commands.

---

## Unison brain HTTP contract

- **Recall:** `GET /v1/brain/context?q=<query>&k=<n>&mode=auto`
  Returns `{ contextMd, weakEvidence, hits[] }`.
- **Ingest:** `POST /v1/brain/ingest`
  Body: `{ items: [{ type: "conversation", turns, sourceRef, visibility: "private" }] }`

All requests use `Authorization: Bearer <token>`.

---

## Releasing

`npm login` once, then:

```bash
bun run release
```

Builds, publishes `@unisonlabs/mastra` to npm (idempotent — skips if the version is already published), then tags and pushes the release commit.

---

## Links

- [Unison Labs](https://unisonlabs.ai)
- [Docs](https://unisonlabs.ai/docs)
- [unison-brain repo](https://github.com/unison-labs-ai/unison-brain)
- [Mastra documentation](https://mastra.ai/docs)

---

## Part of the Unison Labs constellation

**One brain, every agent.** Every repo below reads from _and writes to_ the same [Unison brain](https://unisonlabs.ai) — no per-tool memory silos.

| Repo | What it does |
|---|---|
| **[unison-brain](https://github.com/unison-labs-ai/unison-brain)** | **CLI · SDK · MCP server — the core** |
| [claude-unison](https://github.com/unison-labs-ai/claude-unison) | Memory for Claude Code |
| [cursor-unison](https://github.com/unison-labs-ai/cursor-unison) | Memory for Cursor |
| [codex-unison](https://github.com/unison-labs-ai/codex-unison) | Memory for OpenAI Codex CLI |
| [opencode-unison](https://github.com/unison-labs-ai/opencode-unison) | Memory for OpenCode |
| [openclaw-unison](https://github.com/unison-labs-ai/openclaw-unison) | Memory for OpenClaw |
| [pipecat-unison](https://github.com/unison-labs-ai/pipecat-unison) | Memory for Pipecat voice agents |
| [langchain-unison](https://github.com/unison-labs-ai/langchain-unison) | LangChain memory, history & retriever |
| [llama-index-memory-unison](https://github.com/unison-labs-ai/llama-index-memory-unison) | LlamaIndex memory provider |
| [unison-ai-sdk](https://github.com/unison-labs-ai/unison-ai-sdk) | Vercel AI SDK memory middleware |
| **[unison-mastra](https://github.com/unison-labs-ai/unison-mastra)** | **Mastra agent memory provider ← you are here** |
| [python-sdk](https://github.com/unison-labs-ai/python-sdk) | Python SDK for the brain |
| [install-mcp](https://github.com/unison-labs-ai/install-mcp) | One-command MCP installer |
| [unison-fs](https://github.com/unison-labs-ai/unison-fs) | Mount the brain as a filesystem |
| [backchannel](https://github.com/unison-labs-ai/backchannel) | Async messaging between agents |
| [Unison-evals](https://github.com/unison-labs-ai/Unison-evals) | Open memory benchmark suite |

---

MIT © Unison Labs
