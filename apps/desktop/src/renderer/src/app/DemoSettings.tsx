import { useState } from 'react';
import { Button } from '@qale/ui';
import { Check, FolderOpen, RotateCcw } from 'lucide-react';
import type { DemoInfoDTO } from '@qale/ipc';
import { invoke } from '../lib/ipc';
import { useToast } from '../components/toast';
import { Setting, SettingPanel } from '../components/Setting';

/**
 * The Demo tab (docs/demo-mode.md DM-9). It exists in the demo build and
 * nowhere else: `demo:info` answers `enabled: false` in the product and
 * SettingsView never appends the tab.
 *
 * Three things, and nothing that looks like a debug panel. He opens this in
 * front of customers, so it reads as a page of the app.
 */
export function DemoSettings({
  info,
  onChange,
}: {
  info: DemoInfoDTO;
  onChange: (info: DemoInfoDTO) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busyStep, setBusyStep] = useState<string | null>(null);

  const reset = async () => {
    setConfirming(false);
    setResetting(true);
    try {
      // The window reloads at the end of this, so there is nothing to repaint
      // here. If it comes back instead, the reset failed and says so.
      await invoke['demo:reset']();
    } catch (err) {
      toast(`The reset failed: ${err instanceof Error ? err.message : 'nothing was changed.'}`);
    }
    setResetting(false);
  };

  const openSamples = async () => {
    try {
      await invoke['demo:openSamples']();
    } catch (err) {
      toast(`Could not open the folder: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  const applyStep = async (id: string) => {
    setBusyStep(id);
    try {
      onChange({ ...info, steps: await invoke['demo:applyStep'](id) });
    } catch (err) {
      toast(`That step failed: ${err instanceof Error ? err.message : 'nothing changed.'}`);
    }
    setBusyStep(null);
  };

  return (
    <SettingPanel>
      <Setting
        title="Reset the demo"
        description={
          <>
            <p>{datedLine(info.today)}</p>
            <p>
              A reset puts the workspace, Jira and Confluence back to the start of the script and
              moves every date to today. Anything you did in the last demo goes.
            </p>
          </>
        }
        control={
          confirming ? (
            <span className="flex items-center gap-1">
              <span className="text-xs text-destructive">Reset?</span>
              <Button size="sm" variant="destructive" onClick={() => void reset()}>
                Yes, reset
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={resetting}
              onClick={() => setConfirming(true)}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {resetting ? 'Resetting…' : 'Reset demo'}
            </Button>
          )
        }
      />

      <Setting
        title="Demo files"
        description="The transcripts and pastes you drag in during the walkthrough. They sit in a folder called “Qale demo files” on your Desktop."
        control={
          <Button size="sm" variant="outline" onClick={() => void openSamples()}>
            <FolderOpen className="size-3.5" aria-hidden />
            Open demo files
          </Button>
        }
      />

      {info.steps.length > 0 && (
        <Setting
          title="Script steps"
          description="Changes you can make happen on cue, the way they would if someone else moved a ticket while you talked. Each one runs once per demo, and a later step brings the earlier ones with it."
        >
          <div className="flex flex-col items-start gap-2">
            {info.steps.map((step) => (
              <Button
                key={step.id}
                size="sm"
                variant="outline"
                disabled={step.applied || busyStep !== null}
                onClick={() => void applyStep(step.id)}
              >
                {step.applied && <Check className="size-3.5 text-brand" aria-hidden />}
                {step.label}
              </Button>
            ))}
          </div>
        </Setting>
      )}
    </SettingPanel>
  );
}

/**
 * Which day the workspace reads as. Normally that is today, and saying so is
 * the whole reassurance. A dev run can pin another day to prove the shift
 * holds, and then the line has to say the day it really is.
 */
function datedLine(today: string): string {
  const real = new Date().toISOString().slice(0, 10);
  const written = longDate(today);
  return today === real ? `Dated to today, ${written}.` : `Dated to ${written}, not today.`;
}

function longDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
