/**
 * The models a codebase question can run on (docs/claude-code-tickets.md CC-7).
 *
 * This is NOT the workspace's own model list. Qale talks to a provider through
 * pi with the PM's key, and the `claude` command line tool talks to Anthropic
 * with its own credential. Two different accounts, two different catalogues. So
 * the ids here are the aliases the `claude` tool accepts on `--model`, not the
 * pi ids in @qale/domain, and nothing should ever join the two lists up.
 *
 * Aliases rather than pinned names ("sonnet", not "claude-sonnet-5") on
 * purpose: an alias always means the current model of that family, so a Claude
 * Code upgrade moves this list forward on its own.
 *
 * Checked against Claude Code 2.1.220 on 2026-08-23, by running each one:
 * `claude -p '…' --model <id> --output-format json`. All three answered.
 */

/** One row of the codebase model picker. */
export interface CodebaseModel {
  /** The alias the `claude` tool accepts on `--model`. */
  id: string;
  /** What it is called on the card. */
  label: string;
  /** When to reach for it. The tool description hands these to the model. */
  note: string;
}

export const CODEBASE_MODELS: CodebaseModel[] = [
  {
    id: 'sonnet',
    label: 'Sonnet',
    note: 'Fast and cheap. Right for finding things, reading one file, and summarising what is there.',
  },
  {
    id: 'opus',
    label: 'Opus',
    note: 'The strong one. Worth the wait for architecture, for "why is it built this way", and for anything spanning many files.',
  },
  {
    id: 'fable',
    label: 'Fable 5',
    note: 'Tuned for writing. Pick it when you want the answer written out well for a person to read.',
  },
];

/** What a question runs on when nothing better is suggested. */
export const DEFAULT_CODEBASE_MODEL = CODEBASE_MODELS[0]!.id;

/** Is this an id the `claude` tool takes? Unknown ids are refused, never guessed. */
export function isCodebaseModel(id: string): boolean {
  return CODEBASE_MODELS.some((m) => m.id === id);
}
