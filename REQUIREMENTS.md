# Holoball V2 Requirements

Status: draft, written before implementation starts
Last updated: 2026-08-23

## 1. Why this rebuild exists

The original Hologram app is a native macOS SwiftUI app. It opens the camera but the hologram ball does not behave correctly, and the gesture detection is unreliable and slow. A full read of the old source turned up four concrete reasons.

1. It is not a real Xcode project. The folder holds seven loose `.swift` files with no `.xcodeproj`, no `Package.swift`, and no build script. The app bundle sitting in `build/` was hand assembled by compiling with `swiftc` directly, so nobody can reliably rebuild it.
2. The compiled binary is x86_64 only. The machine it runs on is Apple Silicon, so every frame of camera capture, hand tracking, and 3D rendering has been going through Rosetta 2 translation. That alone explains a large part of "weak and slow."
3. The 3D layer may never have composited correctly over the camera layer. A screenshot saved during a previous debugging session, named for verifying the ball, came back completely black. There is no later screenshot proving it was ever fixed.
4. The README described a completely different app than the one that exists. It documents an audio based clap detector using the microphone. There is no microphone code anywhere in the project. The real implementation watches two hands come together on camera. Anyone trying an audible clap out of camera view would see nothing happen, which matches the reported symptom exactly.

V2 is a rewrite rather than a repair. The goal is an app that works, looks like the Iron Man reference images, detects claps far more accurately, and lives at a real URL instead of only running as a hand built binary on one laptop.

## 2. Goals

1. Gesture recognition that is materially more accurate than the old version, especially for the clap that opens and closes the hologram.
2. A complete visual redesign in the Tony Stark holographic style, built with the `hallmark` and `design-taste-frontend` design skills.
3. Real hosting. The app runs in a browser at a public URL, using the visitor's camera, instead of only running locally.
4. A written requirements document, this file.
5. Two READMEs. One private with the full build explanation, one public for the repository.

### Non-goals for v1

- Mobile browser support. Running camera capture, hand tracking, classifier inference, and WebGL bloom at the same time is a real performance risk on phones. Desktop first, revisit later.
- Multi user or networked sessions.
- Fixing single camera depth ambiguity. Two hands overlapping at certain angles is hard for any single lens setup. The old app had this limitation too. It is not a regression.

## 3. Reference visual language

Three reference images live in this folder. They are frames from the Iron Man films showing Tony Stark's lab.

- `ref_image_1.png`: a large translucent sphere made of triangulated wireframe, glowing cyan, with bright nodes at every vertex intersection. This is the primary target for the ball geometry.
- `ref_image_2.jpg`: a wall of floating glass panels with hex grids, circular gauges, and thin readouts, surrounding a rotating wireframe globe. Green accent particles are scattered through it. This is the target for the HUD and the optional floating panels.
- `ref_image_3.png`: a small cyan particle cluster assembling in mid air above an open hand, with tiny text labels floating beside it. This is the target for the spawn animation and the general glow quality.

Common threads across all three: very dark environment, cyan and blue as the dominant hue, light used sparingly so the glow reads as bright, thin technical linework rather than heavy solid shapes, and small precise text rather than large headings.

## 4. Tech stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Build tool | Vite | 8.2.2 | Fast dev server, static output, deploys to Vercel with no config |
| Language | TypeScript | latest | Gesture math benefits from types |
| HUD layer | React | 19.x | DOM and CSS overlay only, not the 3D scene |
| 3D | Three.js | 0.185.1 | WebGL rendering for the ball |
| State | Zustand | 5.0.15 | Closest analogue to the old `ObservableObject` |
| Hand tracking | `@mediapipe/tasks-vision` | 1.0.1 | 21 landmarks per hand, on device, no network |
| Classifier | `@tensorflow/tfjs` | 4.22.0 | Runs the custom trained gesture model in browser |
| Training | Python, TensorFlow, `tensorflowjs` | latest | Offline training and model export |
| Hosting | Vercel | n/a | Static build, HTTPS by default, real public URL |

### Why these and not the alternatives

**Why a web app instead of fixing the Mac app.** The complaint was that it only ever ran from a local camera pipeline on one machine. A browser app gets a public URL, works on any desktop with a webcam, needs no code signing or Rosetta, and removes the entire class of native view compositing bugs that likely broke the ball.

