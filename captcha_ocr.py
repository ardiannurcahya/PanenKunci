"""captcha_ocr.py — Solve captcha image using keras-io/ocr-for-captcha"""
import sys
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"  # suppress TF warnings

from huggingface_hub import from_pretrained_keras
import tensorflow as tf
import numpy as np

# Load model once at module level (cached between calls)
_model = None


def load_model():
    global _model
    if _model is None:
        tf.get_logger().setLevel("ERROR")
        _model = from_pretrained_keras("keras-io/ocr-for-captcha")
    return _model


def preprocess_image(path):
    """Load and preprocess image for the model."""
    img = tf.io.read_file(path)
    img = tf.io.decode_png(img, channels=1)
    img = tf.image.convert_image_dtype(img, tf.float32)
    img = tf.image.resize(img, [200, 50])
    img = tf.transpose(img, perm=[1, 0, 2])
    return tf.expand_dims(img, axis=0)


# Character vocabulary (from the original Keras example)
VOCAB = list(
    "0123456789"
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
)
char_to_num = tf.keras.layers.StringLookup(
    vocabulary=list(VOCAB), mask_token=None
)
num_to_char = tf.keras.layers.StringLookup(
    vocabulary=char_to_num.get_vocabulary(),
    mask_token=None,
    invert=True,
)


def decode_predictions(pred):
    """CTC decode the model output to text."""
    input_len = np.ones(pred.shape[0]) * pred.shape[1]
    results = tf.keras.backend.ctc_decode(
        pred, input_length=input_len, greedy=True
    )[0][0]
    text = tf.strings.reduce_join(num_to_char(results[0])).numpy().decode("utf-8")
    return text.replace("[UNK]", "").strip()


def solve(image_path):
    model = load_model()
    img = preprocess_image(image_path)
    pred = model.predict(img, verbose=0)
    return decode_predictions(pred)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python captcha_ocr.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"ERROR: file not found: {image_path}")
        sys.exit(1)

    try:
        result = solve(image_path)
        print(result)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
