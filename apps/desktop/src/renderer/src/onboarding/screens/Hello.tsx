import { Button, Logo } from '@qale/ui';
import { Screen } from '../Opening';

/**
 * Screen 1 (docs/onboarding.md). The cover, not a dialog: the mark, what this
 * is, and the deal. One button.
 *
 * The deal goes here rather than in a tour later because it is the thing that
 * decides whether anything after this is worth reading: it drafts, you approve,
 * and the files stay yours. Someone who reads only this screen should already
 * know what they have installed.
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
      title="Your product memory"
      footer={
        <Button data-opening-primary size="lg" onClick={onNext}>
          Set it up
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3 text-body text-muted-foreground">
          <p>
            Meetings, notes and tickets go in. What comes out is the answer to “what did we decide,
            and why”, with the receipts.
          </p>
          <p>
            It drafts, you approve. Everything it writes is plain markdown in a folder on your own
            computer, and nothing leaves it or reaches your team without you saying so.
          </p>
        </div>
      </div>
    </Screen>
  );
}
