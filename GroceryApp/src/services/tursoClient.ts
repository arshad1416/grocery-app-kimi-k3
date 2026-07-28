/**
 * TursoClient — HTTP-based client for Turso/libSQL using the /v2/pipeline API.
 *
 * ⚠️ v1 STATUS: nothing initializes this client. Every credential source was
 * removed (settings fields, Settings UI inputs, build-time env fallback) after
 * a read-write token shipped inside release bundles — any client-held Turso
 * credential is extractable from the built app. isTursoReady() is therefore
 * always false in v1 and all consumers degrade gracefully (Option B — see
 * GOAL_PROMPT_NOTES.md). Post-v1, deals/prices return via a narrow relay-side
 * endpoint; do NOT reintroduce a client-side credential path here.
 *
 * No native dependencies. Works in React Native via plain fetch().
 *
 * API reference: https://docs.turso.tech/sdk/http
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TursoConfig {
  /** Full URL to the Turso DB endpoint: https://<db-name>-<org>.turso.io */
  url: string;
  /** API token (JWT) with read/write permissions */
  token: string;
}

interface PipelineRequest {
  requests: PipelineStmt[];
}

interface PipelineStmt {
  type: 'execute';
  stmt: {
    sql: string;
    args?: (string | number | null)[];
  };
}

interface PipelineResponse {
  results: PipelineResult[];
}

interface PipelineResult {
  type: 'ok' | 'error';
  response?: {
    cols?: { name: string; type: string }[];
    rows?: { columns: (string | number | null)[] }[];
    affected_row_count?: number;
    last_insert_rowid?: string;
  };
  error?: { message: string };
}

/** Shape returned by execute() and each item in batch(). */
export interface ExecuteResult {
  columns: string[];
  rows: any[][];
  affectedRowCount?: number;
  lastInsertRowid?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class TursoClient {
  private url: string;
  private token: string;

  constructor(config: TursoConfig) {
    // Strip trailing slash
    this.url = config.url.replace(/\/+$/, '');
    this.token = config.token;
  }

  /** Execute a single SQL statement with optional positional args. */
  async execute(
    sql: string,
    args?: (string | number | null)[],
  ): Promise<{ columns: string[]; rows: any[][]; affectedRowCount?: number; lastInsertRowid?: string }> {
    const body: PipelineRequest = {
      requests: [{ type: 'execute', stmt: { sql, args } }],
    };

    const res = await fetch(`${this.url}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`Turso HTTP ${res.status}: ${text}`);
    }

    const data: PipelineResponse = await res.json();
    const result = data.results[0];

    if (result.type === 'error') {
      throw new Error(`Turso SQL error: ${result.error?.message ?? 'unknown'}`);
    }

    const cols = result.response?.cols?.map((c) => c.name) ?? [];
    const rows = result.response?.rows?.map((r) => r.columns) ?? [];

    return {
      columns: cols,
      rows,
      affectedRowCount: result.response?.affected_row_count,
      lastInsertRowid: result.response?.last_insert_rowid,
    };
  }

  /** Execute multiple statements in a single pipeline call (atomic-ish).
   *  Returns all results — errors are captured per-statement instead of thrown,
   *  so callers can see which statements succeeded and which failed. */
  async batch(
    statements: { sql: string; args?: (string | number | null)[] }[],
  ): Promise<{ results: (ExecuteResult | { error: string })[] }> {
    const body: PipelineRequest = {
      requests: statements.map((s) => ({
        type: 'execute' as const,
        stmt: { sql: s.sql, args: s.args },
      })),
    };

    const res = await fetch(`${this.url}/v2/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`Turso batch HTTP ${res.status}: ${text}`);
    }

    const data: PipelineResponse = await res.json();

    return {
      results: data.results.map((r) => {
        if (r.type === 'error') {
          return { error: r.error?.message ?? 'unknown' };
        }
        const cols = r.response?.cols?.map((c) => c.name) ?? [];
        const rows = r.response?.rows?.map((row) => row.columns) ?? [];
        return {
          columns: cols,
          rows,
          affectedRowCount: r.response?.affected_row_count,
          lastInsertRowid: r.response?.last_insert_rowid,
        };
      }),
    };
  }

  /** Check if the database is reachable. */
  async ping(): Promise<boolean> {
    try {
      await this.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: TursoClient | null = null;

/**
 * Initialize the Turso client with connection details.
 * Must be called once during app startup (or when settings are loaded).
 */
export function initTurso(config: TursoConfig): TursoClient {
  _instance = new TursoClient(config);
  return _instance;
}

/** Get the singleton Turso client. Throws if not initialized. */
export function getTurso(): TursoClient {
  if (!_instance) {
    throw new Error(
      'Turso client not initialized. Call initTurso() first.',
    );
  }
  return _instance;
}

/** Check if Turso has been initialized. */
export function isTursoReady(): boolean {
  return _instance !== null;
}

/** Reset the singleton (e.g., on settings change). */
export function resetTurso(): void {
  _instance = null;
}
