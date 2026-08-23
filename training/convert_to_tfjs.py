"""
Converts the trained Keras model into the TensorFlow.js format the browser loads.

Run train.py first, then this. Output lands in public/models/clap-classifier/
where gestureClassifier.ts expects it.
"""

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).parent
SAVED = HERE / "saved_model"
OUT = HERE.parent / "public" / "models" / "clap-classifier"


def main():
    if not SAVED.exists():
        raise SystemExit(f"No model at {SAVED}. Run train.py first.")
    OUT.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            "-m",
            "tensorflowjs.converters.converter",
            "--input_format=tf_saved_model",
            "--output_format=tfjs_layers_model",
            str(SAVED),
            str(OUT),
        ],
        check=True,
    )
    print(f"Converted to {OUT}")


if __name__ == "__main__":
    main()