**Why MediaPipe instead of Roboflow.** Roboflow was worth considering, and it is genuinely good at what it does, which is training custom object detection models on labeled images. But a clap is not an object in a single frame, it is a motion over time. MediaPipe gives 21 tracked hand landmarks per frame for free, already trained, running on device with no network call. Roboflow's hosted inference API would add a network round trip on every frame, which makes the existing slowness worse rather than better. Roboflow could still be used to train a custom model, but for hand landmarks specifically MediaPipe is the stronger and simpler starting point.

**Why also train a custom classifier on top.** Pure threshold logic on hand distance works, and the old app already did it, but it false fires on things that look geometrically like a clap and are not, such as a wave or hands passing each other. A small classifier trained on real recorded clips learns the difference. It runs as a confirmation layer, described in section 8.

**Why React only for the HUD.** The 3D render loop runs at 60fps and eases values every frame. Pushing those values through React state would cause either a re-render storm or stale reads. The old app made the same split deliberately, with `@Published` fields for the HUD and plain fields for the render loop. That split is preserved here.

## 5. Architecture

Three stacked layers in the browser, same conceptual structure as the old app.

```
┌─────────────────────────────────────────┐
│ HUD overlay (React, DOM + CSS)          │  pointer-events: none
├─────────────────────────────────────────┤
│ Ball canvas (Three.js, transparent)     │  alpha: true, clear alpha 0
├─────────────────────────────────────────┤
│ Camera feed (<video>, mirrored)         │  getUserMedia
└─────────────────────────────────────────┘
```

Data flow per frame:

```
<video> frame
   → HandLandmarker.detectForVideo()        (MediaPipe, 21 pts × up to 2 hands)
   → handGeometry: palm centers, separation, pinch, fist
   → clapDetector: threshold + velocity + debounce  → clap candidate
        → gestureClassifier (TFJS)          only on candidates, not every frame
        → confirmed clap → stateMachine.triggerHandClap()
   → runtime state (plain object, high frequency fields)
   → Three.js render loop reads state, eases ball position/scale/colour
   → Zustand store (low frequency fields) → React HUD re-renders
```

### File layout

```
Holoball_v2/
  REQUIREMENTS.md
  README.md                       public, committed
  README.private.md               private, gitignored
  ref_image_*.png/.jpg            design references
  public/
    models/hand_landmarker.task           self hosted MediaPipe model
    models/clap-classifier/               exported TFJS model
    wasm/                                 self hosted MediaPipe WASM
  src/
    main.tsx, App.tsx
    state/    types.ts, hologramStore.ts, stateMachine.ts
    vision/   handLandmarker.ts, handGeometry.ts, clapDetector.ts,
              gestureClassifier.ts, cameraController.ts
    three/    hologramScene.ts, hologramBall.ts, worldMapping.ts, hudPanels3d.ts
    hud/      HUDOverlay.tsx + subcomponents, tokens.ts
    dev/      RecordRoute.tsx              dataset collection mode
  training/                               not part of the web bundle
    record_export/, train.py, convert_to_tfjs.py, requirements.txt
```

## 6. State machine

Four modes, ported directly from the old `HologramState.swift`.

| Mode | Meaning | Enters from | Leaves to |
|---|---|---|---|
| `hidden` | Nothing on screen, waiting for summon | start, or after `trapped` finishes | `spawning` on a confirmed double clap |
| `spawning` | Ball easing into existence | `hidden` | `active` after 0.45s |
| `active` | Ball visible and hand controlled | `spawning` | `trapped` on a single clap |
| `trapped` | Squash and crush dismiss animation | `active` | `hidden` after 0.42s |

Timing constants, all carried over from the old app as starting points:

| Constant | Value | Meaning |
|---|---|---|
| `doubleClapWindow` | 1.5 s | Max gap between the two summon claps |
| `spawnDuration` | 0.45 s | Spawn ease in |
| `trapDuration` | 0.42 s | Dismiss animation |

The summon requires two claps because a single clap is too easy to trigger by accident. Dismissal is a single clap because at that point the ball is already visible and the user's intent is unambiguous.

## 7. Gesture vocabulary

