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
2. A complete visual redesign in the Tony Stark holographic style.
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
   → bloomDetector  (hidden only): fist held, then opened  → triggerSummon()
   → squashDetector (active only): palms converging, no contact → triggerDismiss()
   → clapDetector: spread and closing speed, for telemetry and the recorder
        → gestureClassifier (TFJS)          recorder pipeline only, not live
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
| `hidden` | Nothing on screen, waiting for summon | start, or after `trapped` finishes | `spawning` when a held fist opens |
| `spawning` | Ball easing into existence | `hidden` | `active` after 0.45s |
| `active` | Ball visible and hand controlled | `spawning` | `trapped` when two palms converge |
| `trapped` | Squash and crush dismiss animation | `active` | `hidden` after 0.42s |

Timing constants, all carried over from the old app as starting points:

| Constant | Value | Meaning |
|---|---|---|
| `spawnDuration` | 0.40 s | Materialise, staged |
| `trapDuration` | 0.30 s | Implosion and shockwave |

**The summon and dismiss animations are staged rather than uniform.** A single
fade over the same duration reads as the ball merely becoming less transparent.
Materialising runs the particle cloud inward first, snaps the wireframe skeleton
on next, and skins the solid core over last, with the rings sweeping out and a
glow flash peaking as the ball arrives. Scale uses an ease-out with a small
overshoot, which is what makes it read as snappy rather than just quick.

Both are driven by time alone. An earlier version ratcheted the bloom against
live hand openness so the ball would follow your fingers, but the hand finishes
opening about 100ms after the trigger fires, which drove the animation to full
in roughly three frames. Responsiveness comes from the trigger firing promptly,
not from the ball chasing finger position. **The dismiss is a uniform implosion, not a squash.** It scales one number, so
distortion is impossible by construction rather than by tuning. The previous
version squashed along the palm axis and bulged across it, reaching a 1.4 aspect
ratio on the way down and then spending a single frame at 72:1 as a vertical
line, because the across axis was floored at 0.05 and the along axis was not.
It also idled for the first 67ms before the collapse began, so the ball hung at
full size and then snapped.

Now the ball shrinks on a smoothstep from the first frame, which has zero rate of
change at both ends, while the particle cloud is drawn inward and a single
shockwave ring expands outward through where it used to be. The ring is taller
than it is wide and `root` is rotated onto the palm axis, so it escapes across
the squeeze. Everything reaches true zero opacity, so there is no hard cut.

**Why the summon is one gesture now.** It used to take two claps, on the reasoning that a single clap was too easy to trigger by accident. That was sound for a detector that fired on stray movement, but it multiplies one attempt's odds by themselves. Replaying the live detector over the 288 recorded clips put single-clap recall at 51.9%, so summoning was a roughly one in ten proposition end to end. A held fist that then opens is deliberate enough on its own, and the arming dwell is what makes it so.

## 7. Gesture vocabulary

| Gesture | Detected by | Effect |
|---|---|---|
| Hold a fist, then open your hand, while hidden | `bloomDetector`, one hand, `isFist` plus curl | Summon the ball, blooming out of your palm |
| Two open palms converging while active | `squashDetector`, no contact required | Dismiss the ball, crushed between the palms |
| Open palm moving | Anchor position, smoothed | Ball follows the hand |
| Thumb to index pinch | Distance between landmarks 4 and 8 | Ball shrinks **and** moves to sit between the fingertips |
| Pinch and turn one hand | The hand's 3D orientation from `worldLandmarks` | Ball takes your hand's orientation, 1:1, all axes |
| Two closed fists | Fingertip curl on both hands | Pick the ball up and carry it between your hands |
| Opening either hand while carrying | Loss of the fist on either side | Set the ball down; it stays where you left it |
| Reaching toward a set down ball | Anchor inside the pickup radius | Pick it back up; it follows that hand again |
| One closed fist | Fingertip curl relative to knuckles | Ball charges up, colour shifts cyan to orange |

Charging is single hand on purpose. Two fists is the carry grab, and reading that as a charge would light the ball up every time you picked it up.

### The pinch anchor

Pinch used to only drive scale, so the ball stayed hovering over the palm while your fingers closed on nothing. The anchor now blends from the palm centre out to the midpoint of the thumb and index tips as the pinch tightens, so a pinched ball is genuinely held between your fingers.

