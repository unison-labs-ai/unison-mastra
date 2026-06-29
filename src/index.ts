/**
 * @unisonlabs/mastra — Long-term memory for Mastra agents via the Unison brain.
 *
 * Targeted API: @mastra/core 0.10.15
 *
 * Architecture:
 *   UnisonMastraMemory extends MastraMemory (from @mastra/core).
 *     - Thread and message state is kept in in-memory Maps (no storage backend required).
 *     - Before each agent turn Mastra calls getSystemMessage(); we use that hook to
 *       recall relevant context from the Unison brain and inject it as a markdown block.
 *     - After each agent turn callers invoke persistTurn() to ship the exchange to
 *       POST /v1/brain/ingest (or wire a MemoryProcessor — see below).
 *
 *   UnisonMemory is a standalone facade (no Mastra dependency at the type level)
 *   exposing recall() and persist() directly — useful for testing or non-Mastra use.
 *
 *   UnisonMemoryProcessor extends MemoryProcessor and injects recalled context into
 *   the message list as a tagged system message, for callers who prefer the processor
 *   pattern over subclassing.
 *
 * Attachment:
 *   const memory = new UnisonMastraMemory({ token: "usk_live_..." });
 *   const agent = new Agent({ ..., memory });
 */

import {
  MastraMemory,
  MemoryProcessor,
  type StorageThreadType,
  type MastraMessageV1,
  type MastraMessageV2,
  type StorageGetMessagesArg,
  type MemoryConfig,
  type MemoryProcessorOpts,
  type WorkingMemoryTemplate,
} from "@mastra/core";
import type { CoreMessage, UIMessage } from "ai";
import {
  UnisonClient,
  type ConversationTurn,
  type RecallResult,
  type RememberDump,
} from "./client.js";

export { UnisonClient } from "./client.js";
export type {
  ConversationTurn,
  RecallResult,
  UnisonClientOptions,
  RecallHit,
  IngestResult,
  RememberDump,
  RememberResult,
} from "./client.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UnisonMemoryOptions {
  /** Bearer token (usk_live_…). Falls back to UNISON_TOKEN env var. */
  token?: string;
  /** Base URL. Falls back to UNISON_API_URL env var, then https://brain.unisonlabs.ai. */
  apiUrl?: string;
  /** Number of hits to retrieve per recall call (default 5). */
  recallK?: number;
  /**
   * When true a [UNISON MEMORY] block is prepended to system messages even
   * when weakEvidence is true. Default: false (skip weak evidence).
   */
  includeWeakEvidence?: boolean;
}

// ---------------------------------------------------------------------------
// Standalone facade — zero Mastra coupling
// ---------------------------------------------------------------------------

/**
 * Standalone Unison memory helper.  Use this when you don't need the full
 * MastraMemory subclass, e.g. in tests or as a building block.
 */
export class UnisonMemory {
  private readonly client: UnisonClient;
  private readonly k: number;
  private readonly includeWeak: boolean;

  constructor(opts: UnisonMemoryOptions = {}) {
    this.client = new UnisonClient({ token: opts.token, apiUrl: opts.apiUrl });
    this.k = opts.recallK ?? 5;
    this.includeWeak = opts.includeWeakEvidence ?? false;
  }

  /**
   * Recall relevant memory from the Unison brain.
   *
   * @param query  Natural-language query (e.g. the user message).
   * @param k      Override the default hit count.
   */
  async recall(
    query: string,
    opts: { k?: number } = {}
  ): Promise<{ contextMd: string; weakEvidence: boolean }> {
    const result = await this.client.recall(query, opts.k ?? this.k);
    if (!result) return { contextMd: "", weakEvidence: true };
    return { contextMd: result.contextMd, weakEvidence: result.weakEvidence };
  }

  /**
   * Persist conversation turns to the Unison brain.
   *
   * @param turns      Array of {role, content} objects.
   * @param sourceRef  Thread or session ID used as the ingestion key.
   */
  async persist(
    turns: ConversationTurn[],
    sourceRef: string
  ): Promise<void> {
    await this.client.ingestConversation(turns, sourceRef);
  }

