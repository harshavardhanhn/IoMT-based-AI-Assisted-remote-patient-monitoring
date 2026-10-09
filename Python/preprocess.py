"""
Signal preprocessing utilities.
- Bandpass filter (0.5–40 Hz) to remove baseline wander and EMG noise
- Z-score normalisation
- Fixed-length windowing
"""

import numpy as np
from scipy.signal import butter, filtfilt

FS          = 360          # MIT-BIH sampling rate (Hz); AD8232 ≈ 360 Hz
WINDOW_LEN  = 360          # 1-second window at 360 Hz = 360 samples
LOWCUT      = 0.5
HIGHCUT     = 40.0


def bandpass_filter(signal: np.ndarray, fs: float = FS) -> np.ndarray:
    """Apply 4th-order Butterworth bandpass filter."""
    nyq = 0.5 * fs
    low = LOWCUT / nyq
    high = HIGHCUT / nyq
    b, a = butter(4, [low, high], btype="band")
    return filtfilt(b, a, signal)


def normalise(signal: np.ndarray) -> np.ndarray:
    """Z-score normalise a 1D signal."""
    mu, sigma = signal.mean(), signal.std()
    if sigma < 1e-6:
        return np.zeros_like(signal)
    return (signal - mu) / sigma


def preprocess_ecg(samples: list[int | float], target_len: int = WINDOW_LEN) -> np.ndarray:
    """
    Full pipeline: pad/trim → bandpass → normalise → reshape for CNN-LSTM.
    Returns shape (1, target_len, 1).
    """
    sig = np.array(samples, dtype=np.float32)

    # Trim or zero-pad to target length
    if len(sig) >= target_len:
        sig = sig[:target_len]
    else:
        sig = np.pad(sig, (0, target_len - len(sig)), mode="edge")

    try:
        sig = bandpass_filter(sig)
    except Exception:
        pass   # skip filter if signal is too short

    sig = normalise(sig)
    return sig.reshape(1, target_len, 1).astype(np.float32)
