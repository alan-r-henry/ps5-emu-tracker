# PS5 Emulation Tracker: design

Planning notes for the redesign, written with the `/awwwards` method (brief, concept, system), so later
changes stay consistent.

## Brief

- **Subject:** a daily tracker of three open-source projects (AnyPS5, KytyPS5, SharpEmu) that are teaching
  PCs to run PS5 games, with GTA 6 readiness, the games that already run, and the people doing the work.
- **Audience:** PC gamers and emulation followers who want a straight answer ("can I play X yet?", "how
  close is GTA 6?"), plus the projects' own contributors.
- **Job:** answer those questions in under 3 seconds, keep people coming back as numbers move, and send
  search traffic to the per-game pages.
- **Constraints kept from the existing site:** Angular, GitHub Pages, a strict Content Security Policy
  (no inline scripts or styles, Trusted Types, SRI), no third-party scripts, self-hosted fonts, light
  and dark themes, the crawler-readable summary and the static game pages written by `seo.py`.
- **Scale of theatre:** a data site, not a launch microsite. No loader, no WebGL, no scroll-jacking.
  The craft goes into type, layout, one signature and consistent feedback.

## Concepts

| | A. Registration (process of emulation) | B. The boot ladder (formal system) | C. Vice City clock (place and culture) |
|---|---|---|---|
| Idea | Every headline is printed as plates, like a print run: the PS5 is the black key plate and each emulator is a colour plate, sitting out of register by exactly how far it still has to go | The page is one ladder with the five rungs every game climbs (no boot, logo, menus, in-game, playable); sections and games sit on their rung | GTA 6's release date drives the page: its palette moves from dusk toward neon as November 19 nears |
| Anchor | Emulation means reproducing an original exactly; each project's real progress figure | The compatibility stages every list on the site already uses | GTA 6's PS5 date, the question most visitors arrive with |
| Layout | Four-corner sheet with registration marks; figures set as overprinted plates | A rail of rungs down the left edge, content hung from it | Full-bleed bands that change colour by date |
| Motion verb | slide into register | climb, one rung at a time | fade like a sunset |
| Signature | The hero's CMY plates of "PS5" slide toward the key plate and stop at each project's real gap | The rail lights the rung you're reading | The sky colour ticks with the countdown |
| Screenshot | A huge "PS5" with three colour plates visibly off register, a caption naming each gap | A long ladder with games stacked on rungs | A neon band with "30 days" |
| O / F / Fe / P | 4 / 5 / 4 / 2 | 3 / 4 / 3 / 3 | 3 / 3 / 4 / 3, and close to Rockstar's branding |

**Pick A.** It's the only one that says what emulation is (making a copy match the original), it turns
every real number into something you can see, and it gives a complete rule system: plates, registration
marks, overprint colour, a press-sheet frame. Stolen from B for the 404: "This page doesn't boot".

## Revision: data first, no off-register effects

After review, the off-register device was dropped everywhere. Showing progress as how far a colour copy of
"PS5" sat off register made people read the caption before the page made sense, and the colour fringes looked
like a rendering fault rather than a print. What stayed from concept A is the press-sheet frame (proof paper,
hairlines, registration marks) and one colour per emulator. What changed:

- **Hero:** the title, statement and games link on the left; on the right, one plain meter per emulator (name,
  big percentage, a bar in its colour, and what the figure measures). The bar is a `<meter>`, so the static
  hero `seo.py` writes can draw it exactly under the CSP, which forbids inline styles.
- **Figures** (project cards, GTA 6 score, game page titles, the 404) are set in plain ink, with no colour copy.
- **Hovers** no longer slide offset shadows into place: buttons fill with ink, the call to action turns
  accent, nav links draw an underline, game tiles ink their border. Floating UI uses a soft shadow.
- **Footer:** the "PS5 in register" finale is gone; the footer is just the sources and site links.

A later polish pass (Emil Kowalski's design-engineering rules, Impeccable's polish and craft floor,
Taste's list of generated-page tells) removed the remaining print ornament: the crosshair marks on the hero
corners and section headings, and the tiny uppercase labels, now sentence case. Pressable controls scale to
0.97 on press; UI transitions stay at 200 ms or less and animate transform, opacity or colour only; hovers
apply only with a fine pointer; the live dot pulses only while a refresh runs; the menu and fund dialog fade
in with `@starting-style`.

Type then dropped to two sizes: `--t-body` (1rem) for all text, and `--t-bold` (1.5rem) for bold headings
and headline figures (page and section titles, card names, percentages, counts). Weight, not size, separates
a page title from a section title; labels, buttons and table text stay at body size. The games index
shows each game's cover thumbnail (initials when a game has no cover art), its ratings, release year and test
date, and offers the tracker's sort options through `games.js`; without JavaScript it stays A to Z.

Each game page lists that game's status on every emulator (from `game_details.json`, which the collector writes
and `seo.py` reads at build time and then deletes), its recent test reports, and its engine and genre. `gta-6/`
answers "can you play GTA 6 on PC" from the day's data. Its readiness score includes a "Can be copied from a PS5"
milestone, kept by hand in `data/gta_status.json` because no compatibility list tracks it; every claim there is
sourced and marked as reported where Rockstar or Sony haven't confirmed it.

The sections below are the original plan; where they mention plates sliding into register, this revision
replaces them.

## Concept card

```
Idea:        Each emulator is a colour plate printed over the PS5's black key plate; the further it has to
             go, the further out of register it sits.
Metaphor:    a four-colour print run (CMYK): the console is K, the emulators are C, M and Y.
Signature:   the hero "PS5" plates slide in from far out and stop at each project's real gap; the
             footer prints "PS5" in perfect register, captioned as what a finished emulator would print.
Emotion:     precise, technical and a little hopeful; you can see how far there is to go.
Motion verb: slide into register.
Screenshot:  the hero sheet, with three colour plates of "PS5" off register and registration marks in
             the corners.
```

## Art direction system

### Palette

Light ("proof", plates multiply on paper):

| Role | Value | Notes |
|---|---|---|
| ground (paper) | `#eef0ef` | cool proof paper, not cream |
| panel | `#f8f9f8` | a sheet lying on the paper |
| ink (K plate) | `#0d0e10` | text and the PS5's key plate |
| muted | `#4f545b` | 7:1 on ground |
| line | `#cdd1d0` | hairlines |
| cyan plate (AnyPS5) | `#00a0d2` | lines and fills; text uses ink |
| magenta plate (KytyPS5) | `#e0007a` | |
| yellow plate (SharpEmu) | `#f2c500` fills, `#9a7a00` lines and text | yellow is the weakest ink, as on press |
| accent (links, focus) | `#b8006a` | magenta darkened for 5.8:1 on paper |

Dark ("screen", plates add like light on a monitor): ground `#0b0c0e`, panel `#121418`, ink `#eceeee`,
muted `#a0a6ad`, line `#272b31`, cyan `#22c3ff`, magenta `#ff3aa6`, yellow `#ffd84a`, accent `#ff79c6`.
Plates use `mix-blend-mode: multiply` on paper and `screen` on dark, so where all three meet you get the
key colour, as in print.

The compatibility-stage colours (8 distinct hues for the stacked bars) stay: they're a data encoding, not
decoration, and they need to be told apart.

### Type

One family, Archivo (variable: width 62 to 125, weight 100 to 900, OFL, self-hosted from Fontsource), with
width as the second voice:

- **Display:** Archivo, width 125, weight 800, tracking from -0.02em to -0.05em as size grows, leading 0.86.
- **Text:** Archivo, width 100, weight 400 / 500 / 600, 16 to 17 px, leading 1.5.
- **Figures and labels:** Archivo, width 88, weight 500 to 600, tabular figures. No monospace face.

Scale (fluid): mega `clamp(6rem, 2rem + 20vw, 21rem)`, xl `clamp(2.6rem, 1.4rem + 4.6vw, 5.5rem)`,
l `clamp(1.9rem, 1.4rem + 1.8vw, 3rem)`, m `clamp(1.2rem, 1.1rem + 0.5vw, 1.5rem)`, body 1rem to 1.0625rem,
s 0.875rem, xs 0.75rem.

### Grid and rhythm

- 12 columns, gutter `clamp(16px, 2vw, 28px)`, content up to 1440 px. Text hangs from columns 1, 5 and 9.
- Section spacing varies on purpose: tight (sections that continue a thought), normal, and airy before
  the hero, GTA 6 and the footer.

### Shape

Sheets, not cards: 2 px radius everywhere, hairline borders, no drop shadows except on floating UI
(dialog, tooltips, menu).

### Motion language

- Ease `cubic-bezier(0.16, 1, 0.3, 1)` (expo out) for everything; 0.35 s for hovers, 1.1 s for plates.
- **Slide into register** is the only verb: a colour copy offset from its key slides onto it.
- Primary targets (game tiles, the games link, the fund button, nav): the colour edge sits off register at
  rest and registers on hover and focus. Utility links only change colour or underline.
- Idle: the hero plates drift by a fraction of a pixel, like a press running. Paused off screen, still
  under reduced motion.
- Reduced motion: plates sit at their real gaps with no slide, no idle drift, no view transitions.

### Composition plan

```
TOP BAR  [⊕ PS5 Emulation Tracker]            [Emulators GTA 6 Games People FAQ]  [Fund] [◐]
HERO     ┌⊕──────────────────────────────────────────────────────────────────────⊕┐
(poster) │ P S 5   (K plate, mega; C/M/Y plates off register)   │ statement, t-m  │
         │                                                        │ live line       │
         │ C AnyPS5 70%   M KytyPS5 56%   Y SharpEmu 43%          │ [Browse games]  │
         └⊕──────── GTA 6 ships on PS5 in 30 days ─────────── updated 2 min ago ───⊕┘
PROJECTS three columns split by hairlines (data / facts), plate-coloured figure at top
GTA 6    statement: huge "31%" with one plate off register; milestones as a checklist column
ROAD     asymmetric pair: bars on 8 columns, projected finish on 4
ACTIVITY three small charts in a row
GAMES    line chart (7 cols) + stacked ladder (5 cols)
PLAYABLE gallery wall of tiles per project, toolbar above
PEOPLE   index lists, three columns
OTHERS   table
FAQ      two columns: questions (7) and method (5)
FOOTER   finale: "PS5" printed in register, caption, sources
```

### Decisions

Made while building and testing:

- **Hero measures:** AnyPS5 by system functions implemented; KytyPS5 and SharpEmu by the share of their
  tested games at their top tier. Each meter says what it measures.
- **Static hero:** `seo.py` writes the top bar and hero into the HTML so the hero is the first paint (mobile
  LCP went from 2.7 s to 1.8 s on a throttled phone). Meter colours come from `.series-N` classes there.
- **Lines vs fills:** cyan fills use `#00a0d2`, but lines and marks use `#007fa8`, since plate cyan is only
  2.6:1 on paper.
- **Removed in the "one accessory" pass:** the GitHub icon's tilt on hover; it wasn't the motion verb.

- The page is a single long page plus static game pages, so "page transitions" are the browser's
  cross-document view transitions (home to game page and back), off under reduced motion.
- The idle drift lives only on the hero plates; the rest of the page stays still at rest, and its hovers
  carry the life.
- Section headings drop their icons; registration marks (⊕) are the only ornament, and only where a
  printer would put them (sheet corners, section starts).