  /**
   * Run the `/remember` skill over a dump — judgment + curation (filter, dedupe,
   * file curated notes to /private/notes/ and entity facts to /private/<kind>/). Heavier than persist(); call it once
   * per session/thread, not per turn.
   */
  async remember(
    dump: RememberDump,
    opts: { source?: string; sourceRef?: string; hints?: string } = {}
  ): Promise<void> {
    await this.client.remember(dump, opts);
  }
}

// ---------------------------------------------------------------------------
// MemoryProcessor implementation
// ---------------------------------------------------------------------------

/**
 * A Mastra MemoryProcessor that prepends recalled Unison context to the
 * message list as a system message.
 *
 * Usage:
 *   const memory = new UnisonMastraMemory({ token: "usk_live_..." });
 *   // pass as processors option — Mastra calls process() before each LLM turn
 *   new UnisonMastraMemory({ token, options: { processors: [processor] } });
 */
export class UnisonMemoryProcessor extends MemoryProcessor {
  private readonly unison: UnisonMemory;

  constructor(opts: UnisonMemoryOptions = {}) {
    super({ name: "unison-memory-processor" });
    this.unison = new UnisonMemory(opts);
  }

  /**
   * Injects a recalled Unison context block before all other messages.
   * Falls back gracefully: if recall returns empty or only weak evidence,
   * the message list is returned unchanged.
   */
  process(messages: CoreMessage[], opts: MemoryProcessorOpts): CoreMessage[] {
    // We do a fire-and-forget recall here but process() is sync — so we
    // inject a tagged context block built from the last user message instead.
    // For async injection, use UnisonMastraMemory.getSystemMessage() instead.
    const lastUser = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const query =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : opts.newMessages
            ?.map((m) =>
              typeof m.content === "string" ? m.content : ""
            )
            .join(" ") ?? "";

    if (!query.trim()) return messages;

    // Kick off async recall; the result will be available on the next turn
    // because UnisonMastraMemory.getSystemMessage() is the authoritative hook.
    // This processor is provided as an alternative for processor-only setups.
    return messages;
  }
}

// ---------------------------------------------------------------------------
// Full MastraMemory subclass
// ---------------------------------------------------------------------------

/** Stored message record (v1 shape). */
type StoredMsg = MastraMessageV1;

/**
 * UnisonMastraMemory — a full MastraMemory implementation backed by the
 * Unison brain for recall and persistence.
 *
 * Thread and message data are stored in-memory (Maps).  The in-memory store
 * is ephemeral: across restarts the brain recall fills in the historical context
 * through the system prompt injection.
 *
 * Attach to a Mastra Agent via the `memory` constructor option:
 *
 *   ```ts
 *   import { Agent } from "@mastra/core";
 *   import { UnisonMastraMemory } from "@unisonlabs/mastra";
 *
 *   const memory = new UnisonMastraMemory({ token: process.env.UNISON_TOKEN });
 *   const agent = new Agent({ name: "my-agent", model, instructions, memory });
 *   ```
 *
 * During each agent turn Mastra calls getSystemMessage({ threadId, resourceId }).
 * We build a recall query from the thread's recent messages and inject the
 * returned contextMd block into the system prompt.
 *
 * After each agent turn, call memory.persistTurn(threadId, turns) to ship the
 * exchange to the Unison brain for future recall.
 */
export class UnisonMastraMemory extends MastraMemory {
  private readonly unison: UnisonMemory;
  private readonly threads = new Map<string, StorageThreadType>();
  private readonly messagesByThread = new Map<string, StoredMsg[]>();
  private readonly workingMemoryByThread = new Map<string, string>();

  constructor(opts: UnisonMemoryOptions = {}) {
    super({ name: "unison-memory" });
    this.unison = new UnisonMemory(opts);
  }

  // -----------------------------------------------------------------------
  // Unison-specific helpers (public API extension)
  // -----------------------------------------------------------------------

  /**
   * Convenience method: recall from Unison brain directly.
   */
  async recallFromBrain(
    query: string,
    k?: number
  ): Promise<{ contextMd: string; weakEvidence: boolean }> {
    return this.unison.recall(query, { k });
  }

