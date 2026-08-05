import { dirForType, isFolderIndex, refToSlug, slugify, type PersonFrontmatter } from '@qale/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';

/**
 * People as every people-facing surface needs them. A meeting's `participants`
 * are written three ways — a `[[people/…]]` link (calendar sync resolved the
 * attendee), a bare display name (hand-written), or a raw email (nobody has a
 * page yet) — and no surface should ever render those raw forms at the PO.
 * This directory is what a chip resolves against: one read gives both the label
 * and the whole preview card, so hovering a participant costs no round trip.
 */
export interface PersonCard {
  path: string;
  slug: string;
  /** Display name — the note's title, never the slug or the email. */
  name: string;
  summary: string;
  role?: string;
  email?: string;
  caresAbout?: string[];
  /** `last_told` — the what-they-were-told clock. */
  lastTold?: string;
  tags?: string[];
  customer?: { slug: string; title: string; path: string };
  /** The most recent meeting they were in (today or earlier). */
  lastMet?: PersonMeeting;
  /** The next meeting they're in (today or later) — the conversation on the horizon. */
  nextMeeting?: PersonMeeting;
}

export interface PersonMeeting {
  path: string;
  title: string;
  date: string;
}

/** Who the workspace owner is, so their own row reads "You" and never an email. */
export interface SelfIdentity {
  /** The PO's display name, when they've set one. */
  name: string | null;
  /** Lower-cased addresses that mean "me" — connected accounts plus any aliases. */
  emails: string[];
}

export interface PeopleDirectory {
  people: PersonCard[];
  self: SelfIdentity;
}

/** Every person note, sorted by name — the resolution table for people chips. */
export function listPeople(ctx: UseCaseContext): PersonCard[] {
  const people = ctx.index
    .listByType('person')
    .filter((n) => !isFolderIndex(n.path))
    .map((n) => toCard(ctx, n));
  attachMeetings(ctx, people);
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

function toCard(ctx: UseCaseContext, n: IndexedNote): PersonCard {
  const fm = n.frontmatter as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const v = fm[key];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const strings = (key: string): string[] | undefined => {
    const v = fm[key];
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    return out.length > 0 ? out : undefined;
  };
  return {
    path: n.path,
    slug: n.slug,
    name: n.title,
    summary: n.summary,
    role: str('role'),
    email: str('email'),
    caresAbout: strings('cares_about'),
    lastTold: str('last_told'),
    tags: strings('tags'),
    customer: resolveRef(ctx, str('customer')),
  };
}

function resolveRef(
  ctx: UseCaseContext,
  ref: string | undefined,
): { slug: string; title: string; path: string } | undefined {
  const target = refToSlug(ref);
  if (!target) return undefined;
  const path = ctx.index.resolve(target);
  const note = path ? ctx.index.get(path) : null;
  if (!note) return undefined;
  return { slug: note.slug, title: note.title, path: note.path };
}

/**
 * Fill in each person's last/next meeting in ONE pass over the meetings — the
 * card's most useful line ("you're seeing them Tuesday") without a per-card
 * scan. Participants are matched the same three ways the UI resolves them:
 * link target, email, or display name.
 */
function attachMeetings(ctx: UseCaseContext, people: PersonCard[]): void {
  if (people.length === 0) return;
  const today = ctx.clock.now().slice(0, 10);
  const byKey = new Map<string, PersonCard[]>();
  const register = (key: string | undefined, card: PersonCard): void => {
    const k = key?.trim().toLowerCase();
    if (!k) return;
    byKey.set(k, [...(byKey.get(k) ?? []), card]);
  };
  for (const card of people) {
    register(card.slug, card);
    register(card.slug.split('/').pop(), card);
    register(card.name, card);
    register(card.email, card);
  }

  for (const meeting of ctx.index.listByType('meeting')) {
    const fm = meeting.frontmatter as Record<string, unknown>;
    const date = typeof fm['date'] === 'string' ? fm['date'].slice(0, 10) : null;
    if (!date) continue;
    const raw = Array.isArray(fm['participants']) ? fm['participants'] : [];
    const seen = new Set<PersonCard>();
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const key = (refToSlug(entry) ?? entry).trim().toLowerCase();
      for (const card of byKey.get(key) ?? byKey.get(key.split('/').pop() ?? key) ?? []) seen.add(card);
    }
    for (const card of seen) {
      const ref: PersonMeeting = { path: meeting.path, title: meeting.title, date };
      if (date <= today) {
        if (!card.lastMet || date > card.lastMet.date) card.lastMet = ref;
      } else if (!card.nextMeeting || date < card.nextMeeting.date) card.nextMeeting = ref;
    }
  }
}

export interface CreatePersonInput {
  name?: string;
  /** The address that will let calendar sync resolve future attendees here. */
  email?: string;
}

/**
 * Make a person page from what a participant chip knows — a name, an email, or
 * both. Written with the email in frontmatter on purpose: that's the join key
 * calendar sync uses, so the next invite resolves to this page instead of
 * landing as a raw address again.
 */
export async function createPerson(ctx: UseCaseContext, input: CreatePersonInput): Promise<PersonCard> {
  const email = input.email?.trim();
  const name = input.name?.trim() || nameFromEmail(email) || '';
  if (!name) throw new Error('a person needs a name or an email');
  const slug = slugify(name);
  if (!slug) throw new Error(`there is nothing to name a page after in “${name}”`);

  const desired = `${dirForType('person')}/${slug}.md`;
  let path = desired;
  for (let n = 2; await ctx.vault.exists(path); n += 1) path = `${dirForType('person')}/${slug}-${n}.md`;

  const frontmatter: PersonFrontmatter = {
    type: 'person',
    title: name,
    summary: email ? `${name} — ${email}` : name,
    ...(email ? { email } : {}),
  };
  const note = await ctx.vault.writeNote(path, frontmatter, '');
  ctx.index.reindex(note);
  await ctx.git.commitPaths([note.path], `create: person ${name}`);
  const indexed = ctx.index.get(note.path);
  const card: PersonCard = indexed
    ? toCard(ctx, indexed)
    : { path: note.path, slug: note.slug, name, summary: frontmatter.summary, ...(email ? { email } : {}) };
  attachMeetings(ctx, [card]);
  return card;
}

/** "sara.lindqvist@nordkap.example" → "Sara Lindqvist" — a decent first guess the PO can retitle. */
export function nameFromEmail(email: string | undefined): string | null {
  const local = email?.split('@')[0]?.trim();
  if (!local) return null;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(' ') : null;
}
