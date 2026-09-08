import { Setting } from './Setting';
import { writePolicyBlocks } from '../lib/write-policy-copy';

/**
 * What Qale does on its own, said before it does it
 * (docs/background-system.md ticket 6, docs/fewer-approvals.md FA-1).
 *
 * Activity is a receipt, and a receipt arrives too late to be a permission. So
 * the policy that says which writes wait says itself here, in the words it
 * already carries: the same `describeWritePolicy()` the domain answers with,
 * never a second copy that can drift from the rule.
 *
 * Nothing here is a control. Predicting the behaviour is the point; configuring
 * it is not (PRODUCT.md). The revert in Activity is the only lever, and it
 * already exists.
 */
export function WritePolicySetting() {
  return (
    <Setting
      title="What Qale does on its own"
      description="What a write does decides, not where the file sits. A send, a delete, a rewrite of something you wrote, and anything Qale had to assume all wait for you. The rest lands, listed in Activity, where one press puts it back."
    >
      <div className="grid gap-x-6 gap-y-5 rounded-xl bg-card p-4 ring-1 ring-border sm:grid-cols-2">
        {writePolicyBlocks().map((block) => (
          <div key={block.place}>
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {block.title}
            </h3>
            <div className="mt-2 space-y-3">
              {block.groups.map((group) => (
                <div key={group.disposition}>
                  {/* The block title already says the answer, so the word for it
                      is drawn only where a block holds both answers. Printing
                      "Lands, listed in Activity" under "What lands" says one
                      thing twice. */}
                  {block.groups.length > 1 && (
                    <h4 className="text-dense font-medium">{group.word}</h4>
                  )}
                  <ul className="mt-1 space-y-1">
                    {group.rows.map((row, i) => {
                      // Writes in a row can share one reason ("This side of the
                      // workspace is yours, so you say what goes in it.").
                      // Printing it three times reads as three rules. It is
                      // said once, over the rows it covers.
                      const said = i > 0 && group.rows[i - 1]!.reason === row.reason;
                      return (
                        <li key={row.what} className="text-dense">
                          {row.what}{' '}
                          {!said && <span className="text-muted-foreground">{row.reason}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Setting>
  );
}