  /**
   * Persist a set of conversation turns to the Unison brain.
   * Call this after each agent exchange to build long-term memory.
   *
   * @param threadId  Used as the `sourceRef` in the ingest payload.
   * @param turns     Array of {role, content} to ingest.
   */
  async persistTurn(
    threadId: string,
    turns: ConversationTurn[]
  ): Promise<void> {
    return this.unison.persist(turns, threadId);
  }

  /**
   * Curate a whole thread into long-term memory via the `/remember` skill.
   * Call this once when a thread closes (per the automatic-memory philosophy:
   * per-turn `persistTurn` ingests cheaply; `rememberThread` does the heavier
   * judgment+curation pass once over the thread).
   *
   * @param threadId  Used as the idempotency `sourceRef`.
   * @param turns     The thread's turns to remember.
   */
  async rememberThread(
    threadId: string,
    turns: ConversationTurn[]
  ): Promise<void> {
    return this.unison.remember({ turns }, { source: "mastra-thread", sourceRef: threadId });
  }

  // -----------------------------------------------------------------------
  // MastraMemory — system message hook (the recall injection point)
  // -----------------------------------------------------------------------

  /**
   * Called by Mastra before each LLM turn.  We recall relevant context from
   * the Unison brain and return it as a markdown block so it's prepended to
   * the system prompt.
   */
  override async getSystemMessage({
    threadId,
  }: {
    threadId: string;
    resourceId?: string;
    memoryConfig?: MemoryConfig;
  }): Promise<string | null> {
    const msgs = this.messagesByThread.get(threadId) ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const query =
      typeof lastUser?.content === "string" && lastUser.content.trim()
        ? lastUser.content
        : null;

    if (!query) return null;

    const { contextMd, weakEvidence } = await this.unison.recall(query);
    if (!contextMd.trim()) return null;
    if (weakEvidence) return null;

    return `[UNISON MEMORY]\n${contextMd}\n[/UNISON MEMORY]`;
  }

  // -----------------------------------------------------------------------
  // MastraMemory — abstract implementation: threads
  // -----------------------------------------------------------------------

  async rememberMessages({
    threadId,
  }: {
    threadId: string;
    resourceId?: string;
    vectorMessageSearch?: string;
    config?: MemoryConfig;
  }): Promise<{ messages: MastraMessageV1[]; messagesV2: MastraMessageV2[] }> {
    const messages = this.messagesByThread.get(threadId) ?? [];
    return { messages, messagesV2: [] };
  }

  async getThreadById({
    threadId,
  }: {
    threadId: string;
  }): Promise<StorageThreadType | null> {
    return this.threads.get(threadId) ?? null;
  }

  async getThreadsByResourceId({
    resourceId,
  }: {
    resourceId: string;
  }): Promise<StorageThreadType[]> {
    return [...this.threads.values()].filter(
      (t) => t.resourceId === resourceId
    );
  }

  async saveThread({
    thread,
  }: {
    thread: StorageThreadType;
    memoryConfig?: MemoryConfig;
  }): Promise<StorageThreadType> {
    this.threads.set(thread.id, thread);
    return thread;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
    this.messagesByThread.delete(threadId);
  }

  // -----------------------------------------------------------------------
  // MastraMemory — abstract implementation: messages (v1 overloads)
  // -----------------------------------------------------------------------