| Gesture | Detected by | Effect |
|---|---|---|
| Two claps within 1.5s while hidden | Both palms converging, confirmed by classifier | Summon the ball |
| One clap while active | Same detector | Dismiss the ball with a crush animation |
| Open palm moving | Palm centre position, smoothed | Ball follows the hand |
| Thumb to index pinch | Distance between landmarks 4 and 8 | Ball scales down as fingers close |
| Closed fist | Fingertip curl relative to knuckles | Ball charges up, colour shifts cyan to orange |

Tunable constants, carried over as starting values and expected to be retuned against MediaPipe's coordinate space:

| Constant | Value | Meaning |
|---|---|---|
| `clapOpenThreshold` | 0.55 | Hands must spread past this to arm a clap |
| `clapCloseThreshold` | 0.42 | Hands closing past this fires the clap |
| `clapClosingVelocity` | 2.0 /s | Alternative fast close trigger |
| `clapDebounce` | 0.32 s | Minimum gap between two registered claps |
| `palmSmoothing` | 0.4 | Exponential smoothing on palm position |
| `pinchSmoothing` | 0.35 | Exponential smoothing on pinch distance |
| `pinchMinDistance` | 0.05 | Fully pinched |
| `pinchMaxDistance` | 0.32 | Fully open |
| `scaleMapping` | `0.5 + norm * 2.6` | Pinch to ball scale curve |
| `powerRamp` | 0.15 /frame | Fist charge ease rate |

Note on mirroring: the camera preview is mirrored so it feels like a mirror, which is standard for webcam UI. The landmark to world space mapping flips the x axis to compensate. The old app deliberately did not mirror, so this is an intentional difference and any position mapping bug should check this first.

## 8. Hand tracking and clap detection

### MediaPipe landmark mapping

MediaPipe returns a fixed 21 point topology per hand. The old app used Apple Vision's named joints. The mapping:

| Purpose | MediaPipe index |
|---|---|
| Wrist | 0 |
| Thumb tip | 4 |
| Index MCP / tip | 5 / 8 |
| Middle MCP / tip | 9 / 12 |
| Ring MCP / tip | 13 / 16 |
| Little MCP / tip | 17 / 20 |

Palm centre is the average of the wrist and the four MCP knuckles. Separation between two palms is Euclidean distance with an aspect ratio correction on x, since normalized coordinates are not square.

### Detection algorithm

Ported from `CameraManager.swift`, kept as the fast first pass:

```
each frame:
  if two hands present:
    spread = separation(palmA, palmB)      aspect corrected, smoothed
    if spread > clapOpenThreshold: armed = true
    closingFast = (lastSpread - spread) / dt > clapClosingVelocity
    closedFromArmed = armed and spread < clapCloseThreshold
    if (closedFromArmed or closingFast) and now - lastClap > clapDebounce:
      emit clap candidate; armed = false
  else if hands dropped below 2:
    # motion blur during a fast clap often loses tracking mid motion
    if armed and lastSpread < clapOpenThreshold * 0.85
       and now - lastTwoHandTime < 0.5
       and now - lastClap > clapDebounce:
      emit clap candidate
```

The dropped tracking fallback matters. Fast claps blur, hands overlap, and the tracker loses one or both. Without this branch the fastest and most deliberate claps are exactly the ones that fail to register.

Hands are sorted by x position each frame for stable left and right slots, because tracking order is not guaranteed frame to frame. MediaPipe also returns a handedness label which may be more robust, but it can read inverted depending on mirroring, so it is a refinement to validate rather than a requirement.

## 9. Custom gesture classifier

### The problem it solves

Threshold logic asks "did these two points get close quickly." Plenty of non clap motions satisfy that. The classifier asks "does this motion look like the claps I was trained on."

### Architecture: confirmation layer, not replacement

The geometric detector stays as the first pass because it is instant and already tuned. When it proposes a clap candidate, the trailing landmark buffer runs through the classifier, and the clap only fires if confidence clears a threshold. This means inference runs on candidate events, not every frame, which protects the frame budget.

### Data collection

`src/dev/RecordRoute.tsx` is a development only mode that runs the exact same MediaPipe pipeline as production. This matters: recording with a different pipeline than inference is the fastest way to build a model that scores well in training and fails live.

Each clip is a fixed window of roughly 20 frames, about 600ms at 30fps, capturing 2 hands × 21 landmarks × 3 coordinates. Clips are labeled on save and downloaded as JSON into `training/record_export/`.

