---
name: Qale
description: A desktop workbench where a PO's meetings become approved system updates and a readable product memory.
colors:
  ink-blue: 'oklch(0.45 0.08 270)'
  ink-blue-foreground: 'oklch(0.99 0.003 260)'
  paper: 'oklch(0.985 0.0025 255)'
  card-white: 'oklch(1 0.0015 255)'
  ink: 'oklch(0.235 0.008 260)'
  ink-secondary: 'oklch(0.3 0.01 258)'
  stone: 'oklch(0.525 0.012 255)'
  steel-wash: 'oklch(0.955 0.005 255)'
  steel-hover: 'oklch(0.94 0.008 255)'
  hairline: 'oklch(0.9 0.006 255)'
  sidebar-steel: 'oklch(0.963 0.0045 255)'
  destructive: 'oklch(0.5 0.2 27.325)'
  warning: 'oklch(0.5 0.11 72)'
  success: 'oklch(0.52 0.1 150)'
typography:
  greeting:
    fontFamily: 'Fraunces Variable, Iowan Old Style, Georgia, serif'
    fontSize: '1.75rem'
    fontWeight: 600
    lineHeight: 1.2
  display:
    fontFamily: 'Fraunces Variable, Iowan Old Style, Georgia, serif'
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: 'Inter Variable, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: 'Inter Variable, sans-serif'
    fontSize: '0.9375rem'
    fontWeight: 400
    lineHeight: 1.625
  ui:
    fontFamily: 'Inter Variable, sans-serif'
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: 1.4
  dense:
    fontFamily: 'Inter Variable, sans-serif'
    fontSize: '0.8125rem'
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: 'Inter Variable, sans-serif'
    fontSize: '0.75rem'
    fontWeight: 600
    letterSpacing: '0.025em'
rounded:
  sm: '0.42rem'
  md: '0.56rem'
  lg: '0.7rem'
  xl: '0.98rem'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.ink-blue}'
    textColor: '{colors.ink-blue-foreground}'
    rounded: '{rounded.lg}'
    height: '32px'
    padding: '0 10px'
  button-outline:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    height: '32px'
    padding: '0 10px'
  button-ghost:
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    height: '32px'
    padding: '0 10px'
  input:
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    height: '32px'
    padding: '4px 10px'
  card:
    backgroundColor: '{colors.card-white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.xl}'
    padding: '16px'
---

# Design System: Qale

## 1. Overview

**Creative North Star: "Written in Ink"**

Qale is a precision tool whose one color is the color of ink — operator-grade speed and density on a whisper-cool steel ground, with a deep fountain-pen blue carrying every moment of action, selection, and provenance. The metaphor is the product: this is a memory that gets _written_, and everything the agent touches is marked in ink the PO can read. The accent's depth (L 0.45) and restraint (C 0.08) are what make it ink rather than interface chrome — it must never brighten toward SaaS blue, and the ground must never warm toward cream. The temperament is crisp, fast, operator-grade: compact 32px controls, instant state feedback, keyboard paths everywhere, density where the work is dense. The character lives in the ink voice and the Fraunces serif reserved for document content; the speed lives in everything else.

The system explicitly rejects the generic AI-SaaS dashboard — gradient accents, hero metrics, identical card grids, purple-on-dark "AI product" styling — and the cream-paper-plus-orange AI-default look its first palette turned out to be. It equally rejects enterprise Jira grey (untinted chrome, cramped tables, form-heavy screens with no character) and refuses to perform: no orchestrated entrances, no decorative motion, no glass. The tool disappears into the task.

**Key Characteristics:**

- One cool steel surface family, one deep ink-blue accent, near-black ink text
- Flat surfaces separated by hairline rings and background steps, not shadows
- Inter carries all UI; Fraunces appears only inside document content
- Compact, quick controls: 32px heights, 1px press-down, 150ms transitions
- Provenance-forward: sources, dates, and pending writes are first-class visual citizens

## 2. Colors