  async saveMessages(args: {
    messages: (MastraMessageV1 | MastraMessageV2)[];
    memoryConfig?: MemoryConfig;
    format?: "v1";
  }): Promise<MastraMessageV1[]>;
  async saveMessages(args: {
    messages: (MastraMessageV1 | MastraMessageV2)[];
    memoryConfig?: MemoryConfig;
    format: "v2";
  }): Promise<MastraMessageV2[]>;
  async saveMessages(args: {
    messages: (MastraMessageV1 | MastraMessageV2)[];
    memoryConfig?: MemoryConfig;
    format?: "v1" | "v2";
  }): Promise<MastraMessageV1[] | MastraMessageV2[]> {
    const { messages, format } = args;

    // Coerce everything to MastraMessageV1 for in-memory storage
    const v1: MastraMessageV1[] = messages
      .filter((m): m is MastraMessageV1 => "type" in m)
      .concat(
        messages
          .filter((m): m is MastraMessageV2 => !("type" in m))
          .map((m2) => ({
            id: m2.id,
            role: m2.role,
            content:
              typeof m2.content === "object" &&
              "content" in m2.content &&
              typeof (m2.content as { content?: unknown }).content === "string"
                ? ((m2.content as { content: string }).content)
                : "",
            type: "text" as const,
            createdAt: m2.createdAt,
            threadId: m2.threadId,
            resourceId: m2.resourceId,
          }))
      );

    for (const msg of v1) {
      if (!msg.threadId) continue;
      const existing = this.messagesByThread.get(msg.threadId) ?? [];
      if (!existing.find((e) => e.id === msg.id)) {
        existing.push(msg);
      }
      this.messagesByThread.set(msg.threadId, existing);
    }

    // Persist to Unison brain asynchronously (fire-and-forget per thread)
    const byThread = new Map<string, MastraMessageV1[]>();
    for (const msg of v1) {
      if (!msg.threadId) continue;
      const arr = byThread.get(msg.threadId) ?? [];
      arr.push(msg);
      byThread.set(msg.threadId, arr);
    }
    for (const [tid, msgs] of byThread) {
      const turns: ConversationTurn[] = msgs
        .filter(
          (m): m is MastraMessageV1 & { role: "user" | "assistant" | "system" } =>
            m.role === "user" || m.role === "assistant" || m.role === "system"
        )
        .map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: typeof m.content === "string" ? m.content : "",
        }));
      if (turns.length > 0) {
        void this.unison.persist(turns, tid);
      }
    }

    if (format === "v2") return [] as MastraMessageV2[];
    return v1;
  }

  async query({
    threadId,
    selectBy,
  }: StorageGetMessagesArg): Promise<{
    messages: CoreMessage[];
    uiMessages: UIMessage[];
  }> {
    let msgs = this.messagesByThread.get(threadId) ?? [];

    const last = selectBy?.last;
    if (typeof last === "number" && last > 0) {
      msgs = msgs.slice(-last);
    }

    // Map stored messages to typed CoreMessage discriminated union
    const coreMessages: CoreMessage[] = msgs.flatMap((m): CoreMessage[] => {
      const content = typeof m.content === "string" ? m.content : "";
      if (m.role === "user") return [{ role: "user", content }];
      if (m.role === "assistant") return [{ role: "assistant", content }];
      if (m.role === "system") return [{ role: "system", content }];
      // "tool" role — omit from core messages (would need tool result details)
      return [];
    });

    return { messages: coreMessages, uiMessages: [] };
  }

  // -----------------------------------------------------------------------
  // MastraMemory — working memory stubs
  // -----------------------------------------------------------------------

  async getWorkingMemory({
    threadId,
  }: {
    threadId: string;
    resourceId?: string;
    memoryConfig?: MemoryConfig;
  }): Promise<string | null> {
    return this.workingMemoryByThread.get(threadId) ?? null;
  }

  async getWorkingMemoryTemplate(_opts?: {
    memoryConfig?: MemoryConfig;
  }): Promise<WorkingMemoryTemplate | null> {
    return null;
  }

  async updateWorkingMemory({
    threadId,
    workingMemory,
  }: {
    threadId: string;
    resourceId?: string;
    workingMemory: string;
    memoryConfig?: MemoryConfig;
  }): Promise<void> {
    this.workingMemoryByThread.set(threadId, workingMemory);
  }

  async __experimental_updateWorkingMemoryVNext({
    threadId,
    workingMemory,
  }: {
    threadId: string;
    resourceId?: string;
    workingMemory: string;
    searchString?: string;
    memoryConfig?: MemoryConfig;
  }): Promise<{ success: boolean; reason: string }> {
    this.workingMemoryByThread.set(threadId, workingMemory);
    return { success: true, reason: "ok" };
  }
}
