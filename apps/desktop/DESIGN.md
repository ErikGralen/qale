---
name: Produktminnet
description: A desktop workbench where a PO's meetings become approved system updates and a readable product memory.
colors:
  terracotta: "oklch(0.62 0.13 42)"
  terracotta-foreground: "oklch(0.99 0.01 70)"
  paper: "oklch(0.987 0.003 70)"
  card-white: "oklch(1 0.002 70)"
  ink: "oklch(0.24 0.008 60)"
  ink-secondary: "oklch(0.3 0.01 60)"
  stone: "oklch(0.53 0.012 62)"
  clay-wash: "oklch(0.955 0.006 70)"
  clay-hover: "oklch(0.94 0.012 68)"
  hairline: "oklch(0.9 0.008 68)"
  sidebar-sand: "oklch(0.965 0.005 70)"
  destructive: "oklch(0.577 0.2 27.325)"
  warning: "oklch(0.5 0.11 72)"
  success: "oklch(0.52 0.1 150)"
typography:
  display:
    fontFamily: "Fraunces Variable, Iowan Old Style, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.625
  ui:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
  dense:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.025em"
rounded:
  sm: "0.42rem"
  md: "0.56rem"
  lg: "0.7rem"
  xl: "0.98rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta}"
    textColor: "{colors.terracotta-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
---

# Design System: Produktminnet

## 1. Overview

**Creative North Star: "The Warm Instrument"**

Produktminnet is a precision tool built in warm materials — operator-grade speed and density rendered in clay and paper instead of gunmetal. The whole surface is a near-white warm paper (hue ~70, chroma barely above zero) with near-black ink; a single terracotta accent marks actions, selection, and provenance. The temperament is crisp, fast, operator-grade: compact 32px controls, instant state feedback, keyboard paths everywhere, density where the work is dense. The warmth lives in the material (the clay-tinted neutrals, the Fraunces serif reserved for document content); the speed lives in everything else.

The system explicitly rejects the generic AI-SaaS dashboard — gradient accents, hero metrics, identical card grids, purple-on-dark "AI product" styling — and enterprise Jira grey: dense grey chrome, cramped tables, form-heavy screens with no character. It equally refuses to perform: no orchestrated entrances, no decorative motion, no glass. The tool disappears into the task.

**Key Characteristics:**
- One warm-paper surface family, one terracotta accent, near-black ink
- Flat surfaces separated by hairline rings and background steps, not shadows
- Inter carries all UI; Fraunces appears only inside document content
- Compact, quick controls: 32px heights, 1px press-down, 150ms transitions
- Provenance-forward: sources, dates, and pending writes are first-class visual citizens

## 2. Colors

A restrained warm-neutral palette (hue ~70 throughout) with a single terracotta voice.

### Primary
- **Terracotta** (oklch(0.62 0.13 42)): the only accent. Primary buttons, focus rings, active selection, wikilinks, and anything that marks "the agent touched this." In dark mode it lifts slightly (oklch(0.66 0.13 44)).
- **Terracotta Foreground** (oklch(0.99 0.01 70)): text on terracotta fills.

### Neutral
- **Paper** (oklch(0.987 0.003 70)): the body background. Warm-tinted toward the brand hue, not cream — chroma stays at 0.003.
- **Card White** (oklch(1 0.002 70)): raised content surfaces (cards, popovers).
- **Sidebar Sand** (oklch(0.965 0.005 70)): the second neutral layer for the sidebar and panel chrome, one step deeper than paper.
- **Clay Wash** (oklch(0.955 0.006 70)): secondary/muted fills — inactive tabs, code backgrounds, secondary buttons.
- **Clay Hover** (oklch(0.94 0.012 68)): hover and accent-tint states on neutral surfaces.
- **Ink** (oklch(0.24 0.008 60)): all body and heading text.
- **Stone** (oklch(0.53 0.012 62)): muted/metadata text — dates, counts, placeholders. Never for primary reading content.
- **Hairline** (oklch(0.9 0.008 68)): borders, dividers, input strokes.

### Tertiary
- **Destructive** (oklch(0.577 0.2 27.325)): errors, discard actions, unresolved links, removed diff lines. Rendered as soft fills (10–20% opacity) with full-strength text, never solid red slabs.
- **Amber Flag** (oklch(0.5 0.11 72), dark: oklch(0.78 0.11 78)): the freshness and caution voice — stale badges, inference flags, spot-audit banners. Sits inside the warm family but reads unmistakably as a flag; AA on paper.
- **Ledger Green** (oklch(0.52 0.1 150), dark: oklch(0.72 0.12 150)): added diff lines and sent-receipts only — where the change itself is the subject. Never a general success decoration.

### Named Rules
**The One Voice Rule.** Terracotta is the only accent and it means something: action, selection, provenance. It never decorates. If terracotta covers more than ~10% of a screen, something is wrong.
**The Same-Hue Rule.** Every neutral sits at hue 60–70. Never introduce a cool grey; a mismatched neutral reads as a bug in this system.
**The Amber Flag Rule.** "Don't trust this yet" is never grey and never color-alone: staleness and inference always render in Amber Flag with an icon and a word. The quietest claim on screen must never be the one that needs verification.

## 3. Typography

**Display Font:** Fraunces Variable (with Iowan Old Style, Georgia, serif)
**Body/UI Font:** Inter Variable (with system sans fallback)

**Character:** Inter runs the instrument — labels, buttons, data, chrome — tuned tight and quick. Fraunces is the voice of the documents themselves: it appears only inside content (note h1s, the wordmark), giving the workspace its literate warmth without ever slowing down the UI.

