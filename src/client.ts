/**
 * Thin typed HTTP client for the Unison Brain API.
 *
 * Uses the global `fetch` available in Node 18+ — no extra runtime deps.
 * All errors are caught and return `null` / empty arrays so callers always
 * get a result they can safely destructure (graceful degradation).
 */

const DEFAULT_API_URL = "https://brain.unisonlabs.ai";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface RecallHit {
  path: string;
  title: string;
  score: number;
  highlight: string;
  bodyMd?: string;
}

export interface RecallResult {
  contextMd: string;
  weakEvidence: boolean;
  hits: RecallHit[];
}

export interface IngestResult {
  jobId: string;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface UnisonClientOptions {
  /** Bearer token (usk_live_…). Falls back to UNISON_TOKEN env var. */
  token?: string;
  /** Base URL. Falls back to UNISON_API_URL env var, then the default. */
  apiUrl?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class UnisonClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(opts: UnisonClientOptions = {}) {
    const token = opts.token ?? process.env["UNISON_TOKEN"] ?? "";
    const rawUrl =
      opts.apiUrl ??
      process.env["UNISON_API_URL"] ??
      DEFAULT_API_URL;
    this.baseUrl = rawUrl.replace(/\/$/, "");
    this.headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * GET /v1/brain/context — hybrid recall.
   *
   * @param query  Natural-language query.
   * @param k      Number of hits to return (default 5).
   * @returns Recall result or null on error.
   */
  async recall(query: string, k = 5): Promise<RecallResult | null> {
    const params = new URLSearchParams({
      q: query,
      k: String(k),
      mode: "auto",
    });
    try {
      const res = await fetch(
        `${this.baseUrl}/v1/brain/context?${params.toString()}`,
        { headers: this.headers }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        contextMd?: string;
        weakEvidence?: boolean;
        // /v1/brain/context hits are flat (path/title/snippet at top level),
        // unlike /v1/brain/search hits which nest under `doc` with `highlight`.
        hits?: Array<{
          score?: number;
          snippet?: string;
          path?: string;
          title?: string;
        }>;
      };
      return {
        contextMd: data.contextMd ?? "",
        weakEvidence: Boolean(data.weakEvidence),
        hits: (data.hits ?? []).map((h) => ({
          path: h.path ?? "",
          title: h.title ?? "",
          score: h.score ?? 0,
          highlight: h.snippet ?? "",
          bodyMd: undefined,
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * POST /v1/brain/ingest — persist conversation turns.
   *
   * @param turns      Array of {role, content} objects.
   * @param sourceRef  Thread or resource ID used as the ingestion key.
   * @returns IngestResult or null on error.
   */
  async ingestConversation(
    turns: ConversationTurn[],
    sourceRef: string
  ): Promise<IngestResult | null> {
    const body = {
      items: [
        {
          type: "conversation",
          turns,
          sourceRef,
          visibility: "private",
        },
      ],
    };
    try {
      const res = await fetch(`${this.baseUrl}/v1/brain/ingest`, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        items?: Array<{ jobId?: string }>;
      };
      return { jobId: data.items?.[0]?.jobId ?? "" };
    } catch {
      return null;
    }
  }
}
