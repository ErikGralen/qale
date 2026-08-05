import {
  BookOpen,
  Bot,
  Building2,
  FileInput,
  GitBranch,
  History,
  Mic,
  Sparkles,
  SquareCheck,
  StickyNote,
  Target,
  Ticket,
  User,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { NoteType } from '@qale/ipc';

/** The one icon per note type — the shared visual vocabulary across the
 *  sidebar, tab strip, and Memory page. */
export const NOTE_TYPE_ICON: Record<NoteType, LucideIcon> = {
  source: FileInput,
  meeting: Mic,
  decision: GitBranch,
  insight: Sparkles,
  customer: Building2,
  theme: Target,
  person: User,
  session: History,
  skill: Wand2,
  agent: Bot,
  todo: SquareCheck,
  note: StickyNote,
  ticket: Ticket,
  wikipage: BookOpen,
};

/** Icon for a note type, falling back to the untyped-note glyph. */
export function noteTypeIcon(type: NoteType): LucideIcon {
  return NOTE_TYPE_ICON[type] ?? StickyNote;
}
