/**
 * The workspace language, and how to tell what language a note is already in
 * (OW5).
 *
 * Two rules live here, and they are the whole module.
 *
 * A language is a language, not a locale. `sv-SE` and `sv-FI` are the same
 * language, and so are `en-US` and `en-GB`: a PM who moves from Stockholm to
 * Helsinki, or whose laptop flips to a different English region, has not changed
 * what their notes are written in. Only the primary subtag is ever stored, so a
 * region-only change cannot read as a language change and cannot restate the
 * setting behind their back.
 *
 * And the setting says what to WRITE, never what is already on disk. A note
 * written before the setting changed is still in the old language, so any pass
 * that touches an existing note asks {@link detectLanguage} what that note says
 * rather than trusting the setting. Half-translating a note helps nobody.
 *
 * What is deliberately NOT here: a translation table. Type names, tags,
 * typed-link relation names, folder names and slugs are addresses and grouping
 * keys, and they stay in English whatever the workspace language is. A tag
 * vocabulary that forks by language is a grouping feature that has quietly
 * stopped grouping.
 */

/** The languages the workspace can be set to, in the order the picker shows them. */
export const LANGUAGE_TAGS = ['en', 'sv', 'nb', 'da', 'fi', 'de', 'fr', 'es', 'nl'] as const;

export type LanguageTag = (typeof LANGUAGE_TAGS)[number];

/**
 * What each language is CALLED in the prompt. English names on purpose: this is
 * the word the model is given ("Write prose in Swedish"), and the prompt around
 * it is English, so an endonym would be the odd one out.
 */
export const LANGUAGE_NAMES: Record<LanguageTag, string> = {
  en: 'English',
  sv: 'Swedish',
  nb: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  nl: 'Dutch',
};

/** What a workspace is written in until anyone says otherwise. */
export const DEFAULT_LANGUAGE: LanguageTag = 'en';

/**
 * The language part of a locale, and nothing else. "sv-SE", "sv_FI", "sv" and
 * "SV" all come back as "sv"; a script or region beyond it is dropped
 * ("zh-Hant-TW" → "zh"). Empty string when there is no language in there at all.
 */
export function languageTag(locale: string | null | undefined): string {
  if (typeof locale !== 'string') return '';
  const primary = locale.trim().split(/[-_.@]/)[0] ?? '';
  return /^[A-Za-z]{2,3}$/.test(primary) ? primary.toLowerCase() : '';
}

/**
 * Are these two locales the same language? The question every "did the language
 * change?" check should be asking, so that swapping region never counts.
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = languageTag(a);
  return left !== '' && left === languageTag(b);
}

/**
 * A locale (or a stored setting) read as a workspace language. Anything we have
 * no name for falls back to English rather than being carried around as a tag
 * the prompt cannot spell out.
 */
export function workspaceLanguage(locale: string | null | undefined): LanguageTag {
  const tag = languageTag(locale);
  return (LANGUAGE_TAGS as readonly string[]).includes(tag)
    ? (tag as LanguageTag)
    : DEFAULT_LANGUAGE;
}

/** The English name of a workspace language, for prompts and for the UI. */
export function languageName(locale: string | null | undefined): string {
  return LANGUAGE_NAMES[workspaceLanguage(locale)];
}

/**
 * Stopwords, which is all a Swedish-or-English call needs. Every word here is a
 * word in one list and not the other: "men" (sv) is also English "men", "under"
 * is a word in both, "i" collides with "I" — those and their kind are left out,
 * because a shared word is noise in both directions.
 */
const SWEDISH_STOPWORDS = new Set([
  'och',
  'att',
  'för',
  'inte',
  'är',
  'som',
  'det',
  'den',
  'på',
  'vi',
  'ska',
  'med',
  'har',
  'kan',
  'till',
  'av',
  'en',
  'ett',
  'vad',
  'när',
  'från',
  'hur',
  'också',
  'eller',
  'jag',
  'du',
  'han',
  'hon',
  'var',
  'vara',
  'blir',
  'skulle',
  'bara',
  'mycket',
  'över',
  'om',
  'så',
  'de',
  'dem',
  'sedan',
  'redan',
  'ingen',
  'något',
  'några',
  'väldigt',
  'här',
  'där',
]);

const ENGLISH_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'is',
  'that',
  'it',
  'in',
  'for',
  'on',
  'with',
  'this',
  'are',
  'was',
  'be',
  'have',
  'has',
  'we',
  'they',
  'not',
  'but',
  'from',
  'at',
  'as',
  'by',
  'or',
  'an',
  'if',
  'which',
  'what',
  'when',
  'how',
  'about',
  'their',
  'there',
  'would',
  'should',
  'will',
  'can',
  'were',
  'been',
  'into',
  'than',
  'them',
  'because',
  'already',
  'very',
]);

/**
 * How many stopword hits the winner needs before this is a reading rather than a
 * coin toss. Two is low on purpose: one sentence should be enough to tell, and
 * the caller is told "no idea" (null) rather than guessed at below the floor.
 */
const MIN_HITS = 2;

/** Long notes are transcripts. The opening is plenty; counting the rest costs and settles nothing. */
const MAX_WORDS = 2000;

/**
 * What language a note is written in: Swedish, English, or null for "cannot
 * tell" (too short, a table of ticket ids, a language that is neither).
 *
 * Deterministic and dependency-free, because this runs on every read of every
 * note. It counts stopwords, which is the crudest method that actually works on
 * one paragraph, and it says null rather than guessing when the counts are close
 * — a wrong answer here would tell a session to write Swedish into an English
 * note, which is worse than telling it nothing.
 */
export function detectLanguage(text: string): 'sv' | 'en' | null {
  if (!text) return null;
  // Frontmatter is machine vocabulary in every workspace (`type:`, `summary:`),
  // so it says nothing about the prose and would tilt every short note English.
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const words = body.toLowerCase().match(/\p{L}+/gu);
  if (!words) return null;
  let sv = 0;
  let en = 0;
  for (const word of words.slice(0, MAX_WORDS)) {
    if (SWEDISH_STOPWORDS.has(word)) sv++;
    else if (ENGLISH_STOPWORDS.has(word)) en++;
  }
  if (sv > en && sv >= MIN_HITS) return 'sv';
  if (en > sv && en >= MIN_HITS) return 'en';
  return null;
}