| Label | Target count | What to record |
|---|---|---|
| `clap` | 60 to 100 | Real claps. Vary speed, distance from camera, lighting, starting hand positions |
| `near_miss` | 50 to 80 | Hands coming close but not clapping |
| `wave` | 40 to 60 | Waving, which geometrically resembles a fast approach |
| `rest` | 30 to 50 | Hands visible and still |
| `other_gesture` | 30 to 60 | Pointing, pinching, fists, anything else |

Roughly 200 to 350 clips total. The negatives outnumber the positives on purpose. The failure mode that actually hurts is a false positive on ordinary hand movement, not a missed clap against a blank background.

### Features and training

Raw landmark sequences are a poor fit for a model trained on a few hundred clips. Instead, each frame is normalized by recentering on the midpoint between the wrists and scaling by an estimated hand size reference, then the same engineered signals the geometric detector already computes, which are spread, closing velocity, pinch distance, and fist curl score, are collected across the window. Feeding these inherits the signal engineering that is already validated rather than asking a small network to rediscover it.

Training runs in `training/train.py` with Keras, using a small dense or 1D convolutional network, a train and validation split, and heavy augmentation given the small dataset: time jitter on the window start, left right mirroring, and coordinate noise. `training/convert_to_tfjs.py` runs the `tensorflowjs_converter` to produce `model.json` plus weight shards into `public/models/clap-classifier/`.

Expect at least one iteration. Record, train, test live, notice which class produces errors, record more of that class, retrain.

## 10. Ball visual specification

Mapping from the old SceneKit implementation to Three.js:

| Old part | New implementation | Notes |
|---|---|---|
| Core sphere | `SphereGeometry` + `MeshPhysicalMaterial` | Emissive cyan, metalness 0.85, roughness 0.18 |
| Glow shell | Slightly larger additive blended sphere | Shapes close in glow that bloom alone cannot |
| 2 wireframe shells | `IcosahedronGeometry` → `WireframeGeometry` → `Line2` | Icosahedron gives the triangulated look from ref_image_1, not the quad grid a UV sphere produces |
| Glowing nodes | `Points` at icosphere vertices, `CanvasTexture` sprite | The bright intersections in the reference |
| 3 gyroscope rings | 3× `TorusGeometry`, staggered radii and axes | Different rotation rate each |
| 1200 particle cloud | `Points` + `BufferGeometry`, additive | Spherical shell random sampling |
| HDR bloom camera | `EffectComposer` + `UnrealBloomPass` + `OutputPass` | Renderer set to ACES filmic tone mapping, sRGB colour space |

Line width note: WebGL ignores `LineBasicMaterial.linewidth` on most platforms. Thick glowing lines need the fat line helpers from `three/examples/jsm/lines/`.

Colour state blends cyan to orange by the `powerMode` value, applied to core, glow, shells, particles, rings, and the key light. During `trapped` it is forced toward orange.

Animation curves, ported directly:

- Spawning: ease `1 - (1 - p)^3` over 0.45s
- Active: position `+= (target - current) * 0.22`, scale `* 0.18` per frame
- Trapped: x squash `1 - p * 0.75`, y stretch `1 + p * 0.35`, z `1 + p * 0.2` over 0.42s, riding the hand midpoint

### Compositing

The old app's likely fatal bug was a transparent native view failing to composite over the camera layer. The web version avoids that entire class of problem with two ordinary DOM elements stacked by CSS. The renderer is constructed with `alpha: true` and `setClearColor(0x000000, 0)`. This still needs explicit verification as its own step, because `premultipliedAlpha` and clear colour settings can reintroduce a black background in a new form.

## 11. HUD specification

The old HUD was genuinely well designed and is not the "AI slop" part of the project. Its restraint is worth carrying forward even though the visual execution is being redone: a small fixed palette, hairline strokes instead of glow everywhere, technical typography, camera style registration marks in the corners, and live numeric readouts.

Palette tokens carried forward:

| Token | Hex | Use |
|---|---|---|
| `void` | `#05080B` | Background, panel fills |
| `phosphor` | `#7FE8DE` | Live values, active state |
| `blueprint` | `#C9D8DE` | Structural lines, labels |
| `amber` | `#FF9B4D` | Power mode, warnings |
| `dim` | `#3A4750` | Idle, inactive |

