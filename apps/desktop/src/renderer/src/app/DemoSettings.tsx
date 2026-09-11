import { useState } from 'react';
import { Button } from '@qale/ui';
import { FolderOpen, RotateCcw } from 'lucide-react';
import type { DemoInfoDTO } from '@qale/ipc';
import { invoke } from '../lib/ipc';
import { useToast } from '../components/toast';
import { Setting, SettingPanel } from '../components/Setting';

/**
 * The Demo tab (docs/demo-mode.md DM-9, DM-4). It exists in the demo build and
 * nowhere else: `demo:info` answers `enabled: false` in the product and
 * SettingsView never appends the tab.
 *
 * Reset, pressed once before a demo, and under it the six scenarios as a
 * reminder of what to do. Nothing selects a scenario: the engine picks it from
 * what the presenter does, so he never has to come back here mid-demo. Nothing
 * that looks like a debug panel, because he opens this in front of customers.
 */
export function DemoSettings({ info }: { info: DemoInfoDTO }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const scenarios = info.scenarios ?? [];

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

  return (
    <SettingPanel>
      <Setting
        title="Reset the demo"
        description={
          <>
            <p>{datedLine(info.today)}</p>
            <p>
              Press Reset once before a demo. It puts the workspace, Jira, Confluence and the
              calendar back to the start, dated today. Every scenario below is then available, with
              no reset between them. Anything you did in the last demo goes.
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
        title="Scenarios"
        description="What to do for each one. Qale picks the scenario from what you do, so there is nothing to select here."
      >
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          The first two run first, in order. The rest run in any order.
        </p>
        <ol className="flex flex-col gap-2">
          {scenarios.map((scenario) => (
            <li
              key={scenario.id}
              className="space-y-0.5 rounded-lg border border-border bg-card p-3"
            >
              <span className="text-sm font-medium">{scenario.title}</span>
              <p className="text-sm text-muted-foreground">{scenario.do}</p>
            </li>
          ))}
        </ol>
      </Setting>

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
