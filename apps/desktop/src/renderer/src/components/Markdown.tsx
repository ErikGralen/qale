import { useMemo, useRef, useState, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins } from '@qale/markdown';
import { slugFromPath } from '@qale/domain';
import { invoke } from '../lib/ipc';
import { isExternalRef } from '../lib/connections';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { webUrl } from '../lib/urls';
import { useApp } from '../state/app-state';
import { ExternalRefChip } from './ExternalRef';

/**
 * Read-only note renderer. Uses the SAME remark plugin array as the indexer
 * (@qale/markdown) so `[[wikilinks]]` render identically to how they're indexed.
 * Wikilink anchors carry `data-target`; clicking resolves the target to a note
 * path over IPC and routes in-app. Plain links open in the system browser.
 */
/** The `[[type::target]]` relationship as a muted prefix chip — the same quiet
 *  register as the ticket state pill, never louder than the link itself. */
function TypeChip({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="mr-1 rounded bg-muted px-1 align-[1px] text-2xs font-medium text-muted-foreground">
      {label}
    </span>
  );
}

/**
 * A fenced block is nearly always something to use somewhere else: a prompt to
 * run, a command, a snippet to paste. Reading it off the screen and retyping it
 * is the failure mode, so every block carries a copy button. The text comes off
 * the rendered node rather than the AST, which keeps this indifferent to how the
 * block was built.
 */
function CodeBlock({ node: _node, ...props }: ComponentProps<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      {/* Wrapped, not side-scrolled. These blocks are read and copied, and a
          prompt whose right-hand half is off the edge of a 700px column reads
          as a broken screen long before anyone thinks to drag it sideways. */}
      <pre {...props} ref={ref} className="pr-14 whitespace-pre-wrap break-words" />
      <button
        type="button"
        aria-label="Copy"
        className="absolute top-1.5 right-1.5 rounded border border-border bg-background/90 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(ref.current?.textContent ?? '');
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function Markdown({
  content,
  onOpenNote,
}: {
  content: string;
  /** Optional — omit for read-only renders (e.g. a past version) where links don't navigate.
   *  Receives the click's nav intent so ⌘click opens the note in a new tab. */
  onOpenNote?: (path: string, opts?: NavOpts) => void;
}) {
  const { tree } = useApp();
  // A link the author wrote as `[[decisions/adopt-workos]]` reads as the note's
  // own name, not as where it is filed. Storage never shows up in a read view;
  // the editor still shows the link exactly as typed, because there it is the
  // text being edited.
  const titleBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of tree?.groups ?? []) for (const n of g.notes) m.set(n.slug, n.title);
    return m;
  }, [tree]);

  return (
    <div className="note-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          pre: CodeBlock,
          a: (
            props: ComponentProps<'a'> & { 'data-target'?: string; 'data-link-type'?: string },
          ) => {
            // Wikilinks carry data-target; a relative href is a note path too
            // (e.g. a session answer's [label](decisions/x.md)). Both route in-app.
            const dataTarget = props['data-target'];
            // `[[type::target]]` links carry their relationship as a display
            // label — rendered as a muted prefix chip before the link.
            const linkType = props['data-link-type'];
            const href = props.href ?? '';
            // A real web address — `https://…`, a GFM-autolinked bare URL, or a
            // scheme-less `www.`/`host.tld` an author typed as a link target —
            // opens in the system browser. Wikilinks (data-target) never do.
            const external = dataTarget ? null : webUrl(href);
            if (external) {
              return (
                <a {...props} href={external} target="_blank" rel="noreferrer">
                  {props.children}
                </a>
              );
            }
            const target =
              dataTarget ??
              (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')
                ? decodeURIComponent(href)
                : undefined);
            if (target && isExternalRef(target)) {
              // A ticket/wikipage reference renders as a live chip — key +
              // state pill from the local mirror, hover card via the shared
              // layer. A target that merely looks like a ticket key still
              // opens its vault note: the chip falls back to the ordinary
              // resolve when no mirror answers.
              return (
                <>
                  <TypeChip label={linkType} />
                  <ExternalRefChip
                    target={target}
                    alias={typeof props.children === 'string' ? props.children : undefined}
                    onOpen={onOpenNote}
                  />
                </>
              );
            }
            if (target) {
              const open = async (e: React.MouseEvent) => {
                e.preventDefault();
                const opts = navFromEvent(e);
                const path = await invoke['note:resolveLink'](target);
                if (path) onOpenNote?.(path, opts);
              };
              // No alias means the link prints its target, which is a slug. Show
              // the note's name instead when the workspace holds it; a target
              // nothing answers to stays as written, so a broken link still
              // reads as one.
              const written = typeof props.children === 'string' ? props.children : null;
              const title =
                written && written === target ? titleBySlug.get(slugFromPath(target)) : undefined;
              return (
                <>
                  <TypeChip label={linkType} />
                  <a
                    {...props}
                    href="#"
                    onClick={open}
                    // Middle-click = open in background tab (browser semantics).
                    onAuxClick={(e) => e.button === 1 && void open(e)}
                    data-unresolved={undefined}
                  >
                    {title ?? props.children}
                  </a>
                </>
              );
            }
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
