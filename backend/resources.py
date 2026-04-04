"""
resources.py — Dynamic CPU resource sensing for Helio X10 / any ARM device.

Used by:
  VideoEngine  → compute safe FFmpeg thread count per job
  app.py       → compute Waitress thread count at startup
"""
import os
import time
import threading


_CPU_COUNT: int = os.cpu_count() or 4   # cache at import time

# ── Load tracking ─────────────────────────────────────────────────────────────
# On Windows, os.getloadavg() is unavailable.  We maintain a rolling
# 1-second sample of "active Python threads" as a lightweight proxy for load.
_load_lock   = threading.Lock()
_last_sample = 0.0   # Unix load-avg (1-min) or thread-count proxy


def _sample_load() -> float:
    """
    Return an estimate of currently busy CPU cores.
      Termux / Linux / Android → os.getloadavg()[0]  (1-min average)
      Windows                  → active thread count proxy
    """
    try:
        return os.getloadavg()[0]     # number of runnable processes
    except AttributeError:
        # Windows: count active Python threads as a rough load proxy.
        # Each Waitress worker thread counts as 1 busy "unit".
        return float(threading.active_count())


def snapshot_load() -> float:
    """Return and cache a fresh load sample."""
    global _last_sample
    val = _sample_load()
    with _load_lock:
        _last_sample = val
    return val


# ── Dynamic thread allocation ─────────────────────────────────────────────────
def compute_ffmpeg_threads(http_reserve: int = 2) -> int:
    """
    Compute the optimal FFmpeg thread count right now based on system load.

    Algorithm
    ---------
    1. Sample current CPU load (busy cores estimate).
    2. free_cores = total_cores - busy_cores
    3. Give FFmpeg:  max(2,  free_cores - http_reserve)
       - Always leave http_reserve cores for HTTP serving.
       - Always give FFmpeg at least 2 threads (never starve it).
    4. Never exceed total_cores - http_reserve.

    Example on Helio X10 (8 cores):
      load 0.5  → free=8  → ffmpeg_threads=6  (idle device)
      load 2.0  → free=6  → ffmpeg_threads=4  (normal use)
      load 5.0  → free=3  → ffmpeg_threads=2  (busy, min)
      load 7.0  → free=1  → ffmpeg_threads=2  (very busy, still min)
    """
    load     = snapshot_load()
    busy     = min(round(load), _CPU_COUNT)
    free     = max(0, _CPU_COUNT - busy)
    threads  = max(2, free - http_reserve)
    threads  = min(threads, _CPU_COUNT - http_reserve)
    return int(max(2, threads))


def compute_http_threads(min_threads: int = 2) -> int:
    """
    Compute Waitress thread count at startup.
    Formula: half of CPU count, at least min_threads.
    For 8-core device → 4 HTTP threads.
    For 4-core device → 2 HTTP threads.
    """
    return max(min_threads, _CPU_COUNT // 2)


def compute_x264opts(ffmpeg_threads: int) -> str:
    """
    Return x264 options tuned to the available thread budget.

    More threads → can afford slightly better motion estimation:
      threads ≥ 6  → hex search, subme=2  (better quality, same speed on many cores)
      threads 3–5  → dia search, subme=2
      threads ≤ 2  → dia search, subme=1  (cheapest, minimal cores)
    """
    if ffmpeg_threads >= 6:
        me, subme = "hex", "2"
    elif ffmpeg_threads >= 3:
        me, subme = "dia", "2"
    else:
        me, subme = "dia", "1"

    return (
        f"me={me}:subme={subme}:"
        "rc-lookahead=10:ref=1:no-mixed-refs:"
        "trellis=0:b-adapt=0"
    )


# ── Background load monitor ───────────────────────────────────────────────────
def _monitor_loop():
    """Refresh load sample every 5 seconds so it's always warm."""
    while True:
        try:
            snapshot_load()
        except Exception:
            pass
        time.sleep(5)

threading.Thread(target=_monitor_loop, daemon=True, name="LoadMonitor").start()
