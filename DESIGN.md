# DESIGN.md

The decisions, so they live in a file rather than in somebody's memory.

Impeccable's detectors read this for context, and `scripts/design-check.mjs`
runs them in the gate. Everything here is meant to be checkable rather than
tasteful.

---

## The accent colour is `#087cff`

There are currently four `:root` blocks in `app/globals.css`, appended over time
rather than reconciled, and twelve custom properties are declared more than once.
`--blue` is declared three times: `#087cff`, then `#006dff`, then `#08c8df`. The
last one wins, so **the blue token currently resolves to a cyan**, and the app
renders pure blue and cyan on the same screen at the same time depending on which
rule wins where.

Verify with `node scripts/token-check.mjs`.

`#087cff` is the accent because it is the original declaration, it is the most
frequent literal in the stylesheet, and blue is what the app looks like in every
screenshot of it. The cyan is an appended theme that nobody deleted.

`--blue-bright: #49a1ff` is the same decision applied to the lighter pair.

## The nav height is `70px`

`--nav-height` is declared three times as `86px`, `72px` and `70px`, with ten
rules reading it. Unlike colour this is load-bearing geometry: the bottom
navigation, the app frame's padding and every screen that sizes itself against
the space above the nav all read it.

**70px, because that is the value currently winning**, so collapsing the
declarations changes nothing visually. Any future change to the number then
becomes a deliberate decision rather than a side effect of deleting a block.

## The rest of the collapse

When the four `:root` blocks become one, take the last winning value for every
duplicated property for the same reason: the reconciliation should be invisible,
and the argument about whether a value is right should happen separately from the
argument about how many times it is declared.

The duplicated properties are `--canvas`, `--line`, `--line-soft`, `--surface`,
`--surface-2` (four declarations each), `--blue`, `--blue-bright`, `--blue-wash`,
`--nav-height` (three each), and `--ink`, `--muted`, `--muted-2` (two each).

---

## Type scale

Defined in `:root` and used by everything written after they existed. The sizes
that predate them are deliberately untouched: snapping two hundred hand-picked
values onto a grid would redesign screens nobody asked to have redesigned.

| Token | Size | For |
| --- | --- | --- |
| `--text-2xs` | 7px | Mono eyebrows and labels |
| `--text-xs` | 9px | Secondary labels |
| `--text-sm` | 11px | Body detail, counts |
| `--text-base` | 13px | Body |
| `--text-md` | 15px | Card headings |
| `--text-lg` | 19px | Screen headings |
| `--text-xl` | 24px | The one number on a screen that matters |

## Spacing

One 4px step: `--space-1` through `--space-6` (4, 8, 12, 16, 24, 32). Spacing
that is a multiple of something reads as deliberate. Spacing that is 13px here
and 9px there reads as whatever fitted.

## Motion

`--motion-fast` 90ms for a control acknowledging a press, `--motion-base` 180ms
for something moving into place, `--motion-slow` 280ms for something arriving
from off screen. `--ease-out` for all of it. Every one is switched off under
`prefers-reduced-motion`.

Motion explains or it does not happen. Nothing here is decoration.

## Interaction states

Every interactive element has a visible focus ring (`--focus-ring`), a pressed
state, a disabled state and a busy state. These live inside `:where()`, which has
zero specificity, so they are a floor that any existing rule overrides rather
than an override that fights existing design.

This mattered: before they existed, the entire stylesheet contained one `:active`
rule, and the focus ring was a hardcoded list of twelve selectors, so every
control added after that list was written had no visible focus at all.

---

## Prohibitions

Named rules rather than a list of lines to fix, because the point is that they
stop being written rather than that ten of them get cleaned up.

**No thick coloured border on one side of a card.** `border-left: 2px solid
<accent>` is the single most recognisable tell of AI-generated interface, and
there are ten of them in this stylesheet today. Where a side tab is genuinely
carrying meaning, such as marking a live item against a finished one, the
meaning has to be carried by weight, a mark, or the background instead.

**No grey text on a coloured background.**

**No pure black or untinted grey.** Every neutral in this app is tinted toward
the canvas.

**No card wrapping everything, and never a card inside a card.**

**No overused default typeface.** Not Inter, not the system stack by default.

**Nothing that animates layout.** Animate `transform` and `opacity`. Animating
width, height, padding or margin causes layout thrash, and there is one of those
in the stylesheet today.

## Anti-patterns, from the detectors

`node scripts/design-check.mjs` runs Impeccable's deterministic rules. There are
**11 findings today** and the gate holds that as a baseline, failing only if the
count grows. A gate that failed on all of them from the first run would block
every session on work that is already scheduled, and a gate that blocks
everything gets switched off.

**Ten of the eleven are the same thing:** `border-left: 2px solid <accent>`,
which the detector calls the most recognisable tell of AI-generated UI. It is
correct, and it is worth being specific about how it got here: some of those
lines were written the same night this gate was added. The pattern is in the
focus history rows, the coach finding card, the brief rail and the unsent note.

Fixing it is a design decision rather than a find-and-replace. The side tab is
doing real work in some of those places, marking a live item against a dead one.
The replacement needs to carry that meaning some other way, through weight, a
mark, or the background, and that is a job to do deliberately.

The eleventh is `transition: width`, which animates layout rather than
`transform` or `opacity`.

### Not yet covered

The detectors read CSS and HTML. They do not parse TSX, so `app/components`
contributes nothing to the count today. Real coverage of rendered components
means a URL scan against a running app, which is a follow-up rather than
something the gate can do offline.

---

## Measured, not asserted

Two scripts exist so that "this looks cheap" is a number rather than an opinion.

`scripts/layout-sweep.mjs` renders the app's screens against its own compiled
stylesheet in headless Chromium, fails if any element escapes the app frame, and
counts distinct saturated colours per screen. The union across the four screens
is currently around 20 on fixture data; a signed-in session with real data
measured 23 on Home alone, nine of which were near-identical blues differing by
as little as two points.

Once the `:root` collapse lands, set a per-screen ceiling in that script at the
honest number and let it fail on drift.

`scripts/token-check.mjs` fails when a custom property is declared more than
once. It is the check that would have prevented all of the above.
