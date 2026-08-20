# Working in this repo

`README.md` has the layout and the commands. `apps/desktop/PRODUCT.md` has what the
product is and what it refuses to be. This file is about how to write.

## How to write

Write in Simplified Technical English (ASD-STE100) and follow Zinsser's four
principles: simplicity, brevity, clarity, humanity.

This covers everything: replies in the session, code comments, commit messages,
docs, and every string a person reads in the app.

### Zinsser decides what to say

- **Simplicity.** Cut the word that carries nothing. Most first drafts are half
  filler.
- **Brevity.** Answer the question that was asked. Don't restate it first, don't
  summarise yourself after, don't list the options you already rejected.
- **Clarity.** If a sentence can be read two ways, one of those readings will be
  the one that costs an hour. Rewrite it.
- **Humanity.** Sound like a colleague, not a manual. Contractions are fine. The
  rules below are for clear sentences, not stiff ones.

### STE decides how to build the sentence

- **One word, one meaning.** Pick one term for a thing and use it every time.
  Never vary the wording for elegance. Two words for one thing read as two things.
- **Short sentences.** Around 20 words for an instruction, 25 for anything else.
  One idea per sentence. One instruction per sentence.
- **Short paragraphs.** Six sentences is a long one.
- **Active voice, and name who acts.** "The sync failed" beats "a failure was
  encountered".
- **Simple tenses.** Past, present, future. Not "would have been able to".
- **Condition first.** "If the index is stale, rebuild it." Not the other way
  round.
- **Keep the small words.** Don't drop "the", "a" or "that" to sound crisp. They
  are what makes a sentence read in one pass.
- **Three nouns in a row is the limit.** Break up "meeting note summary field
  update policy".
- **Use a list when it is a list.** Steps and sets go in a list. A two-sentence
  answer stays two sentences.

Two parts of ASD-STE100 are deliberately left out: its approved dictionary of
about 900 words, and its ban on `-ing` forms. Both exist so that non-native
readers can parse aircraft manuals. Here they only make prose stilted, and
nothing can check them.

### Never

- **Em dashes (—).** Not for asides, not as a connector, not in place of a colon.
  Use a comma, a colon, parentheses, or a new sentence.
- **Assistant-speak.** "delve", "crucially", "notably", "load-bearing", "the key
  insight", "in essence", "that said", "it's worth noting", "great question", and
  the "It's not just X, it's Y" construction.
- **Headers and bold-led bullets on a short answer.** Structure is for content
  that is genuinely structured.

## Say what is true

Style is half of it. The other half is that a confident wrong answer costs more
than a long one.

- Report what happened. If a test failed, paste the failure. If a step was
  skipped, say which. When something is done and checked, say so plainly.
- Never say code works because it should. Run it, or say you didn't.
- If you were wrong, fix it in one sentence and carry on. Don't relitigate, don't
  apologise twice, don't tally your past mistakes.
