/**
 * An agent's off switch — shared by the Agents list row and the agent's own
 * page so the two controls are one control. The switch is real: off is written
 * into the file's frontmatter and stops the sweep, it doesn't hide anything.
 */
export function AgentSwitch({
  enabled,
  label,
  onToggle,
}: {
  enabled: boolean;
  /** The agent's name, so a screen reader hears which one it is turning off. */
  label: string;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onToggle(!enabled)}
      // Off keeps a hairline ring: on a white card the pale track needs more
      // than knob position to read as "a switch, currently off".
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none ${
        enabled ? 'bg-brand' : 'bg-input ring-1 ring-inset ring-foreground/10'
      }`}
    >
      <span
        className={`size-4 rounded-full bg-card shadow-sm transition-transform motion-reduce:transition-none ${
          enabled ? 'translate-x-4' : 'translate-x-0'
        }`}
        aria-hidden
      />
    </button>
  );
}
