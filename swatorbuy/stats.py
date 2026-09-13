"""Small statistics: bootstrap intervals, effect sizes, Bradley-Terry ratings."""

from __future__ import annotations

import numpy as np


def bootstrap_ci(samples, n_boot: int = 2000, alpha: float = 0.05, seed: int = 0) -> tuple[float, float]:
    x = np.asarray(samples, dtype=np.float64)
    if len(x) < 2:
        v = float(x[0]) if len(x) else 0.0
        return v, v
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(x), (n_boot, len(x)))
    means = x[idx].mean(axis=1)
    return float(np.quantile(means, alpha / 2)), float(np.quantile(means, 1 - alpha / 2))


def summarize(samples) -> dict[str, float]:
    x = np.asarray(samples, dtype=np.float64)
    lo, hi = bootstrap_ci(x)
    return {"mean": float(x.mean()), "lo": lo, "hi": hi, "sd": float(x.std(ddof=1)) if len(x) > 1 else 0.0,
            "n": int(len(x))}


def separation(a, b) -> dict[str, float | bool]:
    """How far apart two sample sets are: standardised difference and whether the
    bootstrap intervals overlap. ``distinct`` is the headline: the ad differs from this
    control beyond the trial noise."""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    pooled = np.sqrt(0.5 * (a.var(ddof=1) + b.var(ddof=1))) if len(a) > 1 and len(b) > 1 else 0.0
    d = float((a.mean() - b.mean()) / pooled) if pooled > 0 else (0.0 if a.mean() == b.mean() else float("inf"))
    alo, ahi = bootstrap_ci(a)
    blo, bhi = bootstrap_ci(b)
    return {"difference": float(a.mean() - b.mean()), "effect": d,
            "distinct": bool(ahi < blo or bhi < alo)}


def bradley_terry(wins: np.ndarray, iterations: int = 500) -> np.ndarray:
    """Ratings from a (possibly fractional) win matrix; wins[i, j] is how often i beat j.
    Returns log-strengths centred on zero."""
    n = wins.shape[0]
    p = np.ones(n)
    games = wins + wins.T
    for _ in range(iterations):
        new = np.empty(n)
        for i in range(n):
            denom = sum(games[i, j] / (p[i] + p[j]) for j in range(n) if j != i and games[i, j] > 0)
            new[i] = wins[i].sum() / denom if denom > 0 else p[i]
        new = np.maximum(new, 1e-9)
        p = new / np.exp(np.log(new).mean())
    return np.log(p)