A restrained cool-neutral palette (hue ~255-260 throughout) with a single ink-blue voice.

### Primary

- **Ink Blue** (oklch(0.45 0.08 270)): the only accent — deep fountain-pen ink, not SaaS blue (too dark and too grey for that) and not purple (chroma stays at 0.08). Primary buttons, focus rings, active selection, wikilinks, and anything that marks "the agent touched this." Its lightness is set by its hardest job — being _read_ as small type on a chip's own wash — not by how a fill looks: at 0.45 it clears AA on paper (7.2:1), on an 8% wash (6.7:1), and on the 15% hover wash (6.3:1). In dark mode it lifts to oklch(0.72 0.08 275) to read on a dark card, which makes a filled control take near-black ink (oklch(0.2 0.015 260)) rather than the light foreground light mode uses.
- **Ink Blue Foreground** (oklch(0.99 0.003 260)): text on ink-blue fills.

### Neutral

- **Paper** (oklch(0.985 0.0025 255)): the body background. A whisper-cool near-white — never warm-tinted; warm paper was the cream AI-default ground this palette replaced.
- **Card White** (oklch(1 0.0015 255)): raised content surfaces (cards, popovers).
- **Sidebar Steel** (oklch(0.963 0.0045 255)): the second neutral layer for the sidebar and panel chrome, one step deeper than paper.
- **Steel Wash** (oklch(0.955 0.005 255)): secondary/muted fills — inactive tabs, code backgrounds, secondary buttons.
- **Steel Hover** (oklch(0.94 0.008 255)): hover and accent-tint states on neutral surfaces.
- **Ink** (oklch(0.235 0.008 260)): all body and heading text. (The near-black; "Ink Blue" is the accent.)
- **Stone** (oklch(0.525 0.012 255)): muted/metadata text — dates, counts, placeholders. Never for primary reading content.
- **Hairline** (oklch(0.9 0.006 255)): borders, dividers, input strokes.

### Tertiary

- **Destructive** (oklch(0.5 0.2 27.325)): errors, discard actions, unresolved links, removed diff lines. Rendered as soft fills (10–20% opacity) with full-strength text, never solid red slabs — which is why it sits this deep: the label and its own hover fill are the same hue, so the fill's ceiling sets the ink's floor. Dark mode mirrors it at oklch(0.75 0.16 22.216) against the same 10→20% ramp.
- **Amber Flag** (oklch(0.5 0.11 72), dark: oklch(0.78 0.11 78)): the freshness and caution voice — stale badges, inference flags, spot-audit banners. Deliberately warm: on the cool field it is one of the only warm things on screen, so a flag cannot be missed; AA on paper.
- **Ledger Green** (oklch(0.52 0.1 150), dark: oklch(0.72 0.12 150)): added diff lines and sent-receipts only — where the change itself is the subject. Never a general success decoration.

### Named Rules

**The One Voice Rule.** Ink Blue is the only accent and it means something: action, selection, provenance. It never decorates. If ink blue covers more than ~10% of a screen, something is wrong.
**The Same-Hue Rule.** Every neutral sits at hue 255–260, cool and barely tinted. Never introduce a warm grey or a cream-tinted near-white; a warm neutral reads as the AI default this system replaced, and a mismatched neutral reads as a bug.
**The Ink-Stays-Ink Rule.** The accent never brightens or saturates past its tokens. A lighter, louder blue stops being ink and starts being the default SaaS accent; depth and restraint are the identity.
**The Amber Flag Rule.** "Don't trust this yet" is never grey and never color-alone: staleness and inference always render in Amber Flag with an icon and a word. The quietest claim on screen must never be the one that needs verification.
**The Ink-First Rule.** Every accent and semantic color is picked as _text first_, on the darkest surface it will ever sit on — which for this system is its own hover wash, not the page. A color that only works as a fill has to be re-picked the moment someone types in it, and in a memory made of chips and wikilinks, that moment always comes. One value per role, no "text variant" beside a "fill variant": if a color can't do both jobs, it's the wrong lightness.

