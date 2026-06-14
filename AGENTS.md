# AGENTS.md

Guidance for AI agents. This file covers two jobs — jump to yours:

- **Use unison-mastra** — you're an agent helping someone wire Unison memory into a Mastra agent
- **Contribute to this repo** — you're changing this integration's code

Follows the [AGENTS.md](https://agents.md/) convention. Human contributors: see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Use unison-mastra

### What it does

`@unisonlabs/mastra` provides `UnisonMastraMemory` — a `MastraMemory` subclass that
gives Mastra agents persistent long-term memory backed by the Unison brain.

Before each LLM turn, Mastra calls `getSystemMessage()` — this package uses that hook
to recall relevant context from the Unison brain and inject it as a `[UNISON MEMORY]`
block in the system prompt. Messages saved after each turn are automatically persisted
to the Unison brain for future recall. Thread and message state is kept in-process;
the Unison brain is the durable long-term store.

### Install

```bash
npm i @unisonlabs/mastra @mastra/core
```

### Authenticate

Set your Unison token before running:

```bash
export UNISON_TOKEN="usk_live_..."
```

**Get a token (headless / CI):**

```bash
curl -X POST https://brain.unisonlabs.ai/v1/auth/provision \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# Returns: {"apiKey":"usk_live_...","workspaceId":"..."}

export UNISON_TOKEN="usk_live_..."
```

**Override the API base URL** (e.g. for a self-hosted brain):

```bash
export UNISON_API_URL="http://localhost:4001"
export UNISON_TOKEN="usk_live_..."
```

### Attach UnisonMastraMemory to a Mastra Agent

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

### Environment variables

| Variable | Description |
|---|---|
| `UNISON_TOKEN` | Required. Unison bearer token (`usk_live_...`). |
| `UNISON_API_URL` | Optional. Override the brain base URL (default: `https://brain.unisonlabs.ai`). |

### Constructor options

| Option | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | `process.env.UNISON_TOKEN` | Unison bearer token. |
| `apiUrl` | `string` | `process.env.UNISON_API_URL` or `https://brain.unisonlabs.ai` | Brain API base URL. |
| `recallK` | `number` | `5` | Number of hits to retrieve per recall call. |
| `includeWeakEvidence` | `boolean` | `false` | Inject recalled context even when the brain signals weak evidence. |

### Privacy

Anything wrapped in `<private>...</private>` is redacted before being sent to
the Unison brain. Use this for secrets, tokens, or anything you'd rather not store.

---

## Contributing to this repo

Single-package TypeScript project, built with tsup. Source in `src/`, tests in `src/*.test.ts`.

### Build, test, typecheck

```bash
npm install
npm run build       # compile src/ → dist/ with tsup
npm run typecheck   # TypeScript type-check (tsc --noEmit)
npm test            # run all tests with vitest
```

CI runs all three. All must pass before merging.

### Key conventions

- No additional runtime dependencies beyond `@mastra/core` (peer). Keep the install footprint minimal.
- If the brain is unreachable or the token is missing, fail gracefully — never crash the Mastra agent.
- The client enforces nothing. The Unison backend is the only security boundary. Do not add client-side scope checks or path allow-lists.

### PRs

One logical change per PR. Add or update a test for every new behavior. Run
`npm run build && npm test` before pushing. Security issues: see [`SECURITY.md`](./SECURITY.md).
