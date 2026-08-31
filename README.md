# Holoball

Clap your hands and a holographic ball appears over your camera feed. Move your hand to steer it, pinch to resize it, make a fist to charge it up, then clap once more to crush it.

Runs entirely in the browser. Nothing you do in front of the camera leaves your machine.

## Controls

| What you do | What happens |
|---|---|
| Make a fist and open it | The ball appears |
| Move an open hand | The ball follows your hand |
| Pinch thumb and index finger | The ball shrinks or grows |
| Make a fist | The ball charges up and shifts from cyan to orange |
| Bring your hands together while the ball is on the screen| The ball gets crushed and disappears |

## How it works

Three layers. A video element showing your camera, a transparent WebGL canvas with the ball on it, and an HTML overlay for the readouts.

Every frame, MediaPipe finds up to two hands in the video and returns 21 tracked points for each one. From those points the app works out where your palms are, how far apart they are, whether you are pinching, and whether your hand is closed into a fist. A clap is detected when your palms spread apart and then come together quickly.

There is a second layer on top of that. A small neural network, trained on recorded clips of real claps and of things that merely look like claps, gets the final say on whether a detected clap was genuine. It runs on your device, in the browser, so there is no server call and no added delay.

The ball itself is Three.js. An icosahedron gives it the triangulated wireframe look, glowing points sit at every vertex, three rings orbit it on different axes, and about 1200 particles drift around the outside. Bloom  does the glow.

## Tech

Vite, TypeScript, React for the overlay, Three.js for the 3D, MediaPipe Tasks Vision for hand tracking, TensorFlow.js for the gesture classifier, Zustand for state.

## Privacy

Your camera feed is processed locally and never uploaded. There is no backend, no analytics, and no account.

## Browser support

Built and tested on desktop Chrome. Safari should work but its handling of the tracking model is less reliable, so the app falls back to CPU processing there. Mobile is not supported yet, mostly because running hand tracking and WebGL bloom at the same time is more than a phone browser handles comfortably.

## Licence

MIT.
