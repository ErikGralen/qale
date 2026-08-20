import { TELEMETRY_IDENTITY, TELEMETRY_PROCESSOR } from '@qale/ipc';
import { Button } from '@qale/ui';
import { TelemetryDetails } from '../../components/TelemetryDetails';
import { useApp } from '../../state/app-state';
import { Screen } from '../Opening';

/**
 * Screen 6 (ONB-6), and the last one. What leaves the machine.
 *
 * Getting the first transcript in used to be a screen after this one. It is a
 * First steps row instead: the ask lands better once the app is in front of
 * someone than as the final gate of a setup flow.
 *
 * One question, answered in four lines: nothing you wrote, it is tied to your
 * name, it goes to one place in Europe, and here is the switch. The full list
 * is still here and still generated from the allowlist the sender reads, but it
 * sits behind "See the exact list" ({@link TelemetryDetails}) rather than in
 * front of the switch. Small print at that length stops being read and starts
 * being alarming, which is the opposite of what an honest list is for.
 *
 * The one line that stays out in the open is who the reports are tied to
 * (TEL-4). This is a hand-picked beta and we want to be able to write to the
 * person something broke for. That is a real cost to them, so it sits next to
 * the switch instead of inside the fold. A trade you only find out about
 * afterwards is not one you agreed to.
 *
 * The switch is on by default, invited beta users are asked at invite time too,
 * and it is a real switch: off means nothing is sent, and the same switch, in
 * the same words, sits in Settings afterwards.
 *
 * What the title promises is bigger than what the switch controls, so the line
 * naming the two channels it does NOT close ({@link TelemetryDetails}, from
 * `TELEMETRY_LIMIT`) sits in the open under it, not inside the fold (OW10).
 */
export function Telemetry({ onNext }: { onNext: () => void }) {
  const { settings, patchOnboarding } = useApp();
  const on = settings?.onboarding.telemetry ?? true;

  return (
    <Screen
      title="What leaves your machine"
      why="Nothing you or the agent wrote. Only whether the app worked, and who it stopped working for."
      footer={
        <Button data-opening-primary size="lg" onClick={onNext}>
          Open my workspace
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-border transition-colors hover:bg-accent/40 motion-reduce:transition-none">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={on}
            onChange={(e) => void patchOnboarding({ telemetry: e.target.checked })}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Send usage and crash reports</span>
            <span className="mt-1 block text-sm text-balance text-muted-foreground">
              {TELEMETRY_IDENTITY}.
            </span>
          </span>
        </label>

        <TelemetryDetails />

        <p className="text-sm text-balance text-muted-foreground">
          {TELEMETRY_PROCESSOR} You can change this any time in Settings.
        </p>
      </div>
    </Screen>
  );
}