## 3. Typography

**Display Font:** Fraunces Variable (with Iowan Old Style, Georgia, serif)
**Body/UI Font:** Inter Variable (with system sans fallback)

**Character:** Inter runs the instrument — labels, buttons, data, chrome — tuned tight and quick. Fraunces is the voice of the documents themselves: it appears only inside content (note h1s, the wordmark), giving the workspace its literate character without ever slowing down the UI. It stays because it is a document voice, not a marketing headline face — confined to prose, it reads as "these are your papers," which is the product. With the ink accent it completes the metaphor: serif titles, inked references.

### Hierarchy

- **Greeting** (600, 1.75rem/28px, 1.2): Fraunces. Home's opening line, and nothing else — the app has exactly one screen that greets you, and this size is what makes it read as a threshold rather than a document. Never repeated inside a view.
- **Display** (600, 1.25rem, 1.3): Fraunces. Document titles inside note bodies and landing moments. Content only.
- **Title** (600, 0.875rem, 1.4): Inter. Panel headings, card titles, view headers.
- **Body** (400, 0.9375rem/15px, 1.625): Inter. Note and document prose. Cap prose at 65–75ch.
- **UI** (500, 0.875rem/14px, 1.4): Inter. Buttons, menus, list rows — the default UI size.
- **Dense** (500, 0.8125rem/13px, 1.4): Inter. Chrome rows only — sidebar tree rows, view rows, tab labels — where the operator wants more in view. Never for prose or anything the PO reads for content.
- **Label** (600, 0.75rem, +0.025em, uppercase): Inter. Section labels inside documents (note-body h2) and metadata group headers. Used sparingly; this is a document convention, not a scaffold for every screen section.

### Named Rules

**The Serif Boundary Rule.** Fraunces never appears in UI chrome — no serif buttons, labels, menus, or empty states. If it's interactive or part of the instrument, it's Inter.

## 4. Elevation

Flat by doctrine. Surfaces are separated by hairline rings (`ring-1` at foreground/10), border steps, and the paper → steel → wash background scale — not by shadows. Shadows exist only when something literally floats above the page.

### Shadow Vocabulary

- **Resting hint** (`shadow-sm`): the maximum for in-flow surfaces that need a whisper of lift (composer bars, pinned headers). Use rarely.
- **Floating** (`shadow-md` / `shadow-lg`): dropdowns, command palette, dialogs — layers that genuinely hover over the workspace.

### Named Rules

**The Floating-Only Rule.** If it doesn't detach from the page, it doesn't cast a shadow. Cards rest on rings, not shadows.

## 5. Components

Quick and precise: controls that feel like keyboard shortcuts made visible. Compact heights, instant hover states, a 1px press-down on activation, focus always visible.

### Buttons

- **Shape:** gently rounded (0.7rem radius), 32px default height (28px sm, 24px xs), 10px horizontal padding, 0.875rem/500 Inter.
- **Primary:** Ink Blue fill; near-white text in light, near-black in dark (the accent lifts too far in dark mode to carry a light label). Hover mixes the fill 10% toward the foreground rather than fading it to 80% — a translucent fill lets the surface through and lightens the very state the pointer is on, which is the one moment the label must be clearest.
- **Hover / Focus / Active:** all transitions ~150ms; focus is a 3px ink-blue ring at 50% opacity plus ring-colored border; active presses down 1px (`translateY(1px)`).
- **Outline:** hairline border on paper, hover fills with steel wash. **Secondary:** steel-wash fill, hover deepens via a 5% ink color-mix. **Ghost:** transparent until hover. **Destructive:** soft red fill (10% → 20% on hover) with full-strength red text — never a solid red slab.
- **Disabled:** 50% opacity, pointer events off.

### Cards / Containers

- **Corner Style:** 0.98rem radius (rounded-xl).
- **Background:** Card White on Paper.
- **Shadow Strategy:** none — a hairline ring (foreground at 10%) does the separation (see Elevation).
- **Internal Padding:** 16px default, 12px small variant, matching gap between sections.

