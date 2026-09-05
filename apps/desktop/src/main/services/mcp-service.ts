import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { applyAndRecord, searchNotes, type UseCaseContext } from '@qale/application';

/**
 * The workspace as an MCP server (PLAN-V2 §3.5) — not just a client. A Claude-
 * forward team's existing AI queries the same verified memory. Localhost +
 * bearer-token gated. Two tools:
 *   ask_product  — a cited, dated answer from the memory (read; deterministic)
 *   log_decision — write a decision straight to the vault
 * The other end (Claude Code, Claude Desktop) already ran its own approval
 * step before calling `log_decision`, so Qale does not ask again: the write
 * lands at once and a row appears in Activity, with the usual revert handle.
 */
export class McpService {
  private http: Server | null = null;

  constructor(
    private readonly getContext: () => UseCaseContext | null,
    private readonly getToken: () => string | null,
    private readonly onChanged: () => void,
  ) {}

  isRunning(): boolean {
    return this.http !== null;
  }

  /** Resolves once the port is bound — or after a failed bind, with isRunning() false. */
  start(port: number): Promise<void> {
    if (this.http) return Promise.resolve();
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          // A transport hiccup must not become an unhandled rejection with the
          // HTTP response left hanging open.
          console.error('[qale] MCP request failed:', err instanceof Error ? err.message : err);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal error' }));
        });
      });
      server.on('error', (err) => {
        console.error('[qale] MCP server error:', err);
        // A failed bind (EADDRINUSE) must not leave isRunning() reporting true.
        if (!server.listening) {
          this.http = null;
          resolve();
        }
      });
      // A server that dies after binding must not leave isRunning() true and
      // start() early-returning forever. stop() nulls this.http first, so the
      // identity check keeps an intentional stop from clobbering a restart.
      server.on('close', () => {
        if (this.http === server) this.http = null;
      });
      server.listen(port, '127.0.0.1', () => {
        console.log(`[qale] MCP server on http://127.0.0.1:${port}/mcp`);
        resolve();
      });
      this.http = server;
    });
  }

  async stop(): Promise<void> {
    const server = this.http;
    this.http = null;
    if (!server) return;
    // Sever open streamable-HTTP connections too, or the port stays held and
    // an immediate restart hits EADDRINUSE.
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async restart(port: number): Promise<void> {
    await this.stop();
    await this.start(port);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = this.getToken();
    const auth = req.headers['authorization'];
    if (!token || auth !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized. Set the Qale MCP token.' }));
      return;
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    const body = await readJson(req);
    // Stateless: a fresh server + transport per request (no session affinity).
    const mcp = this.buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch((err: unknown) => {
        console.error('[qale] mcp transport close failed:', err instanceof Error ? err.message : err);
      });
      mcp.close().catch((err: unknown) => {
        console.error('[qale] mcp server close failed:', err instanceof Error ? err.message : err);
      });
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private buildServer(): McpServer {
    const mcp = new McpServer({ name: 'qale', version: '0.1.0' });

    mcp.tool(
      'ask_product',
      'Answer a question from the product memory with citations, or "vet inte" (I don\'t know).',
      { question: z.string() },
      async ({ question }) => {
        const ctx = this.getContext();
        if (!ctx) return textResult('No workspace is open.');
        const hits = searchNotes(ctx, question, 6);
        if (hits.length === 0)
          return textResult('vet inte — no supporting evidence in the memory.');
        const body = hits
          .map((h) => `- ${h.path} (${h.type}) — ${h.summary}\n    ${h.snippet}`)
          .join('\n');
        return textResult(
          `Evidence from the product memory:\n${body}\n\nCite these paths in your answer.`,
        );
      },
    );

    mcp.tool(
      'log_decision',
      'Write a product decision to the vault. Cite sources.',
      {
        summary: z.string(),
        body: z.string(),
        sources: z.array(z.string()).default([]),
        supersedes: z.string().optional(),
      },
      async ({ summary, body, sources, supersedes }) => {
        const ctx = this.getContext();
        if (!ctx) return textResult('No workspace is open.');
        const slug =
          summary
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 48) || 'decision';
        const path = `decisions/${ctx.clock.now().slice(0, 10)}-${slug}.md`;
        const applied = await applyAndRecord(
          ctx,
          {
            kind: 'decision',
            sessionId: 'mcp',
            skill: 'mcp',
            targetPath: path,
            baseHash: null,
            payload: {
              path,
              frontmatter: { type: 'decision', summary, sources },
              body,
              rationale: `Logged via MCP: ${summary}`,
              ...(supersedes ? { supersedes } : {}),
            },
            rationale: `Logged via MCP: ${summary}`,
            evidence: sources.map((s) => ({ ref: s, resolved: true })),
            inference: sources.length === 0,
          },
          'the MCP client approved it',
        );
        this.onChanged();
        if (!applied.ok) return textResult(`Could not write the decision: ${applied.error}`);
        return textResult(`Decision written to ${applied.path ?? path}.`);
      },
    );

    return mcp;
  }
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}
