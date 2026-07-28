import { useState } from 'react';
import type { PersonCardDTO, PersonMeetingDTO } from '@pm/ipc';
import { Popover, PopoverContent, PopoverTrigger } from '@pm/ui';
import { ArrowUpRight, Building2, CalendarDays, History, Mail, UserPlus, X } from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import {
  avatarHue,
  initials,
  relativeDays,
  resolveParticipant,
  shortDate,
  type Participant,
} from '../lib/people';

/**
 * A participant, rendered as the person — never as `[[people/sara-lindqvist]]`
 * and never as a raw invite address. One click opens their card (who they are,
 * what they care about, when you last spoke, when you're next in a room with
 * them); the card, not the chip, is the door to the page — so a mis-click costs
 * nothing and the properties row stays a place you can read at a glance.
 *
 * Three states, because the frontmatter has three:
 * - a person page exists → full card
 * - it's the PO → "You" (their name once they've set one)
 * - nobody has a page yet → the card offers to make one, which is also what
 *   teaches the next calendar sync to resolve that address here
 */
export function PersonChip({ value, onRemove }: { value: string; onRemove?: () => void }) {
  const { people } = useApp();
  const [open, setOpen] = useState(false);
  const p = resolveParticipant(value, people);
  const hue = avatarHue(p.kind === 'person' ? p.person.slug : p.label.toLowerCase());

  return (
    <span className="group/person inline-flex max-w-full items-center gap-0.5 rounded-full bg-accent/70 py-px pr-1 pl-px text-xs transition-colors hover:bg-accent">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 items-center gap-1.5 rounded-full py-px pr-1 pl-px focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            title={p.kind === 'unknown' ? `${p.label} — no page yet` : p.label}
          >
            <Avatar participant={p} hue={hue} />
            <span className="truncate font-medium text-foreground/90">{p.label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <PersonPreview participant={p} hue={hue} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {onRemove && (
        <button
          className="rounded-full p-px text-muted-foreground/0 transition-colors group-hover/person:text-muted-foreground/70 hover:!text-destructive focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onRemove}
          aria-label={`Remove ${p.label}`}
        >
          <X className="size-3" aria-hidden />
        </button>
      )}
    </span>
  );
}

function Avatar({
  participant,
  hue,
  size = 'sm',
}: {
  participant: Participant;
  hue: number;
  size?: 'sm' | 'lg';
}) {
  const unknown = participant.kind === 'unknown';
  return (
    <span
      className={`person-avatar flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === 'lg' ? 'size-9 text-xs' : 'size-4.5 text-[9px]'
      }`}
      data-unknown={unknown || undefined}
      style={{ '--person-hue': hue } as React.CSSProperties}
      aria-hidden
    >
      {initials(participant.label)}
    </span>
  );
}

/** The card behind the first click: who they are, and what's live between you. */
function PersonPreview({
  participant,
  hue,
  onClose,
}: {
  participant: Participant;
  hue: number;
  onClose: () => void;
}) {
  const { people, openDoc, openSettings, createPerson } = useApp();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = participant.kind === 'person' ? participant.person : null;
  const named = !!people?.self.name;

  const subtitle =
    person?.role ??
    (participant.kind === 'self'
      ? participant.email
      : participant.kind === 'unknown'
        ? 'Not in your people yet'
        : undefined);

  const create = async (): Promise<void> => {
    if (participant.kind !== 'unknown') return;
    setCreating(true);
    setError(null);
    try {
      // The note keeps saying `sara@nordkap.example` — and that's fine. The page
      // carries the address, so this chip (and every other mention of it, and
      // the next calendar sync) resolves to the person from here on. Rewriting
      // the meeting's participants would edit provenance to fix a display bug.
      await createPerson({ name: participant.name, email: participant.email });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the page.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <Avatar participant={participant} hue={hue} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{participant.label}</p>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {person && person.summary && person.summary.trim() !== person.name.trim() && (
        <p className="mt-2 px-3 text-xs leading-relaxed text-muted-foreground">{person.summary}</p>
      )}

      {person && (
        <div className="mt-2.5 flex flex-col gap-1 px-3">
          {person.customer && (
            <Fact icon={Building2} label="Customer">
              <button
                className="truncate text-brand underline-offset-2 hover:underline"
                onClick={(e) => {
                  onClose();
                  void openDoc(person.customer!.path, navFromEvent(e));
                }}
              >
                {person.customer.title}
              </button>
            </Fact>
          )}
          {person.lastTold && (
            <Fact icon={History} label="Last told">
              {relativeDays(person.lastTold) ?? person.lastTold}
              <span className="text-muted-foreground"> · {shortDate(person.lastTold)}</span>
            </Fact>
          )}
          {person.nextMeeting && (
            <MeetingFact icon={CalendarDays} label="Next" meeting={person.nextMeeting} onOpen={onClose} />
          )}
          {person.lastMet && !person.nextMeeting && (
            <MeetingFact icon={CalendarDays} label="Last met" meeting={person.lastMet} onOpen={onClose} />
          )}
          {person.email && (
            <Fact icon={Mail} label="Email">
              <a
                className="truncate text-brand underline-offset-2 hover:underline"
                href={`mailto:${person.email}`}
                onClick={(e) => {
                  e.preventDefault();
                  window.open(`mailto:${person.email}`);
                }}
              >
                {person.email}
              </a>
            </Fact>
          )}
        </div>
      )}

      {person?.caresAbout && person.caresAbout.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1 px-3">
          {person.caresAbout.map((c) => (
            <span key={c} className="rounded-sm bg-brand/8 px-1.5 py-px text-xs font-medium text-brand">
              {c}
            </span>
          ))}
        </div>
      )}

      {participant.kind === 'unknown' && (
        <p className="mt-2 px-3 text-xs leading-relaxed text-muted-foreground">
          {participant.email
            ? 'The calendar keeps sending this address. Give them a page and every future invite resolves to it.'
            : 'No page for them yet — make one and this name becomes a link.'}
        </p>
      )}
      {participant.kind === 'self' && !named && (
        <p className="mt-2 px-3 text-xs leading-relaxed text-muted-foreground">
          Tell the app your name and this row reads it instead of “You”.
        </p>
      )}
      {error && <p className="mt-2 px-3 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex items-center gap-1 border-t border-border px-2 py-1.5">
        {person && (
          <CardAction
            icon={ArrowUpRight}
            onClick={(e) => {
              onClose();
              void openDoc(person.path, navFromEvent(e));
            }}
          >
            Open page
          </CardAction>
        )}
        {participant.kind === 'unknown' && (
          <CardAction icon={UserPlus} onClick={() => void create()} disabled={creating}>
            {creating ? 'Creating…' : 'Create person page'}
          </CardAction>
        )}
        {participant.kind === 'self' && (
          <CardAction
            icon={ArrowUpRight}
            onClick={() => {
              onClose();
              openSettings();
            }}
          >
            {named ? 'Your details' : 'Set your name'}
          </CardAction>
        )}
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-1.5 text-xs">
      <Icon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground/60" aria-hidden />
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function MeetingFact({
  icon,
  label,
  meeting,
  onOpen,
}: {
  icon: typeof Mail;
  label: string;
  meeting: PersonMeetingDTO;
  onOpen: () => void;
}) {
  const { openDoc } = useApp();
  return (
    <Fact icon={icon} label={label}>
      <button
        className="truncate text-brand underline-offset-2 hover:underline"
        onClick={(e) => {
          onOpen();
          void openDoc(meeting.path, navFromEvent(e));
        }}
        title={meeting.title}
      >
        {meeting.title}
      </button>
      <span className="text-muted-foreground"> · {shortDate(meeting.date)}</span>
    </Fact>
  );
}

function CardAction({
  icon: Icon,
  onClick,
  disabled,
  children,
}: {
  icon: typeof Mail;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </button>
  );
}

/** Read-only person list (no editing affordance) — for surfaces that display
 *  participants without owning them. */
export function PersonChips({ values }: { values: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {values.map((v) => (
        <PersonChip key={v} value={v} />
      ))}
    </span>
  );
}

/** A person's page reference, for pickers that need the same avatar language. */
export function PersonAvatar({ person, size = 'sm' }: { person: PersonCardDTO; size?: 'sm' | 'lg' }) {
  return (
    <Avatar
      participant={{ kind: 'person', raw: person.slug, label: person.name, person }}
      hue={avatarHue(person.slug)}
      size={size}
    />
  );
}