### Inputs / Fields

- **Style:** 32px height, hairline border, transparent background, 0.7rem radius, placeholder in Stone.
- **Focus:** border shifts to ink blue plus the standard 3px/50% focus ring.
- **Error / Disabled:** invalid state swaps border and ring to destructive red at 20%; disabled halves opacity and tints the fill.

### Composer (`components/Composer.tsx`)

One bar for every question the PO asks, whether it starts a conversation (chat) or is docked at the foot of a browse page (`ScopedAskComposer` on folder and context pages). Shared shell: `max-w-2xl`, card fill, hairline, rounded-xl (the card radius — a rounder bar read as a pill, not an instrument), `shadow-sm` resting hint, 8px padding. **Two stacked rows, never a single line:** the textarea spans the full width on top (one line tall, growing to 160px before it scrolls), and every control sits on a 28px strip beneath it — leads on the left (skill picker in chat, scope chip on a browse page), send on the right. Every lead is a 28px labelled chip — the idle skill trigger says "Skill" next to its wand, so picking one and having one picked are the same shape and a lone glyph never has to be guessed at. Nothing wraps around a control, and no two controls sit at diagonal corners.

- **Scope chip:** the page's own scope made visible — a Hash or Folder glyph plus the name on an 8% ink-blue wash, wikilink vocabulary. It survives typing, so the question's reach is legible after the placeholder is gone.
- **Starter row (24px, above the bar):** opener questions while the field is empty; it keeps its height while you type so the list above never shifts.
- **Send:** icon-only, `↵` in the tooltip. Steel-wash fill while there is nothing to send, ink blue the moment there is — the state change is the only color event in the component.
- **Placeholder:** a sentence, never a syntax list, and it sets one step closer to ink than the Stone every other placeholder uses (`foreground/70`). On an empty composer the placeholder is not metadata — it is the invitation, and the only content in the bar.
- **Syntax hint:** what `@` and `#` do rides on the control strip beside the leads, not inside the placeholder, and fades out (never unmounts) once there is a question — so the strip holds its height and the send button never shifts. The strip is where the composer teaches itself; the field stays a field.

### Navigation

- **Sidebar:** Sidebar Steel surface, Inter UI size, rows hover to Steel Hover; the active row carries the accent tint with Ink-secondary text. Inbox pinned on top; trees collapse. Three tiers, top to bottom: the destinations (Inbox / Todos / Ask — one weight, one size, icons muted until the row has something waiting), then the live rail (Sessions), then the memory tree. Section labels name the page they open — the rail says "Sessions" because "All" lands on Sessions. Nothing sits below the memory tree: how the app is _set up_ — Skills, Agents, Settings — lives in the header cog's menu, one row each (glyph · name · the one fact, right-aligned), and the cog wears a dot in the flag voice when something under it is broken or blocked.
- **Tabs (workspace tab strip):** browser geometry — tabs sit on the steel chrome under a 4px shoulder, top corners rounded 10px, bottom corners flaring outward on a 6px concave curve that carries the tab's hairline into the strip's. The active tab is Paper with a hairline on top and sides and no bottom, so tab and content read as one surface. Inactive tabs are unfilled, lighting toward Paper on hover; tab gaps are twice the flare so neighbouring curves meet, never overlap. Documents and sessions share one tab vocabulary.
- **Command palette (⌘K):** the primary navigation instrument — floating layer with `shadow-lg`, standard list-row hover states.
- **In-page tabs (Settings):** a page that is a set of unrelated panels wears one underline strip (`Tabs variant="line"`) on its own hairline rail directly under the page header: 36px tall, `px-4`, a 14px glyph beside each label at Dense size, and 5px of room beneath the list so the 2px underline lands on the rail rather than past it. Never the filled pill variant — the workspace tab strip above already owns filled tab geometry, and two filled rows read as two tab bars. The panel starts at the tab's own left edge (never centred) and caps at `max-w-2xl`. A tab whose panel holds something broken carries a 6px flag-voice dot beside its label, with the reason in the tooltip and in `sr-only` text: a tab is a place things can hide, and this is what keeps them from hiding.
- **Page header (`PageHeader`):** the one rail every view wears, documents and sessions and Inbox and Todos alike — 40px tall, `px-4`, hairline bottom, and nothing else. Left: a 14px type glyph, muted clickable crumbs separated by a 12px chevron, then the leaf (the only near-ink text, `text-foreground/80`, truncating) and muted `· meta` counts. All of it at Label size (0.75rem); a file leaf sets in mono, a view leaf does not. Right: standing actions as icon-only `HeaderAction`s with the name in the tooltip, at most one labelled `Button size="sm"` for the view's current contextual action, and `HeaderMenu` (⋯) for the rare and the destructive.

