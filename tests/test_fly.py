"""End-to-end tests against the real graph. Skipped unless the data is prepared."""

import numpy as np
import pytest

from swatorbuy.fly.download import ready

pytestmark = pytest.mark.fly
if not ready():
    pytest.skip("MaleCNS data not prepared (run `swat prepare`)", allow_module_level=True)


@pytest.fixture(scope="module")
def fly():
    from swatorbuy.protocols import Fly

    return Fly()


def test_populations_are_present(fly):
    p = fly.pops
    assert len(p.index["lamina"]) > 5000
    assert len(p.index["swat"]) > 500
    assert len(p.index["t4t5"]) > 10000
    assert len(p.approach) == 20 and len(p.avoid) == 10
    assert len(p.column_cells) > 20000
    assert p.column_uv.min() >= 0 and p.column_uv.max() <= 1


def test_solo_is_deterministic_and_sees_contrast(fly):
    from swatorbuy.protocols import solo
    from swatorbuy.stimuli import BLANK, Clip

    ad = BLANK.copy()
    ad[40:140, 80:240] = 0
    clip = Clip.still(ad, 300, "square")
    a = solo(fly, clip, trials=2, controls=["flat"], seed=0)
    b = solo(fly, clip, trials=2, controls=["flat"], seed=0)
    assert a["ad"].samples == b["ad"].samples
    assert a["ad"].mean("glance") > a["controls"]["flat"].mean("glance")
    assert a["ad"].salience.max() == 1.0


def test_pair_share_sums_to_one_direction(fly):
    from swatorbuy.protocols import pair
    from swatorbuy.stimuli import BLANK, Clip

    dark = Clip.still(np.zeros_like(BLANK), 300, "dark")
    grey = Clip.still(BLANK, 300, "grey")
    r = pair(fly, dark, grey, trials=1)
    assert 0 <= r["salience_share_a"] <= 1
    assert r["salience_share_a"] > 0.5  # the dark ad changes the lamina, grey does not