A fist is excluded from that blend. Curling the hand puts the thumb tip right beside the index tip, which reads as a hard pinch, and without the exclusion the anchor would jump to the knuckles every time you made a fist or carried the ball.

### Carry states

| State | Ball target | Leaves via |
|---|---|---|
| `follow` | the tracked hand's anchor, or the midpoint of two open hands | both fists held for `grabDwell` |
| `carried` | midpoint of the two palms | either hand opens for `releaseGrace`, or a hand is lost |
| `parked` | fixed, where you set it down | a hand inside the pickup radius for `pickupDwell` |

Every transition has a dwell timer. Fist detection flickers, hands drop out of frame for a frame or two, and a hand hovering at the edge of the pickup radius would otherwise make the ball twitch between states.

Tunable constants:

| Constant | Value | Meaning |
|---|---|---|
| `palmSmoothing` | 0.6 | Exponential smoothing on palm position |
| `anchorSmoothing` | 0.55 | Smoothing on the ball anchor; fingertips jitter more than palms |
| `pinchSmoothing` | 0.45 | Exponential smoothing on pinch distance |
| `pinchAnchorTight` / `pinchAnchorOpen` | 0.10 / 0.22 | Where the anchor blend starts and ends |
| `pinchMinDistance` / `pinchMaxDistance` | 0.05 / 0.32 | Fully pinched / fully open, for the size curve |
| `scaleMapping` | `0.5 + norm * 2.6` | Pinch to ball scale curve |
| `powerRamp` | 0.15 /frame | Fist charge ease rate |
| `pickupRadius` | 0.10 + scale x 0.055 | Reach needed to pick a parked ball up |
| `pickupDwell` / `grabDwell` / `releaseGrace` | 0.12 / 0.08 / 0.12 s | Dwell timers on the carry transitions |
| `carryLostGrace` | 0.4 s | Hands gone this long parks the ball where it is |

Note on mirroring: the camera preview is mirrored so it feels like a mirror, which is standard for webcam UI. The landmark to world space mapping flips the x axis to compensate. The old app deliberately did not mirror, so this is an intentional difference and any position mapping bug should check this first.

### Rotational dynamics

Pinch to take hold and the ball takes on your hand's own orientation, every axis
at once, one to one. Pronate and it rolls, tilt and it tilts, turn and it turns.

**Why the first two attempts failed.** Both read a single in-plane angle off the
flat image landmarks, wrist to middle knuckle. That angle is blind to pronation,
the palm rolling over about the forearm, which is the motion the gesture is
actually made of: rotating the hand about that axis leaves the wrist-to-knuckle
line unmoved on screen. Measured against a synthetic hand pronated 55 degrees,
the old signal reports **0.0 degrees** and the new one reports **55.0**. No gain
or threshold could have fixed that, because the signal was not there. Raising
`rollGain` to 2.6 made it worse in a second way: a multiplier makes the ball's
rotation *proportional* to your hand rather than *aligned* with it.

MediaPipe returns metric 3D landmarks alongside the image ones on every frame,
and always has. `handOrientation` builds a rotation from two spans of the hand,
wrist to middle knuckle and index knuckle to little knuckle, orthonormalised by
Gram-Schmidt with the third axis from their cross product.

**What counts as having hold of it.** Three conditions, and the first two exist
because leaving them out made the ball spin wildly during two gestures that have
nothing to do with rotation:

| Condition | Why |
|---|---|
| not a fist | Curling the hand puts the thumb tip beside the index tip, so a fist measures as a *maximum* pinch. Power mode therefore grabbed the ball and it rode the fist. `handAnchor` excludes fists for the same reason. |
| exactly one hand | `sorted` is ordered by palm x and re-sorted every frame, so with two hands up, crossing them swaps which hand slot 0 refers to and the orientation jumps to a different hand entirely. This matches how `charging` is already gated. |
| not carried | Two fists are the carry grab, and the release grace can leave that state with one hand still up. |

The grip also has separate take-hold and let-go thresholds, `gripEnter` 0.3 and
`gripExit` 0.12. Turning your hand changes how the thumb and finger project, so
the measured pinch moves while you twist even though your fingers have not;
against a single threshold that flickers, and each flicker cost the anchor.

