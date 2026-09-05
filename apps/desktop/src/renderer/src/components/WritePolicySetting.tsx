import { Setting } from './Setting';
import { writePolicyBlocks } from '../lib/write-policy-copy';

/**
 * What Qale does on its own, said before it does it
 * (docs/background-system.md ticket 6).
 *
 * Activity is a receipt, and a receipt arrives too late to be a permission. So
 * the policy that grades every write says itself here, in the words it already
 * carries: the same `describeWritePolicy()` the domain answers with, never a
 * second copy that can drift from the rule.
 *
 * Nothing here is a control. Predicting the behaviour is the point; configuring
 * it is not (PRODUCT.md). The revert in Activity is the only lever, and it
 * already exists.
 */
export function WritePolicySetting() {
  return (
    <Setting
      title="What Qale does on its own"
      description="Every write is graded by what it can take away. What lands on its own is listed in Activity, where one press puts it back."
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
                  <h4 className="text-dense font-medium">{group.word}</h4>
                  <ul className="mt-1 space-y-1">
                    {group.rows.map((row, i) => {
                      // Four writes in a row can share one reason ("Documents is
                      // your folder, so you say what goes in it."). Printing it
                      // four times reads as four rules. It is said once, over
                      // the rows it covers.
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
