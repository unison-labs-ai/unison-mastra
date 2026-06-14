# @unisonlabs/mastra

[![CI](https://github.com/unison-labs-ai/unison-mastra/actions/workflows/ci.yml/badge.svg)](https://github.com/unison-labs-ai/unison-mastra/actions/workflows/ci.yml)

Long-term memory for [Mastra](https://mastra.ai) agents, powered by the [Unison brain](https://unisonlabs.ai).

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

## Unison brain HTTP contract

- **Recall:** `GET /v1/brain/context?q=<query>&k=<n>&mode=auto`
  Returns `{ contextMd, weakEvidence, hits[] }`.
- **Ingest:** `POST /v1/brain/ingest`
  Body: `{ items: [{ type: "conversation", turns, sourceRef, visibility: "private" }] }`

All requests use `Authorization: Bearer <token>`.

---

## Releasing

CI runs on every push and pull request. To publish a new version to npm:

1. Set the `NPM_TOKEN` secret in the GitHub repo settings (Settings → Secrets → Actions).
2. Tag the commit:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The `release.yml` workflow picks up `v*` tags, builds, and runs `npm publish --access public --provenance`.

---

## Links

- [Unison Labs](https://unisonlabs.ai)
- [Docs](https://unisonlabs.ai/docs)
- [unison-brain repo](https://github.com/unison-labs-ai/unison-brain)
- [Mastra documentation](https://mastra.ai/docs)

---

Powered by the Unison brain.
