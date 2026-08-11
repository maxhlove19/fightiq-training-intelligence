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
- **The safety scan** — a miniature of `lib/safety-signals.ts`. Logging a note
  that describes a head knock shows the stop-training notice and holds the
  next-session recommendation, exactly as the app does. Keep the two in step:
  if the real scanner changes, this demo should change with it.
- **3D technique breakdowns** — a looping, step-through player for four
  techniques (arm drag to back take, half guard underhook, round kick pivot,
  single leg finish). Bodies are built from joint angles and rendered as
  polygon meshes with smooth per-vertex normals — limbs are tubes carried
  along the joint chain, the torso an oval cross-section, the head an
  ellipsoid with hair and brow masked in by normal. Shading is a warm key, a
  cool fill, a rim and a specular term per material (skin is glossier than
  cloth), backface-culled and depth-sorted per face, over a lit mat with
  light pools, soft contact shadows, film grain, a vignette and letterbox.
  Steps direct their own camera, the camera pushes in slowly and drifts like
  it's handheld, and each step can set its own speed and pass through
  intermediate poses. Every breakdown carries a half-speed toggle, a
  wrong-versus-right toggle, a promoted block of real footage with a
  what-to-look-for line, and a checkable drill list.

## Conventions worth keeping

- **Self-contained.** No network requests at runtime. Both typefaces (Oswald,
  Newsreader) are inlined as `@font-face` data URIs because the artifact CSP
  blocks font CDNs. Never add an external stylesheet, script, or image.
- **Real video IDs only.** The YouTube links come from the curated catalog in
  `lib/video-recommendations.ts`. If you add a technique, either reuse an ID
  from that catalog or ship a search link instead of inventing one. Never
  invent a timestamp or describe what happens inside a clip you have not
  watched — the `watchFor` line is coaching advice about the technique, not a
  claim about any particular video.
- **The page cannot embed a player.** A published artifact is sandboxed from
  external media, so footage opens on YouTube in a new tab. The production app
  has no such limit; if inline playback matters, it belongs there.
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

## House style

No em dashes. Not in the cover, not in the demo copy, not in the sample debrief
text. They are the clearest single tell that a machine wrote something, and the
first thing a reader notices. The app enforces the same rule in
`tests/copy-voice.test.mjs`.

## The cover

The problem goes first, before the product name: the reader has to recognise
themselves in the first line or nothing after it matters. The fighter is
embedded as a data URI because the artifact CSP blocks every external host, so
there is no other way to put a picture on the page. Four banner headlines carry
the rest, one idea each. The whole cover is under 400 words; it was 1,150, and
that was too long to read standing up.
