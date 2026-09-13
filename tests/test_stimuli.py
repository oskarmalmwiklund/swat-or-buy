import numpy as np

from swatorbuy import stimuli as S


def test_fit_letterboxes_without_stretching():
    tall = np.zeros((400, 100, 3), dtype=np.uint8)
    tall[:, :, 0] = 200
    out = S.fit(tall)
    assert out.shape == (S.H, S.W, 3)
    # grey bars left and right, content in the middle
    assert (out[:, 0] == S.GREY).all() and (out[:, -1] == S.GREY).all()
    assert out[S.H // 2, S.W // 2, 0] == 200


def test_fit_handles_alpha_and_grey():
    rgba = np.zeros((90, 160, 4), dtype=np.uint8)
    assert S.fit(rgba).shape == (S.H, S.W, 3)
    assert S.fit(np.zeros((90, 160), dtype=np.uint8)).shape == (S.H, S.W, 3)


def test_scramble_keeps_histogram():
    rng = np.random.default_rng(0)
    f = rng.integers(0, 255, (S.H, S.W, 3), dtype=np.uint8)
    g = S.scramble(f, rng)
    assert g.shape == f.shape and not np.array_equal(f, g)
    for c in range(3):
        assert np.array_equal(np.bincount(f[:, :, c].ravel(), minlength=256), np.bincount(g[:, :, c].ravel(), minlength=256))


def test_flat_matches_mean_luminance():
    rng = np.random.default_rng(1)
    f = rng.integers(0, 255, (S.H, S.W, 3), dtype=np.uint8)
    g = S.flat(f)
    assert g.std() == 0
    assert abs(S.luminance(g).mean() - S.luminance(f).mean()) < 0.01


def test_control_clips_consistent_across_frames():
    rng = np.random.default_rng(2)
    a = rng.integers(0, 255, (S.H, S.W, 3), dtype=np.uint8)
    clip = S.Clip([a, a], 40, "x")
    ctrl = S.control_clips(clip, rng, ["scramble", "phase_scramble", "blur", "flat"])
    assert set(ctrl) == {"scramble", "phase_scramble", "blur", "flat"}
    assert np.array_equal(ctrl["scramble"].frames[0], ctrl["scramble"].frames[1])
    assert ctrl["scramble"].frame_ms == 40


def test_reference_set_durations():
    refs = S.reference_set()
    assert set(refs) >= {"grey", "disc", "looming", "receding", "grating_right", "grating_left", "small_dot"}
    for clip in refs.values():
        assert clip.total_ms == 500
        assert clip.frame_ms % S.CHUNK_MS == 0
    assert refs["looming"].frames[0].min() == 0  # disc present from the first frame
    assert (refs["looming"].frames[-1] == 0).sum() > (refs["looming"].frames[0] == 0).sum()


def test_pair_frame_puts_each_ad_in_its_half():
    left = np.full((S.H, S.W, 3), 255, dtype=np.uint8)
    right = np.zeros((S.H, S.W, 3), dtype=np.uint8)
    f = S.pair_frame(left, right)
    half = S.W // 2
    assert f[S.H // 2, half // 2].max() == 255
    assert f[S.H // 2, half + half // 2].max() == 0


def test_pair_clip_aligns_video_and_still():
    still = S.Clip.still(S.BLANK, 1000, "s")
    rng = np.random.default_rng(3)
    vid = S.Clip([rng.integers(0, 255, (S.H, S.W, 3), dtype=np.uint8) for _ in range(10)], 40, "v")
    p = S.pair_clip(still, vid)
    assert p.frame_ms == 40 and p.total_ms == 1000


def test_load_video_roundtrip(tmp_path):
    import cv2

    path = tmp_path / "clip.mp4"
    w = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 30, (64, 36))
    for i in range(45):
        frame = np.full((36, 64, 3), i * 5, dtype=np.uint8)
        w.write(frame)
    w.release()
    clip = S.load(path, max_seconds=1.0)
    assert clip.is_video and clip.frame_ms == 40 and clip.total_ms <= 1000
    assert len(clip.frames) >= 20
