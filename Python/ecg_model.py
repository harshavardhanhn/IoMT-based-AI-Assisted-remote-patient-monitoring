"""
Layer 3: CNN-LSTM ECG classifier
Architecture:
  Conv1D(32,5) → Conv1D(64,3) → MaxPool → Conv1D(128,3) → MaxPool
  → LSTM(64) → Dropout(0.4) → Dense(5, softmax)

Classes:
  0 Normal  1 Tachycardia  2 Bradycardia  3 Arrhythmia  4 Noise
"""

import os
import numpy as np
import tensorflow as tf
from tensorflow import keras

WINDOW_LEN  = 360
N_CLASSES   = 5
MODEL_PATH  = "models/ecg_cnn_lstm.keras"

CLASS_NAMES = ["Normal", "Tachycardia", "Bradycardia", "Arrhythmia", "Noise"]

_model: keras.Model | None = None


def build_model(input_len: int = WINDOW_LEN, n_classes: int = N_CLASSES) -> keras.Model:
    inputs = keras.Input(shape=(input_len, 1), name="ecg_input")

    x = keras.layers.Conv1D(32, 5, padding="same", activation="relu")(inputs)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.Conv1D(64, 3, padding="same", activation="relu")(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.MaxPooling1D(2)(x)

    x = keras.layers.Conv1D(128, 3, padding="same", activation="relu")(x)
    x = keras.layers.BatchNormalization()(x)
    x = keras.layers.MaxPooling1D(2)(x)

    x = keras.layers.LSTM(64, return_sequences=False)(x)
    x = keras.layers.Dropout(0.4)(x)

    outputs = keras.layers.Dense(n_classes, activation="softmax", name="class_probs")(x)

    model = keras.Model(inputs, outputs, name="CNN_LSTM_ECG")
    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model


def load_model() -> keras.Model:
    global _model
    if _model is not None:
        return _model
    if os.path.exists(MODEL_PATH):
        print(f"[ECGModel] Loading saved model from {MODEL_PATH}")
        _model = keras.models.load_model(MODEL_PATH)
    else:
        print("[ECGModel] No saved model found — creating untrained model.")
        _model = build_model()
    return _model


def predict(ecg_window: np.ndarray) -> dict:
    """
    ecg_window: preprocessed numpy array of shape (1, WINDOW_LEN, 1)
    Returns dict with class, confidence, all class probabilities.
    """
    model = load_model()
    probs = model.predict(ecg_window, verbose=0)[0]   # shape (N_CLASSES,)
    class_idx = int(np.argmax(probs))
    return {
        "ecg_class":     CLASS_NAMES[class_idx],
        "ecg_confidence": round(float(probs[class_idx]), 3),
        "ecg_probs":     {CLASS_NAMES[i]: round(float(p), 3) for i, p in enumerate(probs)},
        "layer":         "cnn_lstm"
    }
