import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createProposal, searchNotes, type UseCaseContext } from '@pm/application';
import { zOutboundPayload, OUTBOUND_PROVIDERS } from '@pm/domain';

/**
 * The workspace as an MCP server (PLAN-V2 §3.5) — not just a client. A Claude-
 * forward team's existing AI queries the same verified memory and files drafts
 * through the SAME approval cards. Localhost + bearer-token gated. Three tools:
 *   ask_product   — a cited, dated answer from the memory (read; deterministic)
 *   log_decision  — file a decision as an approval card (never writes silently)
 *   draft_writeback — file an outbound draft (Jira/Confluence/message) as a card
 * All three route through the same use cases and land in the Inbox.
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
          console.error('[pm] MCP request failed:', err instanceof Error ? err.message : err);
          if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'internal error' }));
        });
      });
      server.on('error', (err) => {
        console.error('[pm] MCP server error:', err);
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
        console.log(`[pm] MCP server on http://127.0.0.1:${port}/mcp`);
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
      res.end(JSON.stringify({ error: 'unauthorized — set the Produktminnet MCP token' }));
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
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  private buildServer(): McpServer {
    const mcp = new McpServer({ name: 'produktminnet', version: '0.1.0' });

    mcp.tool(
      'ask_product',
      'Answer a question from the product memory with citations, or "vet inte" (I don\'t know).',
      { question: z.string() },
      async ({ question }) => {
        const ctx = this.getContext();
        if (!ctx) return textResult('No workspace is open.');
        const hits = searchNotes(ctx, question, 6);
        if (hits.length === 0) return textResult('vet inte — no supporting evidence in the memory.');
        const body = hits.map((h) => `- ${h.path} (${h.type}) — ${h.summary}\n    ${h.snippet}`).join('\n');
        return textResult(`Evidence from the product memory:\n${body}\n\nCite these paths in your answer.`);
      },
    );

    mcp.tool(
      'log_decision',
      'File a product decision as an approval card (the PM approves before it is written). Cite sources.',
      {
        summary: z.string(),
        body: z.string(),
        sources: z.array(z.string()).default([]),
        supersedes: z.string().optional(),
      },
      async ({ summary, body, sources, supersedes }) => {
        const ctx = this.getContext();
        if (!ctx) return textResult('No workspace is open.');
        const slug = summary.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'decision';
        const path = `decisions/${ctx.clock.now().slice(0, 10)}-${slug}.md`;
        const rec = createProposal(ctx, {
          kind: 'decision',
          sessionId: 'mcp',
          skill: 'mcp',
          targetPath: path,
          baseHash: null,
          payload: { path, frontmatter: { type: 'decision', summary, sources }, body, rationale: `Logged via MCP: ${summary}`, ...(supersedes ? { supersedes } : {}) },
          rationale: `Logged via MCP: ${summary}`,
          evidence: sources.map((s) => ({ ref: s, resolved: true })),
          inference: sources.length === 0,
        });
        this.onChanged();
        return textResult(`Decision card ${rec.id} filed to the Inbox for approval: ${path}`);
      },
    );

    mcp.tool(
      'draft_writeback',
      'File an outbound draft (jira/confluence/message) as an approval card. Never sends; the PM approves. Actions: create_ticket (requires projectKey) | comment_ticket (requires issueKey) | update_page (requires pageId) | send_message.',
      {
        provider: z.enum(OUTBOUND_PROVIDERS).optional().describe('Where the draft is addressed.'),
        /** Deprecated alias of `provider`, still accepted from older callers. */
        system: z.enum(OUTBOUND_PROVIDERS).optional(),
        action: z.string(),
        title: z.string().optional(),
        body: z.string(),
        projectKey: z.string().optional(),
        issueKey: z.string().optional(),
        pageId: z.string().optional(),
        audience: z.string().optional(),
        sources: z.array(z.string()).default([]),
      },
      async (args) => {
        const ctx = this.getContext();
        if (!ctx) return textResult('No workspace is open.');
        // Normalize through the domain schema so the stored payload is always
        // the generic shape (provider + generic action), whatever the caller sent.
        const provider = args.provider ?? args.system;
        const parsed = zOutboundPayload.safeParse({
          ...args,
          provider,
          rationale: `Drafted via MCP for ${provider ?? 'unknown'}`,
        });
        if (!parsed.success) {
          return textResult(`Rejected: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        }
        const rec = createProposal(ctx, {
          kind: 'outbound',
          sessionId: 'mcp',
          skill: 'mcp',
          targetPath: null,
          baseHash: null,
          payload: parsed.data,
          rationale: parsed.data.rationale,
          evidence: args.sources.map((s) => ({ ref: s, resolved: true })),
          inference: false,
        });
        this.onChanged();
        return textResult(`Outbound draft card ${rec.id} filed to the Inbox for approval (${parsed.data.provider}).`);
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