### Named Rules

**The Location-Bar Rule.** The header states _where you are_, never _what this page is called_ — the tab strip already carries the loud name. No view gets a taller header, a display face, or a second title bar; a session's title is a whole sentence the PO typed, and it sets at the same 12px as everything else.
**The Quiet-Composer Rule.** A surface you type into for minutes at a time gets no accent ring. The composer's focus state is a one-step darker hairline (`foreground/20`) and nothing else — the caret is the focus indicator. The 3px ink-blue focus ring belongs to controls you _land on_ (buttons, rows, short fields), never to a bar that is focused most of the time; there it reads as a glow around the work.
**The Honest-Disclosure Rule.** A chevron promises something is folded away, so a section with nothing under it doesn't get one (its label still browses the folder), and an empty rail section states nothing — the absence is the answer, not a row of prose saying so. The converse: folding a section costs you the rows, never the number, so the count appears on the header exactly while the body is hidden.
**The Inactive-Never-Accent Rule.** A control with nothing to do never wears ink blue. Disabled primaries render as steel fills with a dimmed glyph, never as a washed-out accent — a faded brand color reads as a broken button, and the accent has to keep meaning "this does something".
**The Actions-Hold Rule.** In a header, actions keep their width and the location truncates — never the reverse. Anything long on the right (a keyboard hint) caps its own width and hides at narrow viewports rather than shortening "Inbox" to "In…".

### Wikilink (signature component)

Inline reference chips inside document prose: ink-blue text on an 8% ink-blue wash, 1px padding, small radius; hover deepens to 15%. Unresolved links swap to the destructive pair. This is the visible fiber of the product memory — treat its styling as sacred.

## 6. Do's and Don'ts

### Do:

- **Do** keep every neutral at hue 255–260 (The Same-Hue Rule) and every accent moment ink blue (The One Voice Rule).
- **Do** hit WCAG AA: ≥4.5:1 body contrast (Ink on Paper is ~16:1; Stone is for metadata only), visible focus rings on every interactive element, full keyboard paths.
- **Do** keep transitions 150–250ms, state-driven, with `prefers-reduced-motion` alternatives.
- **Do** use skeletons for loading content and empty states that teach the interface.
- **Do** show provenance: sources, dates, and pending-write indicators are part of the component, not an afterthought.

### Don't:

- **Don't** build the generic AI-SaaS dashboard: no gradient accents, no hero metrics, no identical card grids, no purple-on-dark "AI product" styling.
- **Don't** let the accent brighten or saturate toward SaaS blue (The Ink-Stays-Ink Rule), don't let the neutrals drift warm toward cream, and don't slide into enterprise Jira grey: the cool tint is faint but it is there on purpose.
- **Don't** put shadows on resting surfaces (The Floating-Only Rule) or use side-stripe borders (`border-left` > 1px) as card/callout accents.
- **Don't** use Fraunces anywhere interactive (The Serif Boundary Rule) or uppercase-tracked eyebrows as section scaffolding outside document content.
- **Don't** use gradient text, glassmorphism, decorative motion, or orchestrated page-load choreography — the PO is mid-task; the tool loads into work.
