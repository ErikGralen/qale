import { Bot, Clock, MessagesSquare, ScrollText, Wand2, type LucideIcon } from 'lucide-react';
import { ARRIVAL_AGENT_NAME, HOUSE_RULES_NAME } from '@qale/sessions';

/**
 * The Skills page and its five tabs (SK-12), and the one place a file's tab is
 * decided.
 *
 * The page used to be two pages and a shelf machinery that read `starts:` off
 * the files themselves. Both are gone. What a file is now comes from where it
 * sits plus two rosters that live in code, here:
 *
 * - **Skills** are work you run. Everything the PM writes lands here by default.
 * - **House rules** is one document, always in force, never a list.
 * - **Moments** are the places the product fires a skill itself. The trigger
 *   text is code-owned for the same reason an agent's clock is: a sentence in
 *   frontmatter would be a promise the file cannot keep.
 * - **Voices** are tone, applied when something is drafted.
 * - **Agents** run on clocks and are the only things with an off switch.
 *
 * One derivation, so a file cannot appear on two tabs and none can fall
 * through: {@link tabForFile} is total, and its default is Skills.
 */

export type SkillsTab = 'skills' | 'house-rules' | 'moments' | 'voices' | 'agents';

export interface SkillsTabInfo {
  id: SkillsTab;
  /** The tab's name, and the leaf in the page header. */
  label: string;
  /** What ONE file on this tab is called, for the badge and the delete copy. */
  item: string;
  icon: LucideIcon;
}

export const SKILLS_TABS: readonly SkillsTabInfo[] = [
  { id: 'skills', label: 'Skills', item: 'Skill', icon: Wand2 },
  { id: 'house-rules', label: 'House rules', item: 'House rules', icon: ScrollText },
  { id: 'moments', label: 'Moments', item: 'Moment', icon: Clock },
  { id: 'voices', label: 'Voices', item: 'Voice', icon: MessagesSquare },
  { id: 'agents', label: 'Agents', item: 'Agent', icon: Bot },
];

/** Where the page opens when nobody named a tab. */
export const DEFAULT_SKILLS_TAB: SkillsTab = 'skills';

export function skillsTabLabel(id: SkillsTab): string {
  return SKILLS_TABS.find((t) => t.id === id)?.label ?? 'Skills';
}

/** What one file on this tab is called ("Voice"), for a badge or a delete line. */
export function skillsTabItem(id: SkillsTab): string {
  return SKILLS_TABS.find((t) => t.id === id)?.item ?? 'Skill';
}

export function isSkillsTab(value: string | undefined): value is SkillsTab {
  return SKILLS_TABS.some((t) => t.id === value);
}

/**
 * A moment: a skill the product runs itself when something happens. The
 * roster is hard-coded because the dispatch sites are hard-coded. Arrival is
 * invoked by the ingest pipeline, process-note by "Go through this note" on a
 * note page, commitment-check by "Help me handle this" on a todo. A file
 * cannot join this list by declaring anything.
 */
export interface Moment {
  /** The skill's invocation name, which is its folder name. */
  name: string;
  /** What fires it, in the words the row prints: "When material arrives". */
  when: string;
}

export const MOMENTS: readonly Moment[] = [
  { name: ARRIVAL_AGENT_NAME, when: 'When material arrives' },
  { name: 'process-note', when: 'When you go through a note from its page' },
  { name: 'commitment-check', when: 'When a commitment slips and you ask for help' },
];

export function momentFor(name: string): Moment | undefined {
  return MOMENTS.find((m) => m.name === name);
}

/** What {@link tabForFile} needs to place a file. Both DTOs already carry it. */
export interface TabbedFile {
  kind: 'skill' | 'voice' | 'agent';
  /** The invocation name — the folder name for a skill, the filename for a voice. */
  name: string;
}

/**
 * Which tab holds this file. Total by design: an unknown file the PM wrote is a
 * skill, because a skill is the only one of the five a person can add by
 * writing a file, and a row that landed nowhere would be a file the page hides.
 */
export function tabForFile(file: TabbedFile): SkillsTab {
  if (file.kind === 'agent') return 'agents';
  if (file.kind === 'voice') return 'voices';
  if (file.name === HOUSE_RULES_NAME) return 'house-rules';
  if (momentFor(file.name)) return 'moments';
  return 'skills';
}
