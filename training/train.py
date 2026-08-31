"""
Trains the clap confirmation classifier from recorded landmark clips.

Input:  training/record_export/*.json  (written by the in-app recorder)
Output: training/saved_model/clap.keras

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
MODEL_FILE = OUT / "clap.keras"

POSITIVE = "clap"

# Only used for clips exported before the recorder started stamping its own
# feature list into the file.
LEGACY_FEATURES = ["spread", "closingVelocity", "pinch", "curl"]


def load_clips():
    """
    The export file carries its own window length and feature order, so the
    shape here always matches whatever the browser actually recorded. Nothing
    is hardcoded that could drift away from src/state/types.ts.
    """
    files = sorted(CLIPS.glob("*.json"))
    if not files:
        raise SystemExit(
            f"No clips found in {CLIPS}. Record some with the in-app recorder "
            f"at /?record, then export into that folder."
        )

    window = None
    features = None
    x, y = [], []

    for path in files:
        doc = json.loads(path.read_text())
        if isinstance(doc, dict) and "clips" in doc:
            file_window = int(doc["window"])
            file_features = list(doc["features"])
            clips = doc["clips"]
        else:
            clips = [doc]
            file_window = len(doc["frames"])
            file_features = LEGACY_FEATURES

        if window is None:
            window, features = file_window, file_features
        elif (file_window, file_features) != (window, features):
            raise SystemExit(
                f"{path.name} was recorded with a different feature spec "
                f"({file_window} x {file_features}) than {window} x {features}. "
                f"Re-record or move the odd files out."
            )

        for clip in clips:
            frames = clip["frames"]
            pad = [{k: 0.0 for k in features}] * max(0, window - len(frames))
            rows = [
                [float(f.get(name, 0.0)) for name in features]
                for f in (pad + frames)[-window:]
            ]
            x.append(rows)
            y.append(1.0 if clip["label"] == POSITIVE else 0.0)

    return (
        np.array(x, dtype=np.float32),
        np.array(y, dtype=np.float32),
        window,
        features,
    )


def augment(x, y, rounds=3):
    """
    Small dataset, so widen it with noise and time jitter.

    There is deliberately no horizontal mirror here. An earlier version mirrored
    clips by negating the closing velocity while keeping the positive label,
    which is wrong: mirroring a clap does not make the hands travel apart, the
    spread still shrinks. All it taught the model was that hands flying apart
    are a clap, which is the exact false positive this layer exists to stop.
    """
    rng = np.random.default_rng(0)
    xs, ys = [x], [y]
    for _ in range(rounds):
        xs.append(x + rng.normal(0, 0.01, x.shape).astype(np.float32))
        ys.append(y)

        shift = int(rng.integers(-3, 4))
        if shift != 0:
            # Edge padded roll, so the motion sits at a slightly different point
            # in the window without inventing frames from the far end.
            shifted = np.roll(x, shift, axis=1)
            if shift > 0:
                shifted[:, :shift, :] = x[:, :1, :]
            else:
                shifted[:, shift:, :] = x[:, -1:, :]
            xs.append(shifted.astype(np.float32))
            ys.append(y)

    return np.concatenate(xs), np.concatenate(ys)


def build_model(inputs):
    return tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(inputs,)),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(1, activation="sigmoid"),
        ]
    )


def main():
    x, y, window, features = load_clips()
    print(f"Loaded {len(x)} clips, {int(y.sum())} positive")
    print(f"Window {window} frames, features {features}")

    x, y = augment(x, y)
    x = x.reshape(len(x), window * len(features))

    x_train, x_val, y_train, y_val = train_test_split(
        x, y, test_size=0.2, random_state=0, stratify=y
    )

    # Negatives outnumber positives on purpose, per REQUIREMENTS section 9.
    # Without weighting the model can score well by simply never saying clap.
    positives = float(y_train.sum())
    negatives = float(len(y_train) - positives)
    total = positives + negatives
    class_weight = {
        0: total / (2 * negatives) if negatives else 1.0,
        1: total / (2 * positives) if positives else 1.0,
    }

    model = build_model(window * len(features))
    model.compile(
        optimizer="adam",
        loss="binary_crossentropy",
        metrics=[
            "accuracy",
            # "precision" is not a valid Keras metric alias and raises here.
            tf.keras.metrics.Precision(name="precision"),
            tf.keras.metrics.Recall(name="recall"),
        ],
    )
    model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=60,
        batch_size=32,
        class_weight=class_weight,
        callbacks=[
            tf.keras.callbacks.EarlyStopping(
                patience=10, restore_best_weights=True, monitor="val_loss"
            )
        ],
    )

    # return_dict, not zip against metrics_names. Keras 3 does not populate
    # metrics_names the way Keras 2 did, so the zip silently produced nothing
    # and the precision warning below then fired on every run.
    scores = model.evaluate(x_val, y_val, verbose=0, return_dict=True)
    print("\nValidation:")
    for name in ("accuracy", "precision", "recall"):
        if name in scores:
            print(f"  {name:9} {scores[name]:.3f}")
    if scores.get("precision", 1.0) < 0.9:
        print(
            "\nPrecision under 0.9. A false positive dismisses the ball mid use, "
            "so record more near_miss and wave clips before shipping this."
        )

    OUT.mkdir(exist_ok=True)
    # A .keras file, not model.export(). The SavedModel format that produced is
    # unusable downstream: tensorflowjs can only turn it into a graph model,
    # and the browser side loads a layers model.
    model.save(MODEL_FILE)
    print(f"Saved to {MODEL_FILE}")


if __name__ == "__main__":
    main()