Taking hold records both the hand's orientation and the ball's. Each frame the
ball is set to `handNow * handAtGrip⁻¹` applied to where the ball was. Because
it is **anchored rather than accumulated**, turning your hand back returns the
ball exactly to where it started, and losing tracking is harmless: the anchor is
simply retaken, so the ball keeps its orientation and your current pose becomes
the new reference. A dropout can neither jerk it nor lose the turn. A grace of
`regripGrace` keeps the original anchor across the frame or two the tracker
usually drops, so an uninterrupted turn stays uninterrupted.

There is no momentum. The ball stops the instant you let go, because a flywheel
fought the point of the gesture: the orientation you released it at is the one
you chose, and coasting past it on an estimated angular velocity threw that away
and read as the ball spasming.

Range is not capped by your wrist, since letting go and taking hold again
carries on from where it stopped.

| Hand motion | Ball |
|---|---|
| pronation 55 deg | 55.0 deg |
| yaw 40 deg | 40.0 deg |
| pitch 30 deg | 30.0 deg |
| compound turn 65 deg | 65.0 deg |

`AXIS` in `orientation.ts` maps MediaPipe's space (x right, y down) onto the
mirrored, y-up space the renderer uses. It flips x and y, which is a rotation by
pi about z and therefore proper, so the basis stays right-handed. If an axis
ever reads inverted, signs must be flipped **in pairs**: flipping one makes it a
reflection and the whole rotation comes out mirrored.

Orientation is applied to the ball's `body` group, since `root` already carries
position and the shockwave's palm-axis alignment.

## 8. Hand tracking and trigger detection

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

Palm centre weights the four MCP knuckles above the wrist. Averaging them evenly drags the point down toward the heel of the hand, so the ball sat noticeably lower than where the palm looks centred. Separation between two points is Euclidean distance with an aspect ratio correction on x, since normalized coordinates are not square.

### Why the clap was replaced

The clap did not work, and the reason was not tuning. Replaying the live detector and the trained model over the 288 recorded clips measured three failures that multiplied:

| Stage | Measured |
|---|---|
| `ClapDetector` recall, the gate the model sits behind | 51.9% |
| Model confirm, given the window inference actually feeds it | 63.0% |
| Summon needing two of those inside 1.5s | squares it |

End to end that is about a 10.7% chance a summon attempt worked.

**The gate could not open.** `armed` required `spread > 0.55`, an absolute threshold carried over from Apple's coordinate space. Both `crossingFire` and the dropped-hand fallback required it. Loading the classifier was supposed to widen the geometric pass, but `CLAP_LOOSE` only relaxes velocities and `openThreshold` lives in `CLAP_BASE`, so recall with the model loaded was identical to 0.1 of a percent.

**The model was fed a window it had never seen.** The recorder captures `CLASSIFIER.postRoll` frames *after* the trigger, so training clips carry the event at index ~20 of 32 with 12 frames of aftermath. Live, `classifyClap` took the trailing 32 frames ending *at* the trigger. Training augmentation jitters ±3 frames; the gap was 12. Running the exported weights both ways over the same clips:

| Alignment | clap | near_miss |
|---|---|---|
| As trained | mean 0.973, fires 100.0% | mean 0.073, fires 4.6% |
| As served | mean 0.603, fires 63.0% | mean 0.501, fires **50.8%** |

The tail is where a clap separates from a near miss. Without it the model is near a coin flip in both directions, which is also where the random dismissals came from.

**And the gesture itself is hostile to the tracker.** Two hands are reported only 6.6% of the time while they are touching, against 63–76% once they are apart. A clap hides its decisive instant in the tracker's blind spot:

| Palm separation | Frames | Two hands tracked |
|---|---|---|
| touching, < 0.15 | 2935 | 6.6% |
| 0.15 – 0.25 | 482 | 63.5% |
| 0.25 – 0.35 | 715 | 76.4% |
| 0.35 – 0.50 | 933 | 63.1% |

One hand is reported 93.8% of the time, and `curl` is the steadiest signal in the feature set at 0.65% frame-to-frame jitter against 1.23% for palm separation. So the summon moved to one hand, and the dismiss stopped requiring contact.

### Summon: `bloomDetector`

```
each frame, hidden mode only:
  if no hand for longer than loseTimeout:  forget the held fist
  if isFist:                               arm once held for armDwell
  else if armed:
    if longer than releaseWindow since the fist broke:  abandon
    if curl <= openCurl:                                summon
```

`isFist` is deliberately the same predicate that drives power mode rather than a threshold on `fistCurlScore`. Real fists score around 0.45 and open hands reach 0.30, so any threshold between them is thin, and sharing the predicate means the summon and the charge can never disagree about what a fist is. The continuous `curl` is used only for the openness ramp.

