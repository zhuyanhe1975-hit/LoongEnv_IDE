from __future__ import annotations

from runtime_config import load_runtime_config

RUNTIME_CONFIG = load_runtime_config()
BASE_JOINTS = [dict(item) for item in RUNTIME_CONFIG["servo"]["baseline"]]
GAIN_BOUNDS = RUNTIME_CONFIG["servo"]["gain_bounds"]


def controller_gain_bounds(index: int, gain: dict | None = None) -> dict:
    base = BASE_JOINTS[index] if index < len(BASE_JOINTS) else BASE_JOINTS[-1]
    source = gain or base
    force_limit = abs(float(source.get("forcerange", base["forcerange"])[1]))
    kp_floor_min = int(GAIN_BOUNDS.get("kp_floor_min", 0))
    kd_floor_min = int(GAIN_BOUNDS.get("kd_floor_min", 0))
    kp_min_span = int(GAIN_BOUNDS.get("kp_min_span", 1))
    kd_min_span = int(GAIN_BOUNDS.get("kd_min_span", 1))
    kp_min = max(
        kp_floor_min,
        round(base["kp"] * GAIN_BOUNDS["kp_base_scale_min"]),
        round(force_limit * GAIN_BOUNDS["kp_force_scale_min"]),
    )
    kp_max = max(
        kp_min + kp_min_span,
        round(base["kp"] * GAIN_BOUNDS["kp_base_scale_max"]),
        round(force_limit * GAIN_BOUNDS["kp_force_scale_max"]),
    )
    kd_min = max(
        kd_floor_min,
        round(base["kd"] * GAIN_BOUNDS["kd_base_scale_min"]),
        round(kp_min * GAIN_BOUNDS["kd_kp_scale_min"]),
    )
    kd_max = max(
        kd_min + kd_min_span,
        round(base["kd"] * GAIN_BOUNDS["kd_base_scale_max"]),
        round(kp_max * GAIN_BOUNDS["kd_kp_scale_max"]),
    )
    ki_max = max(round(base["ki"] * GAIN_BOUNDS["ki_base_scale_max"], 2), GAIN_BOUNDS["ki_floor_max"])
    return {
        "kp_min": kp_min,
        "kp_max": kp_max,
        "kd_min": kd_min,
        "kd_max": kd_max,
        "ki_min": 0.0,
        "ki_max": ki_max,
    }


def clamp_controller_gain(index: int, gain: dict) -> dict:
    base = BASE_JOINTS[index] if index < len(BASE_JOINTS) else BASE_JOINTS[-1]
    bounds = controller_gain_bounds(index, gain)
    return {
        "name": gain.get("name", base["name"]),
        "kp": int(min(bounds["kp_max"], max(bounds["kp_min"], int(gain.get("kp", base["kp"]))))),
        "ki": float(min(bounds["ki_max"], max(bounds["ki_min"], float(gain.get("ki", base["ki"]))))),
        "kd": int(min(bounds["kd_max"], max(bounds["kd_min"], int(gain.get("kd", base["kd"]))))),
        "forcerange": gain.get("forcerange", base["forcerange"]),
    }


def normalize_controller_gains(gains: list[dict] | None) -> list[dict]:
    if not gains:
        return [dict(item) for item in BASE_JOINTS]
    normalized = []
    for index, gain in enumerate(gains):
        base = BASE_JOINTS[index] if index < len(BASE_JOINTS) else BASE_JOINTS[-1]
        normalized.append(clamp_controller_gain(index, {**base, **gain}))
    return normalized
