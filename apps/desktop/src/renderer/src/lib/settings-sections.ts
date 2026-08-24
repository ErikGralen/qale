import {
  Bot,
  Cable,
  FolderGit2,
  FolderOpen,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * The tabs Settings is divided into, and the one place their order and names
 * are written down. Three surfaces read this list: the tab strip, the view
 * state that deep links point at (`openSettings('agent')`), and ⌘K.
 *
 * Every panel holds one to three settings, which is the point: the page used to
 * be a single column of eleven sections where finding the API key meant reading
 * past the workspace, the language and half a page of prose. A tab is only
 * worth its click if what is behind it is short.
 */
export type SettingsSection =
  'general' | 'you' | 'workspace' | 'agent' | 'connections' | 'codebase' | 'advanced' | 'privacy';

export interface SettingsSectionInfo {
  id: SettingsSection;
  /** The tab's name, and the leaf in the page header. */
  label: string;
  icon: LucideIcon;
  /**
   * What is behind the tab, in the words someone would go looking with. Not
   * shown on the tab itself — it is what ⌘K matches on, so typing "port" or
   * "crash reports" finds the panel that holds it.
   */
  keywords: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionInfo[] = [
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    keywords: 'appearance theme light dark system language swedish english',
  },
  {
    id: 'you',
    label: 'You',
    icon: UserRound,
    keywords: 'your name email address addresses identity alias participants',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: FolderOpen,
    keywords: 'folder vault switch new git version history sync path',
  },
  {
    id: 'agent',
    label: 'Agent',
    icon: Bot,
    keywords:
      'provider anthropic claude google gemini api key model opus sonnet fable flash pro schedule scheduled sessions dry run',
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: Cable,
    keywords: 'jira confluence google calendar connect token sync follow projects spaces',
  },
  {
    id: 'codebase',
    label: 'Codebase',
    icon: FolderGit2,
    keywords: 'code repo repository repos git folder claude code source ask the code',
  },
  {
    id: 'advanced',
    label: 'Advanced',
    icon: Terminal,
    keywords: 'mcp server port token localhost claude cursor',
  },
  {
    id: 'privacy',
    label: 'Privacy & help',
    icon: ShieldCheck,
    keywords: 'telemetry usage crash reports diagnostics version support report a problem',
  },
];

/** Where Settings opens when nobody named a section. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'general';

export function settingsSectionLabel(id: SettingsSection): string {
  return SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? 'General';
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_SECTIONS.some((s) => s.id === value);
}