Nothing here contends with power mode. `charging` is evaluated inside the active-mode block, so a fist means nothing while the ball is hidden, which is the only time this detector runs.

### Dismiss: `squashDetector`

Two open palms converging on the ball. Contact is neither required nor waited for: it fires around 133ms *before* the closest approach, with 93% of fires landing while the hands are still more than 0.15 apart, which is the separation below which the tracker stops reporting two hands at all.

It also no longer has to tell a clap from a near miss. Both are deliberate converges and both should dismiss, which collapses the problem the classifier existed to solve back into geometry. Swept against the recorded clips, scoring every clap and near miss as a dismiss and every wave, rest and other gesture as a miss:

| Constant | Value | Meaning |
|---|---|---|
| `closeRatio` | 0.8 | Fraction of the widest recent opening that starts a converge |
| `minOpenSpread` | 0.15 | Below this the opening is tracker noise |
| `minTravel` | 0.12 | Ground a converge must cover to be a gesture |
| `minClosingSpeed` | 0.5 | Floor that keeps steering drift from dismissing |
| `openWindow` | 2.0 s | Span the widest opening is remembered over |
| `reopenRatio` | 0.95 | Drifting back out this far abandons the converge |
| `debounce` | 0.6 s | Minimum gap between dismissals |

That catches **79.5%** of deliberate converges with **zero** false fires across all 142 negatives. Recall is a lower bound: the clips are 32 frames with two hands present only a third of the time, so the widest opening is often never established, where live it runs on continuous history. `minClosingSpeed` is the one value carrying safety margin rather than measured need — no recorded negative comes near it, but two open hands steering the ball can drift together slowly, and that drift must never dismiss.

As with the recorder's approach detector, nothing is an absolute distance. Everything is a ratio against the widest opening actually observed, so it calibrates to how far apart you really hold your hands.

### Ideas kept from the clap detector

**Speed is measured across a window.** A single frame at 30fps is a 33ms sample of a noisy signal. Thresholds against it mean nothing.

**Re-acquired hands are ignored.** Smoothing snaps rather than glides on large jumps, so a hand lost and found somewhere else produces an enormous apparent closing speed. `stableFrames` counts clean two-hand frames and resets on any snap.

**The event carries the palm midpoint and the palm to palm axis.** The dismissal flings the ball into that point and squashes it along that axis, so it looks like it caught something rather than like the ball folded up nearby.

**Two fists never fire.** That is the carry grab, and carrying the ball into your own hands would otherwise read as a squash.

`clapDetector.ts` is still in the tree. It no longer drives the ball; it supplies `spread` and `closingVelocity` for the feature buffer and the HUD, which the recorder still needs.

Hands are sorted by x position each frame for stable left and right slots, because tracking order is not guaranteed frame to frame. MediaPipe also returns a handedness label which may be more robust, but it can read inverted depending on mirroring, so it is a refinement to validate rather than a requirement.

## 9. Custom gesture classifier

### The problem it solves

Threshold logic asks "did these two points get close quickly." Plenty of non clap motions satisfy that. The classifier asks "does this motion look like the claps I was trained on."

### Architecture: confirmation layer, not replacement

The geometric detector stays as the first pass because it is instant and already tuned. When it proposes a clap candidate, the trailing landmark buffer runs through the classifier, and the clap only fires if confidence clears a threshold. This means inference runs on candidate events, not every frame, which protects the frame budget.

### Data collection

`src/dev/RecordRoute.tsx` is a development only mode that runs the exact same MediaPipe pipeline as production. This matters: recording with a different pipeline than inference is the fastest way to build a model that scores well in training and fails live. It runs with `emitClaps` off so collecting a hundred claps never fights the live state machine.

**Clips are captured automatically.** Whenever the geometric detector proposes a candidate, the recorder saves the window and tags it with whichever label is currently selected. The original spacebar flow could not work: you clap, then react, and by the time the key is down the motion has already scrolled out of the buffer. Space is still there for classes that never trip the detector, like resting hands, which the model needs just as much.

Clips are centred on the candidate rather than trailing it. The buffer runs `bufferFrames` long and the capture happens `postRoll` frames after the candidate fires, so a clip contains the approach, the contact and the tail.

