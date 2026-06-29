/**
 * Tests for @unisonlabs/mastra — mocks global fetch, no network.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnisonClient } from "./client.js";
import { UnisonMemory, UnisonMastraMemory } from "./index.js";

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

// ---------------------------------------------------------------------------
// UnisonClient — low-level HTTP contract
// ---------------------------------------------------------------------------

describe("UnisonClient", () => {
  describe("recall", () => {
    it("GETs /v1/brain/context with q, k, mode params", async () => {
      const fetch = mockFetch(200, {
        contextMd: "Some context",
        weakEvidence: false,
        hits: [],
      });
      vi.stubGlobal("fetch", fetch);

      const client = new UnisonClient({ token: "usk_live_test", apiUrl: "https://brain.unisonlabs.ai" });
      const result = await client.recall("what is the capital of France", 3);

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/v1/brain/context");
      expect(url).toContain("q=");
      expect(url).toContain("k=3");
      expect(url).toContain("mode=auto");
      expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe(
        "Bearer usk_live_test"
      );

      expect(result?.contextMd).toBe("Some context");
      expect(result?.weakEvidence).toBe(false);
    });

    it("returns null on non-ok response", async () => {
      vi.stubGlobal("fetch", mockFetch(500, {}));
      const client = new UnisonClient({ token: "t" });
      const result = await client.recall("query");
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network")));
      const client = new UnisonClient({ token: "t" });
      const result = await client.recall("query");
      expect(result).toBeNull();
    });

    it("maps hits from response", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch(200, {
          contextMd: "ctx",
          weakEvidence: true,
          hits: [
            {
              score: 0.9,
              snippet: "some highlight",
              path: "/private/notes/foo.md",
              title: "Foo",
            },
          ],
        })
      );
      const client = new UnisonClient({ token: "t" });
      const result = await client.recall("q");
      expect(result?.hits).toHaveLength(1);
      expect(result?.hits[0]?.path).toBe("/private/notes/foo.md");
      expect(result?.hits[0]?.score).toBe(0.9);
    });
  });

  describe("ingestConversation", () => {
    it("POSTs /v1/brain/ingest with correct payload shape", async () => {
      const fetch = mockFetch(200, { items: [{ jobId: "job_abc" }] });
      vi.stubGlobal("fetch", fetch);

      const client = new UnisonClient({ token: "usk_live_test", apiUrl: "https://brain.unisonlabs.ai" });
      const result = await client.ingestConversation(
        [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
        ],
        "thread_001"
      );

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit & { body: string }];
      expect(url).toContain("/v1/brain/ingest");
      expect((init as { headers: Record<string, string> }).headers["Authorization"]).toBe(
        "Bearer usk_live_test"
      );
      expect(init.method).toBe("POST");

      const body = JSON.parse(init.body as string);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].type).toBe("conversation");
      expect(body.items[0].sourceRef).toBe("thread_001");
      expect(body.items[0].visibility).toBe("private");
      expect(body.items[0].turns).toHaveLength(2);
      expect(body.items[0].turns[0].role).toBe("user");
      expect(body.items[0].turns[1].role).toBe("assistant");

      expect(result?.jobId).toBe("job_abc");
    });

    it("returns null on error", async () => {
      vi.stubGlobal("fetch", mockFetch(400, { error: "bad request" }));
      const client = new UnisonClient({ token: "t" });
      const result = await client.ingestConversation([], "ref");
      expect(result).toBeNull();
    });
  });

  describe("remember", () => {
    it("POSTs /v1/brain/remember with the dump + opts and returns jobId", async () => {
      const fetch = mockFetch(200, { jobId: "job_rem" });
      vi.stubGlobal("fetch", fetch);

      const client = new UnisonClient({ token: "usk_live_test", apiUrl: "https://brain.unisonlabs.ai" });
      const result = await client.remember(
        { turns: [{ role: "user", content: "we chose Postgres" }] },
        { source: "mastra-thread", sourceRef: "thread_001" }
      );

      const [url, init] = fetch.mock.calls[0] as [string, RequestInit & { body: string }];
      expect(url).toContain("/v1/brain/remember");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.dump.turns[0].content).toBe("we chose Postgres");
      expect(body.source).toBe("mastra-thread");
      expect(body.sourceRef).toBe("thread_001");
      expect(result?.jobId).toBe("job_rem");
    });

    it("returns null on error", async () => {
      vi.stubGlobal("fetch", mockFetch(401, { error: "unauth" }));
      const client = new UnisonClient({ token: "t" });
      expect(await client.remember("x")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// UnisonMemory — standalone facade
// ---------------------------------------------------------------------------

describe("UnisonMemory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("recall returns contextMd and weakEvidence", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, { contextMd: "Recall text", weakEvidence: false, hits: [] })
    );
    const mem = new UnisonMemory({ token: "t" });
    const result = await mem.recall("some query");
    expect(result.contextMd).toBe("Recall text");
    expect(result.weakEvidence).toBe(false);
  });

  it("recall returns empty strings on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
    const mem = new UnisonMemory({ token: "t" });
    const result = await mem.recall("query");
    expect(result.contextMd).toBe("");
    expect(result.weakEvidence).toBe(true);
  });

  it("persist calls ingestConversation", async () => {
    const fetch = mockFetch(200, { results: [{ jobId: "j1" }] });
    vi.stubGlobal("fetch", fetch);
    const mem = new UnisonMemory({ token: "t" });
    await mem.persist([{ role: "user", content: "hey" }], "thread_x");
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(
      (fetch.mock.calls[0] as [string, RequestInit & { body: string }])[1].body as string
    );
    expect(body.items[0].sourceRef).toBe("thread_x");
  });
});

// ---------------------------------------------------------------------------
// UnisonMastraMemory — thread/message management
// ---------------------------------------------------------------------------

describe("UnisonMastraMemory", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default stub: recall returns empty
    vi.stubGlobal("fetch", mockFetch(200, { contextMd: "", weakEvidence: true, hits: [] }));
  });

  it("saves and retrieves a thread", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const thread = {
      id: "t1",
      resourceId: "r1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await mem.saveThread({ thread });
    const found = await mem.getThreadById({ threadId: "t1" });
    expect(found?.id).toBe("t1");
  });

  it("returns null for missing thread", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const found = await mem.getThreadById({ threadId: "nope" });
    expect(found).toBeNull();
  });

  it("getThreadsByResourceId returns matching threads", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const t1 = { id: "t1", resourceId: "r1", createdAt: new Date(), updatedAt: new Date() };
    const t2 = { id: "t2", resourceId: "r2", createdAt: new Date(), updatedAt: new Date() };
    await mem.saveThread({ thread: t1 });
    await mem.saveThread({ thread: t2 });
    const results = await mem.getThreadsByResourceId({ resourceId: "r1" });
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("t1");
  });

  it("saveMessages stores messages and persists to Unison", async () => {
    const fetch = mockFetch(200, { results: [{ jobId: "j" }] });
    vi.stubGlobal("fetch", fetch);

    const mem = new UnisonMastraMemory({ token: "t" });
    const msgs = [
      {
        id: "m1",
        threadId: "t1",
        role: "user" as const,
        content: "Hello brain",
        type: "text" as const,
        createdAt: new Date(),
      },
    ];
    await mem.saveMessages({ messages: msgs });

    const { messages: remembered } = await mem.rememberMessages({ threadId: "t1" });
    expect(remembered).toHaveLength(1);
    expect(remembered[0]?.content).toBe("Hello brain");

    // Unison ingest should have been called (fire-and-forget)
    await new Promise((r) => setTimeout(r, 10));
    const ingestCalls = (fetch.mock.calls as [string][]).filter(([url]) =>
      url.includes("/v1/brain/ingest")
    );
    expect(ingestCalls.length).toBeGreaterThan(0);
  });

  it("query respects selectBy.last", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`,
      threadId: "t1",
      role: "user" as const,
      content: `msg${i}`,
      type: "text" as const,
      createdAt: new Date(),
    }));
    await mem.saveMessages({ messages: msgs });

    const { messages } = await mem.query({ threadId: "t1", selectBy: { last: 2 } });
    expect(messages).toHaveLength(2);
    expect((messages[1] as { content: string }).content).toBe("msg4");
  });

  it("getSystemMessage returns null when no user messages", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const result = await mem.getSystemMessage({ threadId: "t1" });
    expect(result).toBeNull();
  });

  it("getSystemMessage injects context when recall returns strong evidence", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(200, { contextMd: "Long-term context here", weakEvidence: false, hits: [] })
    );
    const mem = new UnisonMastraMemory({ token: "t" });
    await mem.saveMessages({
      messages: [
        {
          id: "m1",
          threadId: "t1",
          role: "user",
          content: "What is the status of the BPI project?",
          type: "text",
          createdAt: new Date(),
        },
      ],
    });
    const sysMsg = await mem.getSystemMessage({ threadId: "t1" });
    expect(sysMsg).toContain("[UNISON MEMORY]");
    expect(sysMsg).toContain("Long-term context here");
  });

  it("deleteThread removes thread and messages", async () => {
    const mem = new UnisonMastraMemory({ token: "t" });
    const thread = { id: "t1", resourceId: "r1", createdAt: new Date(), updatedAt: new Date() };
    await mem.saveThread({ thread });
    await mem.saveMessages({
      messages: [
        { id: "m1", threadId: "t1", role: "user", content: "hi", type: "text", createdAt: new Date() },
      ],
    });
    await mem.deleteThread("t1");
    expect(await mem.getThreadById({ threadId: "t1" })).toBeNull();
    const { messages } = await mem.rememberMessages({ threadId: "t1" });
    expect(messages).toHaveLength(0);
  });

  it("uses UNISON_TOKEN env var when no token option given", async () => {
    process.env["UNISON_TOKEN"] = "env_token_123";
    const fetch = mockFetch(200, { contextMd: "ctx", weakEvidence: false, hits: [] });
    vi.stubGlobal("fetch", fetch);

    const mem = new UnisonMastraMemory();
    await mem.recallFromBrain("test");

    const [, init] = fetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers["Authorization"]).toBe("Bearer env_token_123");
    delete process.env["UNISON_TOKEN"];
  });
});
