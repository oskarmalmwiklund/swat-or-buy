import numpy as np

from swatorbuy import baselines as B
from swatorbuy import stats as T
from swatorbuy.stimuli import BLANK, Clip


def test_flat_frame_has_no_contrast_or_edges():
    s = B.frame_stats(BLANK)
    assert s["rms_contrast"] < 1e-6 and s["edge_density"] == 0
    assert abs(s["left_minus_right_luminance"]) < 1e-6


def test_spectral_residual_shape_and_range():
    rng = np.random.default_rng(0)
    f = np.full_like(BLANK, 128)
    f[60:120, 100:220] = 255
    m = B.spectral_residual(f)
    assert m.shape == (180, 320) and 0 <= m.min() and m.max() <= 1.0
    assert m[90, 160] > m[10, 10]


def test_clip_stats_motion_energy():
    rng = np.random.default_rng(1)
    frames = [rng.integers(0, 255, BLANK.shape, dtype=np.uint8) for _ in range(5)]
    assert B.clip_stats(Clip(frames, 40, "v"))["motion_energy"] > 0
    assert B.clip_stats(Clip.still(BLANK))["motion_energy"] == 0


def test_bootstrap_and_separation():
    lo, hi = T.bootstrap_ci([1, 1, 1, 1])
    assert lo == hi == 1
    sep = T.separation([1.0, 1.1, 0.9, 1.0], [5.0, 5.1, 4.9, 5.0])
    assert sep["distinct"] and sep["difference"] < 0
    assert not T.separation([1, 2, 3, 4], [2, 3, 4, 1])["distinct"]


def test_bradley_terry_orders_strengths():
    wins = np.array([[0, 3, 3], [0, 0, 3], [0, 0, 0]], dtype=float)
    r = T.bradley_terry(wins)
    assert r[0] > r[1] > r[2]
    assert abs(r.mean()) < 1e-6