Typography needs a substitution. The old app used DIN Condensed Bold and Menlo, both macOS system fonts that are not licensed for web use. Replacements should be a real condensed grotesk for labels and an open monospace for telemetry, self hosted via `@fontsource`. Generic sci-fi display faces such as Orbitron are explicitly out, they read as costume rather than instrument.

Component inventory to build: title block, sheet stamp with clock, status column, telemetry block, caliper style readout for live spread and pinch values, and corner registration marks.

The HUD is a full screen non interactive overlay with `pointer-events: none`, mirroring the old `.allowsHitTesting(false)`.

### How the design skills get used

This is a build step, not a styling note. After the pipeline works end to end with placeholder debug text:

1. Invoke `hallmark` with the three reference images and a written brief covering the palette tokens, the component inventory, the font constraint, and the fact that the HUD is a live overlay bound to real state rather than a static mockup. `hallmark` handles design extraction from screenshots, which is exactly the task.
2. Run `design-taste-frontend` as a second audit pass over the result, since it is audit first on redesigns, to catch anything that still reads as templated.

Do not hand roll the HUD first and polish it afterward. The skills generate the component structure and CSS.

## 12. Deployment

Vercel, as a static single page app. `vite build` produces the output, and there is no backend because camera access, hand tracking, classifier inference, and rendering all run client side.

Requirements and constraints:

- HTTPS is mandatory. `getUserMedia` does not work on a non localhost origin without it. Vercel provides this by default.
- The MediaPipe `.task` model and WASM fileset are self hosted under `public/` rather than pulled from Google's CDN, for reliability and to avoid first load latency on an external dependency.
- Camera permission denial needs real UX, not a silent failure.
- Browser support: Chrome first. MediaPipe's GPU delegate and WASM behaviour differ meaningfully in Safari, so a CPU delegate fallback path is required and needs real testing.

GitHub setup uses the already authenticated `gh` CLI. Connecting the repository to Vercel is a one time dashboard click through that only the account owner can do.

## 13. Milestones

| ID | Work | Verification gate |
|---|---|---|
| M0 | Vite + TS + React scaffold, GitHub repo | Builds and runs |
| M1 | Camera + MediaPipe landmarks, debug dots | Two hands tracked reliably at 24fps or better |
| M2 | Geometric clap detection, debug readouts | Real claps register at varying speed and distance |
| M3 | State machine on a CSS placeholder | Full mode cycle works before touching 3D |
| M4 | Three.js ball in isolation | Visually matches reference images |
| M5 | Full pipeline wiring, ball over video | Alpha compositing verified, no black background |
| M6 | HUD via `hallmark` then `design-taste-frontend` | Replaces debug text, reads as designed not templated |
| M7 | Dataset collection via RecordRoute | 200 to 350 labeled clips across sessions |
| M8 | Classifier training and integration | Measurably fewer false positives than M2 baseline |
| M9 | Polish, optional 3D panels, perf profiling | Holds frame rate with everything running |
| M10 | Deploy hardening, both READMEs | Live URL works on a clean machine |

## 14. Risks and open questions

**Small training dataset.** A few hundred clips recorded by one person in one room risks a model that only knows those hands and that lighting. Mitigated by heavy augmentation, by keeping the classifier as a confirmation layer rather than the sole detector, and by planning for a second recording round.

**Performance budget.** Hand landmark inference, occasional classifier inference, and WebGL rendering with bloom all compete for the same thread and GPU. Profile at M1 and M4, not after everything is wired together. If the main thread janks, hand tracking moves to a Web Worker.

**Cross browser behaviour.** Safari's WASM and GPU delegate handling differs from Chrome's. Needs real testing, not an assumption.

**Font licensing.** Resolved by substituting open webfonts, but worth restating so the design skills do not default to a generic sci-fi face.

**Threshold retuning.** The ported constants come from Apple Vision's coordinate space. MediaPipe's normalized coordinates are similar but not identical, so every threshold in section 7 should be treated as a starting point to verify at M2, not a final value.

**Carried over limitation.** Two hands overlapping at certain angles confuses any single camera setup. This existed in the old app and is not something this rewrite fixes.