| Label | Target count | What to record |
|---|---|---|
| `clap` | 80 | Real claps. Vary speed, distance from camera, lighting, starting hand positions |
| `near_miss` | 65 | Hands coming close but not clapping. Include two fisted carries |
| `wave` | 50 | Waving, which geometrically resembles a fast approach |
| `rest` | 40 | Hands visible and still |
| `other_gesture` | 45 | Pointing, pinching, fists, anything else |

Roughly 280 clips. The negatives outnumber the positives on purpose. The failure mode that actually hurts is a false positive on ordinary hand movement, not a missed clap against a blank background. Training applies class weighting so the model cannot score well by simply never saying clap.

Export writes one JSON file holding every clip, rather than one download per clip. The file carries its own window length and feature order, so `train.py` reads the shape from the data and the Python and TypeScript constants cannot drift apart.

### Features and training

Each frame contributes the engineered signals the geometric detector already computes, rather than raw landmarks. A few hundred clips is nowhere near enough for a model to rediscover that signal engineering, and it is already validated.

| Feature | Why |
|---|---|
| `spread` | Palm to palm distance, the core clap signal |
| `closingVelocity` | Windowed closing rate |
| `pinch` | Distinguishes a pinch from an approach |
| `curl` | Fist curl on the first hand |
| `curlB` | Fist curl on the second hand, so a two fisted carry is separable from a clap |
| `handCount` | A hand dropping out at contact is itself a strong clap signal |

`window` is 32 frames, about one second at 30fps. The spec lives in `CLASSIFIER` in `src/state/types.ts` and nowhere else.

Training runs in `training/train.py` with Keras: a small dense network, a stratified train and validation split, class weighting, and augmentation by coordinate noise and time jitter on the window start.

There is deliberately no horizontal mirror augmentation. An earlier version mirrored clips by negating the closing velocity while keeping the positive label, which is wrong. Mirroring a clap does not make the hands travel apart, the spread still shrinks. All it taught the model was that hands flying apart are a clap, which is the exact false positive this layer exists to prevent.

`training/convert_to_tfjs.py` runs the `tensorflowjs_converter` to produce `model.json` plus weight shards into `public/models/clap-classifier/`. The input format is `keras_keras` and the output format is `tfjs_layers_model`. Both halves matter. `keras` means an HDF5 file from Keras 2, and a Keras 3 `.keras` file is a zip archive, so it fails with an unhelpful "file signature not found" from inside h5py; `keras_keras` is the Keras 3 format. On the output side, a `tf_saved_model` input can only produce a graph model, and the browser calls `tf.loadLayersModel`, which cannot read one. Getting either wrong produces a model that trains fine and then silently fails to load.

Use a virtualenv on Python 3.11. TensorFlow has no wheels for 3.13, and the pyenv 3.12 on this machine was built against an `openssl@1.1` that Homebrew has removed, so it has no `ssl` module and pip cannot reach PyPI at all.

Two version pins in `requirements.txt` look wrong and are not. `tensorflowjs` imports `tensorflow_decision_forests` at module load even though nothing here uses decision forests, and its generated code needs a protobuf runtime of 6.31.1 or newer while TensorFlow pins protobuf below 6. A newer runtime can read older generated code, so 6.31.1 satisfies both, and pip's conflict warning about it can be ignored. Separately, `tensorflow_hub` imports `pkg_resources`, which setuptools 81 removed, so setuptools is held below that.

The converted model is committed. `scripts/fetch-models.sh` does not touch that folder and it is not gitignored, so it deploys to Vercel as part of the repo.

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

The old HUD was genuinely well designed and is not the weak part of the project. Its restraint is worth carrying forward even though the visual execution is being redone: a small fixed palette, hairline strokes instead of glow everywhere, technical typography, camera style registration marks in the corners, and live numeric readouts.

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

### How the HUD gets designed

This is a build step, not a styling note. After the pipeline works end to end with placeholder debug text:

1. Work from the three reference frames and a written brief covering the palette tokens, the component inventory, the font constraint, and the fact that the HUD is a live overlay bound to real state rather than a static mockup. The last point is the one that matters most: a HUD is not a mockup, and every readout has to be tied to something the app actually knows.
2. Audit the result as a second pass, deliberately separate from making it, and cut anything that reads as templated rather than designed.

Do not hand roll the HUD first and polish it afterward. Settle the component structure and the token set before writing the CSS.

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
| M6 | HUD design pass, then an audit pass | Replaces debug text, reads as designed not templated |
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
