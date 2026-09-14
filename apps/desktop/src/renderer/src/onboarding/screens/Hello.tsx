import { Button, Logo } from '@qale/ui';
import { Screen } from '../Opening';

/**
 * Screen 1 (docs/onboarding.md, clarity review area 1). The cover, not a
 * dialog: the mark, then the concept. One button.
 *
 * Concept first, not pitch first (reworked 2026-08-30): the earlier
 * value-first draft read as a sales pitch to the person who already installed
 * the app. What they need before the next five screens is the mental model:
 * everything is a text file in a folder they own, this is where they work,
 * the AI adds and drafts, and it asks before anything it cannot take back.
 * The why (control) and the one boundary (notes go to the AI service they
 * pick) still get said, because someone who reads only this screen should
 * already know what they have installed.
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
      title="How Qale works"
      footer={
        <Button data-opening-primary size="lg" onClick={onNext}>
          Set it up
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3 text-body text-muted-foreground">
          <p>
            Everything here is a plain text file on your computer. Your notes, meetings and
            decisions live in one folder that you pick, and you can open it with any other app, with
            Qale closed.
          </p>
          {/* "You approve before anything counts" was the old last sentence,
              and the write policy made it untrue: most writes land on their own
              (docs/fewer-approvals.md FA-1). The screen says which writes wait
              and which do not, in the same words as PRODUCT.md, because the one
              thing worse than a surprise is a promise that broke. */}
          <p>
            That folder is where you work. Write notes, drop in transcripts, ask questions. The AI
            reads what you give it, files it, and drafts the follow-ups. Most of that lands as it is
            written, listed in Activity, where one press puts it back. Five things wait for you
            first: anything sent to Jira, Confluence or a calendar, a page deleted, a new document
            in your own folder, a rewrite of something you wrote, and anything the AI had to
            assume.
          </p>
          {/* The why, then the limit of the promise in the same breath (OW10).
              "Nothing leaves" was never true of the model, and a boundary
              whose one gap you find out about later is not one you agreed to.
              Plain "AI service" here: "model provider" and "agent" are our
              words, and this is the first screen anyone reads. */}
          <p>
            We built it this way so you stay in control: files any app can open are never locked in,
            and what the AI does on its own can always be undone. When the AI reads your notes,
            they go to the AI service you pick, and nothing reaches your team or your tools without
            your approval.
          </p>
        </div>
      </div>
    </Screen>
  );
}
