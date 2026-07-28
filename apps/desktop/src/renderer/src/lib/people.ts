import type { PeopleDirectoryDTO, PersonCardDTO } from '@pm/ipc';

/**
 * Participants are stored three ways — `[[people/sara-lindqvist]]` (calendar
 * sync found a page), `Sara Lindqvist` (typed by hand), `sara@nordkap.example` (an
 * invite whose attendee has no page yet) — and the PO should never see any of
 * those forms. This resolves a raw frontmatter entry to what a chip renders:
 * a name, and whatever page/preview backs it.
 */
export type Participant =
  /** A person page exists — chip opens its preview card. */
  | { kind: 'person'; raw: string; label: string; person: PersonCardDTO }
  /** The PO themselves — reads as their name (or "You"), never their address. */
  | { kind: 'self'; raw: string; label: string; email?: string }
  /** Nobody has made a page for them yet — the chip offers to. */
  | { kind: 'unknown'; raw: string; label: string; email?: string; name?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Frontmatter aliases the vault (and the seed data) uses for the PO. */
const SELF_ALIASES = new Set(['me', 'myself', 'you', 'self']);

/** `[[people/sara-lindqvist|Sara]]` → `people/sara-lindqvist`. */
function linkTarget(raw: string): string | null {
  const m = raw.trim().match(/^\[\[(.+?)\]\]$/);
  if (!m?.[1]) return null;
  const inner = m[1];
  const withoutAlias = inner.split('|')[0] ?? inner;
  // Typed links carry `type::target`; the target is the person.
  const parts = withoutAlias.split('::');
  return (parts[parts.length - 1] ?? withoutAlias).trim() || null;
}

/** "sara.lindqvist@nordkap.example" → "Sara Lindqvist" (a guess, shown only as a suggested name). */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ') || email;
}

export function resolveParticipant(raw: string, dir: PeopleDirectoryDTO | null): Participant {
  const value = raw.trim();
  const selfName = dir?.self.name?.trim() || null;
  const target = linkTarget(value);
  const bare = (target ?? value).trim();
  const lower = bare.toLowerCase();
  const leaf = lower.split('/').pop() ?? lower;

  if (SELF_ALIASES.has(lower)) return { kind: 'self', raw, label: selfName ?? 'You' };
  if (EMAIL.test(lower) && dir?.self.emails.includes(lower)) {
    return { kind: 'self', raw, label: selfName ?? 'You', email: bare };
  }

  const people = dir?.people ?? [];
  const person =
    people.find((p) => p.slug.toLowerCase() === lower) ??
    people.find((p) => (p.slug.split('/').pop() ?? '').toLowerCase() === leaf) ??
    (EMAIL.test(lower) ? people.find((p) => p.email?.trim().toLowerCase() === lower) : undefined) ??
    people.find((p) => p.name.trim().toLowerCase() === lower);
  if (person) return { kind: 'person', raw, label: person.name, person };

  // A dangling `[[people/…]]` link reads as a name, not as its slug — the page
  // is what's missing, not the person.
  if (EMAIL.test(lower)) return { kind: 'unknown', raw, label: bare, email: bare, name: nameFromEmail(bare) };
  const label = target ? titleFromSlug(bare) : bare;
  return { kind: 'unknown', raw, label, name: label };
}

/** `people/sara-lindqvist` → `Sara Lindqvist`, for links whose page is gone. */
function titleFromSlug(slug: string): string {
  const leaf = slug.split('/').pop() ?? slug;
  return leaf
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Two letters at most — "Sara Lindqvist" → SL, "egralen@gmail.com" → EG. */
export function initials(label: string): string {
  const cleaned = label.replace(/@.*$/, '').replace(/[._-]+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + second).toUpperCase();
}

/**
 * A stable hue per person so the same face keeps the same colour across every
 * meeting — recognition without asking anyone to pick avatar colours.
 */
export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

/** "2026-08-05" → "Aug 5" / "5 Aug 2025" once it leaves this year. */
export function shortDate(iso: string, today = new Date()): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "in 3 days" / "8 days ago" — the line that makes `last_told` mean something. */
export function relativeDays(iso: string, today = new Date()): string | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((d.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/** What a picked person is written as — a link, so the page and this note stay joined. */
export function participantValue(person: PersonCardDTO): string {
  return `[[${person.slug}]]`;
}
