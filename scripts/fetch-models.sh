#!/usr/bin/env bash
# Copies the MediaPipe WASM runtime and downloads the hand tracking model.
# These are self hosted rather than pulled from a CDN at runtime, because a CDN
# URL must match the installed package version exactly and a mismatch breaks
# startup in a way that looks like a camera failure.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p public/wasm public/models
cp node_modules/@mediapipe/tasks-vision/wasm/* public/wasm/
echo "Copied WASM runtime from node_modules."

if [ ! -f public/models/hand_landmarker.task ]; then
  curl -sL -o public/models/hand_landmarker.task \
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
  echo "Downloaded hand_landmarker.task."
else
  echo "Model already present, skipping download."
fi
