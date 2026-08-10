# FightIQ prototype page

`fightiq-prototype.html` is the standalone, self-contained page published as the
FightIQ artifact. It is a pitch cover plus a clickable demo of the product — not
part of the Next.js app in `app/`, and it shares no code with it.

Open it directly in a browser; there is no build step.

## What's in it

- **Cover** — what FightIQ is, the log → read → see-it loop, the five app
  surfaces, a diagram of how one correction becomes two study layers, and an
  honest list of what is and isn't real in the demo.
- **Demo** — the phone: welcome screen, Home, Train (log → analysis), Learn,
  Performance, Profile.
- **Technique breakdowns** — a looping, step-through motion player for four
  techniques (arm drag to back take, half guard underhook, round kick pivot,
  single leg finish), with a half-speed toggle. Grappling uses a top-down map
  where two figures move with labelled arrows and a dashed ghost of the previous
  position; the round kick uses a side view with an articulated figure and an
  inset showing the support foot from above. Every breakdown carries a
  wrong-versus-right toggle, a checkable drill list, and links to real footage.

## Conventions worth keeping

- **Self-contained.** No network requests at runtime. Both typefaces (Oswald,
  Newsreader) are inlined as `@font-face` data URIs because the artifact CSP
  blocks font CDNs. Never add an external stylesheet, script, or image.
- **Real video IDs only.** The YouTube links come from the curated catalog in
  `lib/video-recommendations.ts`. If you add a technique, either reuse an ID
  from that catalog or ship a search link instead of inventing one.
- **Scenes are data, not hand-drawn paths.** A step is `{h, cap, cue, arrows}`
  plus either two top-down actors (`you`/`them`) or one side-view `fig`. Adding
  a technique means adding data, not touching the renderer.
- **The breakdowns are schematics and say so.** The page states plainly that the
  animation is drawn by FightIQ rather than footage of an athlete. Keep that
  line if you extend the player.
- **Scrolling flex columns** (`.view`, `.w-scroll`) set `flex:0 0 auto` on their
  children. Without it, children shrink below their content height and overlap
  the rows underneath.
