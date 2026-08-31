"""
Converts the trained Keras model into the TensorFlow.js format the browser loads.

Run train.py first, then this. Output lands in public/models/clap-classifier/
where gestureClassifier.ts expects it.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
MODEL_FILE = HERE / "saved_model" / "clap.keras"
OUT = HERE.parent / "public" / "models" / "clap-classifier"


def main():
    if not MODEL_FILE.exists():
        raise SystemExit(f"No model at {MODEL_FILE}. Run train.py first.")
    OUT.mkdir(parents=True, exist_ok=True)

    # keras_keras, not keras. "keras" means an HDF5 .h5 file from Keras 2, and
    # a Keras 3 .keras file is a zip archive, so it fails with an unhelpful
    # "file signature not found" from deep inside h5py. "keras_keras" is the
    # Keras 3 input format.
    #
    # The output pair matters too: a tf_saved_model input can only produce a
    # graph model, and gestureClassifier.ts calls tf.loadLayersModel, which
    # cannot read one. Getting either wrong produces a model that trains fine
    # and then silently fails to load in the browser.
    subprocess.run(
        [
            sys.executable,
            "-m",
            "tensorflowjs.converters.converter",
            "--input_format=keras_keras",
            "--output_format=tfjs_layers_model",
            str(MODEL_FILE),
            str(OUT),
        ],
        check=True,
    )
    print(f"Converted to {OUT}")
    print("Commit the contents: Vercel serves them, fetch-models.sh does not.")


if __name__ == "__main__":
    main()
