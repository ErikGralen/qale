import { type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins } from '@pm/markdown';
import { invoke } from '../lib/ipc';
import { isExternalRef } from '../lib/connections';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { webUrl } from '../lib/urls';
import { ExternalRefChip } from './ExternalRef';

/**
 * Read-only note renderer. Uses the SAME remark plugin array as the indexer
 * (@pm/markdown) so `[[wikilinks]]` render identically to how they're indexed.
 * Wikilink anchors carry `data-target`; clicking resolves the target to a note
 * path over IPC and routes in-app. Plain links open in the system browser.
 */
/** The `[[type::target]]` relationship as a muted prefix chip — the same quiet
 *  register as the ticket state pill, never louder than the link itself. */
function TypeChip({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="mr-1 rounded bg-muted px-1 align-[1px] text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
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
  return (
    <div className="note-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          a: (props: ComponentProps<'a'> & { 'data-target'?: string; 'data-link-type'?: string }) => {
            // Wikilinks carry data-target; a relative href is a note path too
            // (e.g. a chat answer's [label](decisions/x.md)). Both route in-app.
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
                  <ExternalRefChip target={target} alias={typeof props.children === 'string' ? props.children : undefined} onOpen={onOpenNote} />
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
                  />
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
