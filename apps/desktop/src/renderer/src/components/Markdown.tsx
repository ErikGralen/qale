import { type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import { remarkPlugins } from '@pm/markdown';
import { invoke } from '../lib/ipc';

/**
 * Read-only note renderer. Uses the SAME remark plugin array as the indexer
 * (@pm/markdown) so `[[wikilinks]]` render identically to how they're indexed.
 * Wikilink anchors carry `data-target`; clicking resolves the target to a note
 * path over IPC and routes in-app. Plain links open in the system browser.
 */
export function Markdown({
  content,
  onOpenNote,
}: {
  content: string;
  /** Optional — omit for read-only renders (e.g. a past version) where links don't navigate. */
  onOpenNote?: (path: string) => void;
}) {
  return (
    <div className="note-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          a: (props: ComponentProps<'a'> & { 'data-target'?: string }) => {
            // Wikilinks carry data-target; a relative href is a note path too
            // (e.g. a chat answer's [label](decisions/x.md)). Both route in-app.
            const href = props.href ?? '';
            const target =
              props['data-target'] ??
              (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')
                ? decodeURIComponent(href)
                : undefined);
            if (target) {
              return (
                <a
                  {...props}
                  href="#"
                  onClick={async (e) => {
                    e.preventDefault();
                    const path = await invoke['note:resolveLink'](target);
                    if (path) onOpenNote?.(path);
                  }}
                  data-unresolved={undefined}
                />
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
