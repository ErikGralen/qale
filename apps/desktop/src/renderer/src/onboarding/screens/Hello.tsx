import { Button, Logo } from '@qale/ui';
import { Screen } from '../Opening';

/**
 * Screen 1 (docs/onboarding.md, clarity review area 1). The cover, not a
 * dialog: the mark, the value, then briefly the how. One button.
 *
 * Value first, mechanics second: the reader on this screen has not decided to
 * care yet, so the first paragraph says what they get, not how it works. The
 * deal (it drafts, you approve, the files stay yours) and the one boundary
 * (notes go to the AI service they pick) still get said, because someone who
 * reads only this screen should already know what they have installed.
 */
export function Hello({ onNext }: { onNext: () => void }) {
  return (
    <Screen
      // The one place the product says its own name: this is the first text
      // anyone reads from us, and a cover with no name on it is a pamphlet.
      lead={
        <div className="mb-5 flex items-center gap-2">
          <Logo className="size-7 text-brand" />
          <span className="text-dense font-medium tracking-wide text-muted-foreground uppercase">
            Qale
          </span>
        </div>
      }
      title="Your new workspace"
      footer={
        <Button data-opening-primary size="lg" onClick={onNext}>
          Set it up
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3 text-body text-muted-foreground">
          <p>
            One place that remembers your product work for you: what was decided, why, and who
            promised what. You always have the answer, with links to where it came from.
          </p>
          <p>
            The AI does the busywork. Drop in meetings, notes and tickets, and it reads them, files
            them, and drafts the follow-ups. You approve before anything counts.
          </p>
          {/* The limit of the promise, said in the same breath as the promise
              (OW10). "Nothing leaves" was never true of the model, and a
              boundary whose one gap you find out about later is not one you
              agreed to. Plain "AI service" here: "model provider" and "agent"
              are our words, and this is the first screen anyone reads. */}
          <p>
            Everything lives in plain files on your own computer. When the AI reads your notes, they
            go to the AI service you pick, and nothing reaches your team or your tools without your
            approval.
          </p>
        </div>
      </div>
    </Screen>
  );
}
