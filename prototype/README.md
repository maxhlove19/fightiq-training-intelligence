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
- **3D technique breakdowns** — a looping, step-through player for four
  techniques (arm drag to back take, half guard underhook, round kick pivot,
  single leg finish). Bodies are built from joint angles and rendered as
  polygon meshes — limbs are tubes carried along the joint chain, the torso is
  an oval cross-section, the head an ellipsoid with a hair mask — lit with a
  key, a fill and a rim light, backface-culled and depth-sorted per face, in
  skin and kit colours with soft mat shadows. Steps interpolate through optional intermediate poses so a
  limb travels its real arc. The camera orbits: drag, or jump to Corner /
  Front / Side / Top / Behind. Each breakdown also carries a half-speed
  toggle, a wrong-versus-right toggle, a checkable drill list, and links to
  real footage.

## Conventions worth keeping

- **Self-contained.** No network requests at runtime. Both typefaces (Oswald,
  Newsreader) are inlined as `@font-face` data URIs because the artifact CSP
  blocks font CDNs. Never add an external stylesheet, script, or image.
- **Real video IDs only.** The YouTube links come from the curated catalog in
  `lib/video-recommendations.ts`. If you add a technique, either reuse an ID
  from that catalog or ship a search link instead of inventing one.
- **Scenes are data, not drawings.** A step is `{h, cap, cue, arrows}` plus a
  pose per actor. A pose is joint angles — `az` turns around the body's
  vertical (0 = the way it faces), `el` runs 0 straight down, 90 level, 180
  straight up — over a base (`KNEES`, `SUPINE`, `PRONE`, `CROUCH`). `footAzL`
  and `footAzR` pin a foot's direction when the pose depends on it, which is
  how the round kick shows its pivot on the model. A step may carry `via`
  poses for the movement to pass through. Arrows are 3D polylines in the same
  centimetre space. Adding a technique means adding
  data, not touching the renderer.
- **No 3D library.** The renderer is a couple of hundred lines: forward
  kinematics, a lookAt camera, tube and ellipsoid mesh builders, per-face
  Lambert plus rim lighting, backface culling and painter's-algorithm depth
  sorting. Keep it that way — a CDN import would be blocked by the artifact
  CSP anyway. It holds 60fps on a phone; if that changes, cut part count
  before reaching for WebGL.
- **The breakdowns are schematics and say so.** The page states plainly that the
  animation is drawn by FightIQ rather than footage of an athlete. Keep that
  line if you extend the player.
- **Scrolling flex columns** (`.view`, `.w-scroll`) set `flex:0 0 auto` on their
  children. Without it, children shrink below their content height and overlap
  the rows underneath.