### Hierarchy
- **Display** (600, 1.25rem, 1.3): Fraunces. Document titles inside note bodies and landing moments. Content only.
- **Title** (600, 0.875rem, 1.4): Inter. Panel headings, card titles, view headers.
- **Body** (400, 0.9375rem/15px, 1.625): Inter. Note and document prose. Cap prose at 65–75ch.
- **UI** (500, 0.875rem/14px, 1.4): Inter. Buttons, menus, list rows — the default UI size.
- **Dense** (500, 0.8125rem/13px, 1.4): Inter. Chrome rows only — sidebar tree rows, view rows, tab labels — where the operator wants more in view. Never for prose or anything the PO reads for content.
- **Label** (600, 0.75rem, +0.025em, uppercase): Inter. Section labels inside documents (note-body h2) and metadata group headers. Used sparingly; this is a document convention, not a scaffold for every screen section.

### Named Rules
**The Serif Boundary Rule.** Fraunces never appears in UI chrome — no serif buttons, labels, menus, or empty states. If it's interactive or part of the instrument, it's Inter.

## 4. Elevation

Flat by doctrine. Surfaces are separated by hairline rings (`ring-1` at foreground/10), border steps, and the paper → sand → wash background scale — not by shadows. Shadows exist only when something literally floats above the page.

### Shadow Vocabulary
- **Resting hint** (`shadow-sm`): the maximum for in-flow surfaces that need a whisper of lift (composer bars, pinned headers). Use rarely.
- **Floating** (`shadow-md` / `shadow-lg`): dropdowns, command palette, dialogs — layers that genuinely hover over the workspace.

### Named Rules
**The Floating-Only Rule.** If it doesn't detach from the page, it doesn't cast a shadow. Cards rest on rings, not shadows.

## 5. Components

Quick and precise: controls that feel like keyboard shortcuts made visible. Compact heights, instant hover states, a 1px press-down on activation, focus always visible.

### Buttons
- **Shape:** gently rounded (0.7rem radius), 32px default height (28px sm, 24px xs), 10px horizontal padding, 0.875rem/500 Inter.
- **Primary:** Terracotta fill, near-white text; hover lightens the fill to 80% opacity.
- **Hover / Focus / Active:** all transitions ~150ms; focus is a 3px terracotta ring at 50% opacity plus ring-colored border; active presses down 1px (`translateY(1px)`).
- **Outline:** hairline border on paper, hover fills with clay wash. **Secondary:** clay-wash fill, hover deepens via a 5% ink color-mix. **Ghost:** transparent until hover. **Destructive:** soft red fill (10% → 20% on hover) with full-strength red text — never a solid red slab.
- **Disabled:** 50% opacity, pointer events off.

### Cards / Containers
- **Corner Style:** 0.98rem radius (rounded-xl).
- **Background:** Card White on Paper.
- **Shadow Strategy:** none — a hairline ring (foreground at 10%) does the separation (see Elevation).
- **Internal Padding:** 16px default, 12px small variant, matching gap between sections.

### Inputs / Fields
- **Style:** 32px height, hairline border, transparent background, 0.7rem radius, placeholder in Stone.
- **Focus:** border shifts to terracotta plus the standard 3px/50% focus ring.
- **Error / Disabled:** invalid state swaps border and ring to destructive red at 20%; disabled halves opacity and tints the fill.

### Navigation
- **Sidebar:** Sidebar Sand surface, Inter UI size, rows hover to Clay Hover; the active row carries the accent tint with Ink-secondary text. Inbox pinned on top; trees collapse.
- **Tabs (workspace tab strip):** browser-style join — full-height tabs on the sand chrome; the active tab is Paper with hairline top/side borders and top-rounded corners, its bottom edge bridging the strip's hairline into the content surface. Inactive tabs stay quiet with a hover wash. Documents and sessions share one tab vocabulary.
- **Command palette (⌘K):** the primary navigation instrument — floating layer with `shadow-lg`, standard list-row hover states.

### Wikilink (signature component)
Inline reference chips inside document prose: terracotta text on an 8% terracotta wash, 1px padding, small radius; hover deepens to 15%. Unresolved links swap to the destructive pair. This is the visible fiber of the product memory — treat its styling as sacred.

## 6. Do's and Don'ts

### Do:
- **Do** keep every neutral at hue 60–70 (The Same-Hue Rule) and every accent moment terracotta (The One Voice Rule).
- **Do** hit WCAG AA: ≥4.5:1 body contrast (Ink on Paper is ~13:1; Stone is for metadata only), visible focus rings on every interactive element, full keyboard paths.
- **Do** keep transitions 150–250ms, state-driven, with `prefers-reduced-motion` alternatives.
- **Do** use skeletons for loading content and empty states that teach the interface.
- **Do** show provenance: sources, dates, and pending-write indicators are part of the component, not an afterthought.

### Don't:
- **Don't** build the generic AI-SaaS dashboard: no gradient accents, no hero metrics, no identical card grids, no purple-on-dark "AI product" styling.
- **Don't** slide into enterprise Jira grey: no cool-grey chrome, no cramped form-heavy screens, no walls of same-weight text.
- **Don't** put shadows on resting surfaces (The Floating-Only Rule) or use side-stripe borders (`border-left` > 1px) as card/callout accents.
- **Don't** use Fraunces anywhere interactive (The Serif Boundary Rule) or uppercase-tracked eyebrows as section scaffolding outside document content.
- **Don't** use gradient text, glassmorphism, decorative motion, or orchestrated page-load choreography — the PO is mid-task; the tool loads into work.
