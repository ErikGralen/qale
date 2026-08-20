/**
 * Drop with aim (docs/arrival-agentic.md, rung 2).
 *
 * Where you drop carries intent: a transcript dropped on a meeting page belongs
 * to that meeting, files dropped on a folder belong in that folder. It reaches
 * the agent as a preset sentence rather than as a separate code path, so an
 * aimed drop is an ordinary drop with one thing already said, and the PM can
 * still argue with it in the tray's own field.
 */
export type MaterialAim =
  { kind: 'meeting'; path: string; title: string } | { kind: 'folder'; dir: string };

/** The aim, said the way the PM would say it. */
export function aimSentence(aim: MaterialAim): string {
  return aim.kind === 'meeting'
    ? `I dropped this on the meeting “${aim.title}” (${aim.path}), so it belongs to that meeting. Attach it there rather than making a new page, and do not ask me which meeting it is.`
    : `I dropped this on ${aim.dir}, so file it there and do not ask me where it goes.`;
}

/** What the tray shows back before any of it counts: where this is headed. */
export function aimLabel(aim: MaterialAim): string {
  return aim.kind === 'meeting' ? aim.title : aim.dir;
}
