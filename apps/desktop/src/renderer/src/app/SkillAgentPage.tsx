import { useState } from 'react';
import type { NoteDTO } from '@qale/ipc';
import { Badge, Button } from '@qale/ui';
import { Bot, Pin, Play, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { HeaderAction, HeaderActions, HeaderMenu, PageHeader } from '../components/PageHeader';
import { NoteEditor } from '../components/NoteEditor';
import { TitleEditor } from '../components/TitleEditor';
import { AgentSwitch } from '../components/AgentSwitch';
import { AgentLifeSigns, AgentBlockedNotice } from '../components/AgentLifeSigns';
import { StartChips, CanChips } from '../components/RunnableConfig';
import { askSelectionSeed } from '../lib/agent-nudges';

/**
 * The purpose-built page a skill or agent file opens as — stored as markdown,
 * never shown as markdown. What a person edits here is what a person owns:
 * the name, the one-liner, and the instructions. The machinery (frontmatter
 * flags, clocks, addresses) stays the app's business; the one visible control
 * beyond the text is the agent's switch, and it is the same switch as the
 * Agents list's. Title commits are a frontmatter write, NEVER a rename — the
 * filename is the invocation address, and moving it would break every caller.
 */

/** One-line summary under the title — what every list shows for this file. */
function SummaryEditor({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (summary: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className="mb-2 w-full rounded-md bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none"
      value={draft}
      placeholder="One line about what this does"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== value) onCommit(next);
        else setDraft(value);
      }}
      aria-label="Summary"
    />
  );
}

