import {
  Building2,
  FileInput,
  GitBranch,
  History,
  Mic,
  Rocket,
  Sparkles,
  SquareCheck,
  StickyNote,
  Target,
  User,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { NoteType } from '@pm/ipc';

/** The one icon per note type — the shared visual vocabulary across the
 *  sidebar, tab strip, and Memory page. */
export const NOTE_TYPE_ICON: Record<NoteType, LucideIcon> = {
  source: FileInput,
  meeting: Mic,
  decision: GitBranch,
  insight: Sparkles,
  customer: Building2,
  problem: Target,
  release: Rocket,
  person: User,
  session: History,
  skill: Wand2,
  todo: SquareCheck,
  note: StickyNote,
};

/** Icon for a note type, falling back to the untyped-note glyph. */
export function noteTypeIcon(type: NoteType): LucideIcon {
  return NOTE_TYPE_ICON[type] ?? StickyNote;
}
