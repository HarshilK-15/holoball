"""
Trains the clap confirmation classifier from recorded landmark clips.

Input:  training/record_export/*.json  (written by the in-app recorder)
Output: training/saved_model/          (Keras SavedModel)

Run convert_to_tfjs.py afterwards to get the browser-loadable model.
"""

import json
import pathlib
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split

HERE = pathlib.Path(__file__).parent
CLIPS = HERE / "record_export"
OUT = HERE / "saved_model"

WINDOW = 20
FEATURES = 4  # spread, closingVelocity, pinch, curl
POSITIVE = "clap"


def load_clips():
    x, y = [], []
    for path in sorted(CLIPS.glob("*.json")):
        clip = json.loads(path.read_text())
        frames = clip["frames"]
        if len(frames) < WINDOW:
            frames = [{"spread": 0, "closingVelocity": 0, "pinch": 0, "curl": 0}] * (
                WINDOW - len(frames)
            ) + frames
        window = frames[-WINDOW:]
        vec = [
            [f["spread"], f["closingVelocity"], f["pinch"], f["curl"]] for f in window
        ]
        x.append(vec)
        y.append(1.0 if clip["label"] == POSITIVE else 0.0)
    if not x:
        raise SystemExit(
            f"No clips found in {CLIPS}. Record some with the in-app recorder first."
        )
    return np.array(x, dtype=np.float32), np.array(y, dtype=np.float32)


def augment(x, y, rounds=3):
    """Small dataset, so jitter and mirror to widen it."""
    xs, ys = [x], [y]
    rng = np.random.default_rng(0)
    for _ in range(rounds):
        noisy = x + rng.normal(0, 0.01, x.shape).astype(np.float32)
        xs.append(noisy)
        ys.append(y)
        # Mirroring a clap flips the sign of horizontal closing velocity.
        mirrored = x.copy()
        mirrored[:, :, 1] *= -1
        xs.append(mirrored)
        ys.append(y)
    return np.concatenate(xs), np.concatenate(ys)


def build_model():
    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(WINDOW * FEATURES,)),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ]
    )


def main():
    x, y = load_clips()
    print(f"Loaded {len(x)} clips, {int(y.sum())} positive")

    x, y = augment(x, y)
    x = x.reshape(len(x), WINDOW * FEATURES)

    x_train, x_val, y_train, y_val = train_test_split(
        x, y, test_size=0.2, random_state=0, stratify=y
    )

    model = build_model()
    model.compile(
        optimizer="adam", loss="binary_crossentropy", metrics=["accuracy", "precision"]
    )
    model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=60,
        batch_size=32,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                patience=10, restore_best_weights=True, monitor="val_loss"
            )
        ],
    )

    OUT.mkdir(exist_ok=True)
    model.export(str(OUT))
    print(f"Saved to {OUT}")


if __name__ == "__main__":
    main()
