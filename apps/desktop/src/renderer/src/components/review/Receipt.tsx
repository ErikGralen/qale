import { Fragment } from 'react';
import type { MouseEvent } from 'react';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import type { ReceiptEntry } from './cardMeta';

/**
 * What the approvals set in motion, said once and rendered in both places that
 * report it: the session review after the PO clears it, and a session's chat
 * after they judge its last card (docs/closing-beat.md).
 *
 * A column, not a sentence. Four approvals used to run together in one wrapping
 * paragraph — "Created A · Created B · Created" then a line break and the rest
 * of B's neighbour — which put the verb four times in the reader's way and hid
 * the one thing they came for: which notes to open. Two aligned columns say it
 * once per row. The verb is the quiet one; the note is the link.
 *
 * A deletion is a row like any other, with its name in plain text: there is no
 * page left to open, and a link to a file that is gone is a dead end wearing a
 * link's clothes. What left the workspace keeps its own line under the column,
 * in the words the banner used, because leaving the machine is a different fact
 * from landing in the vault.
 */
export function ReceiptLines({
  entries,
  onOpen,
  className = '',
}: {
  entries: readonly ReceiptEntry[];
  onOpen: (path: string, opts?: NavOpts) => unknown;
  className?: string;
}) {
  const inVault = entries.filter((e) => e.note || e.gone);
  const left = entries.filter((e) => e.sent);
  if (inVault.length === 0 && left.length === 0) return null;

  return (
    <div className={`text-sm ${className}`}>
      {inVault.length > 0 && (
        /* The verb column sizes to its longest word, so every note title starts
           on the same edge however the set is mixed. */
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {inVault.map((e) => (
            <Fragment key={e.id}>
              <dt className="text-muted-foreground">{e.verb}</dt>
              <dd className="min-w-0">
                {e.note ? (
                  <button
                    className="rounded-sm text-left text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={(ev: MouseEvent<HTMLButtonElement>) =>
                      void onOpen(e.note!.path, navFromEvent(ev))
                    }
                  >
                    {e.note!.title}
                  </button>
                ) : (
                  <span className="text-foreground/70">{e.gone}</span>
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {left.length > 0 && (
        <p className="mt-1.5 text-muted-foreground">
          Left your workspace: {left.map((e) => e.sent).join(' · ')}
        </p>
      )}
    </div>
  );
}