export function SkillAgentPage({ note }: { note: NoteDTO }) {
  const {
    skills,
    agents,
    saveNote,
    saveFrontmatter,
    loadDoc,
    openDoc,
    openFolder,
    openSkills,
    openAgents,
    openSession,
    setAgentEnabled,
    search,
    deleteNote,
    favorites,
    toggleFavorite,
  } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isAgent = note.type === 'agent';
  const skill = isAgent ? undefined : skills.find((s) => s.path === note.path);
  const agent = isAgent ? agents.find((a) => a.path === note.path) : undefined;
  const errors = (isAgent ? agent?.errors : skill?.errors) ?? [];
  // What starts it and what it may do — config, read off the parsed file so the
  // page shows exactly what the runtime will honour.
  const starts = (isAgent ? agent?.starts : skill?.starts) ?? [];
  const can = (isAgent ? agent?.can : skill?.can) ?? [];
  // A skill IS its folder, so its invocation name is the folder name — read off
  // the parsed row rather than sliced off the path again, since `skills/x/SKILL.md`
  // and legacy `skills/x.md` are the same skill under different filenames. The
  // button exists only where the file says the PM is one of the ways in.
  const name =
    (isAgent ? agent?.id : skill?.name) ?? note.path.split('/').pop()!.replace(/\.md$/, '');
  const runnable = !isAgent && starts.some((x) => x.kind === 'you-run-it');
  // The material beside it. Listed, never loaded — the whole point of the folder.
  const files = (isAgent ? agent?.files : skill?.files) ?? [];

  // The top folder is the crumb (Skills, Agents), and the leaf is this one's
  // name. The file it is stored in used to sit there, which told the reader
  // where it lives in a vocabulary they never asked for.
  const folder = note.path.includes('/') ? (note.path.split('/')[0] ?? null) : null;

  // Full-map save (unknown keys survive parseFrontmatter); a rejected write
  // resyncs to file truth so the inputs never lie about what was saved.
  const commitFm = (patch: Record<string, unknown>): void => {
    void saveFrontmatter(note.path, { ...note.frontmatter, ...patch, type: note.type }).catch(
      () => void loadDoc(note.path),
    );
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        icon={isAgent ? Bot : Wand2}
        crumbs={
          folder
            ? [
                {
                  label: folder.charAt(0).toUpperCase() + folder.slice(1),
                  // skills/ and agents/ have purpose-built list pages — the
                  // crumb goes there, not to the raw memory folder view.
                  onClick: (e) =>
                    folder === 'skills'
                      ? openSkills(navFromEvent(e))
                      : folder === 'agents'
                        ? openAgents(navFromEvent(e))
                        : openFolder(folder, navFromEvent(e)),
                },
              ]
            : undefined
        }
        label={note.title}
        labelTitle={note.title}
      >
        <>
          {runnable && (
            <Button size="sm" onClick={() => openSession(name, { title: note.title })}>
              <Play className="size-3.5" /> Start session
            </Button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-xs text-muted-foreground">
                Delete this {isAgent ? 'agent' : 'skill'}?
              </span>
              <Button size="sm" variant="destructive" onClick={() => void deleteNote(note.path)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <HeaderActions>
              <HeaderAction
                icon={Pin}
                label={favorites.includes(note.path) ? 'Unpin' : 'Pin'}
                title={favorites.includes(note.path) ? 'Unpin' : 'Pin: keep on the sidebar'}
                onClick={() => toggleFavorite(note.path)}
                pressed={favorites.includes(note.path)}
                iconClassName={favorites.includes(note.path) ? 'fill-brand text-brand' : undefined}
              />
              <HeaderMenu
                items={[
                  {
                    label: isAgent ? 'Delete agent' : 'Delete skill',
                    icon: Trash2,
                    action: () => setConfirmDelete(true),
                    danger: true,
                  },
                ]}
              />
            </HeaderActions>
          )}
        </>
      </PageHeader>

      {/* px-14: the left gutter must seat the block handle (+ ⋮⋮, 54px) without
          clipping against the panel edge. */}
      <div className="flex-1 overflow-y-auto px-14 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{isAgent ? 'Agent' : 'Skill'}</Badge>
            {isAgent && agent && (
              <span className="ml-auto">
                <AgentSwitch
                  enabled={agent.enabled}
                  label={agent.title}
                  onToggle={(enabled) => void setAgentEnabled(agent.id, enabled)}
                />
              </span>
            )}
          </div>

          <TitleEditor
            key={`${note.path}:${note.title}`}
            value={note.title}
            autoFocus={false}
            onCommit={(title) => commitFm({ title })}
          />
          <SummaryEditor
            key={`${note.path}:${String(note.frontmatter['summary'] ?? '')}`}
            value={String(note.frontmatter['summary'] ?? '')}
            onCommit={(summary) => commitFm({ summary })}
          />

          {/* The life signs — the same component as the Agents list row. A
              skill has no clock and nothing to report having done, so it shows
              the same config chips and its one sentence instead. */}
          {isAgent && agent ? (
            <AgentLifeSigns agent={agent} className="mb-3" />
          ) : (
            <div className="mb-3 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <StartChips starts={starts} />
                <CanChips can={can} />
              </div>
              <p className="text-xs text-muted-foreground/80">{skill?.sentence}</p>
            </div>
          )}

          {/* Blocked, never silent — but only for the key gap: a broken file's
              errors are pinned right below, and saying it twice says less. */}
          {agent && errors.length === 0 && <AgentBlockedNotice agent={agent} className="mb-3" />}

          {/* Parse errors — pinned, the flag voice, never quiet. */}
          {errors.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1 rounded-md bg-destructive/8 px-2.5 py-1.5">
              {errors.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Straight from the title into the writing. There used to be a
              header strip here — a label, a save reassurance, a version-history
              link, and a line explaining which prose counted. The body is the
              instructions now, so all of it was telling you what you can see. */}
          <NoteEditor
            key={note.path}
            body={note.body}
            onSave={(body) => saveNote(note.path, body)}
            onOpenNote={openDoc}
            searchNotes={search}
            onAsk={(text) =>
              openSession('ask', {
                initialPrompt: askSelectionSeed(note.path, text),
                title: `Ask: ${note.title}`,
                fresh: true,
              })
            }
          />

          {/* What else is in the folder. Deliberately inert: these are paths to
              copy into the instructions, not documents to open here, and the
              line below is the one thing a reader needs to know about them. */}
          {files.length > 0 && (
            <section className="mt-8 border-t border-border pt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                In this folder
              </h2>
              <p className="mt-1 text-xs text-muted-foreground/80">
                Name one of these paths in the instructions above and the agent reads it then.
                Nothing here is loaded on its own, so a long checklist costs a session nothing until
                it is asked for.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {files.map((f) => (
                  <li key={f} className="font-mono text-xs text-muted-foreground select-text">
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
