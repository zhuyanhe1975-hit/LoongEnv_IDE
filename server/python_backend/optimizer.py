from __future__ import annotations

import time

import numpy as np

from controller import clamp_controller_gain, controller_gain_bounds
from logger import emit_log, emit_progress
from mjwarp_runner import evaluate_controller_candidates_batch
from runtime import inject_cuda_runtime_dlls
from runtime_config import load_runtime_config

inject_cuda_runtime_dlls()

try:
    import cupy as cp  # type: ignore
except Exception:  # pragma: no cover - runtime fallback only
    cp = None


RUNTIME_CONFIG = load_runtime_config()
SEARCH_CONFIG = RUNTIME_CONFIG["optimization"]["search"]
VALIDATION_CONFIG = RUNTIME_CONFIG["optimization"]["validation_profiles"]
GPU_BATCH_CONFIG = RUNTIME_CONFIG["optimization"].get("gpu_batch", {})
ONLINE_RL_CONFIG = RUNTIME_CONFIG["optimization"].get(
    "online_rl",
    {
        "enabled": True,
        "window_count": 4,
        "survivor_ratio": 0.5,
        "survivor_min": 256,
        "window_keep_per_round": 128,
        "score_weights": {
            "dynamic_peak": 560.0,
            "dynamic_mean": 320.0,
            "hold_peak": 220.0,
            "hold_velocity": 40.0,
            "peak_velocity": 45.0,
            "peak_torque": 0.03,
            "settle_time": 6.0,
            "oscillation": 6.0,
        },
    },
)
CEM_CONFIG = RUNTIME_CONFIG["optimization"].get(
    "cem",
    {
        "elite_ratio": 0.125,
        "mean_momentum": 0.25,
        "std_momentum": 0.2,
        "min_std_ratio": 0.025,
        "max_std_ratio": 0.35,
        "exploration_start": 1.0,
        "exploration_end": 0.35,
        "pool_elite_multiplier": 4,
        "improve_threshold_ratio": 0.01,
        "mean_step_improve": 0.55,
        "mean_step_stable": 0.18,
        "mean_step_freeze": 0.06,
        "sigma_shrink_improve": 0.94,
        "sigma_shrink_stable": 0.9,
        "sigma_shrink_freeze": 0.84,
        "freeze_round_ratio": 0.5,
    },
)


def _trajectory_time_window(trajectory: dict, start_time: float, end_time: float) -> dict:
    samples = list(trajectory.get("samples", []))
    if len(samples) < 2:
        return trajectory

    clipped: list[dict] = []
    for sample in samples:
        sample_time = float(sample.get("time", 0.0))
        if start_time <= sample_time <= end_time:
            clipped.append({**sample, "time": round(sample_time - start_time, 6)})

    if not clipped:
        return trajectory

    first = clipped[0]
    if float(first.get("time", 0.0)) > 1.0e-6:
        clipped.insert(
            0,
            {
                **first,
                "time": 0.0,
            },
        )

    last = clipped[-1]
    final_time = max(0.0, float(end_time - start_time))
    if abs(float(last.get("time", 0.0)) - final_time) > 1.0e-6:
        clipped.append({**last, "time": round(final_time, 6)})

    return {
        **trajectory,
        "summary": f"{trajectory.get('summary', 'trajectory')} / window {start_time:.2f}-{end_time:.2f}s",
        "samples": clipped,
    }


def _build_screen_windows(trajectory: dict) -> list[dict]:
    if not bool(ONLINE_RL_CONFIG.get("enabled", True)):
        return [trajectory]

    samples = list(trajectory.get("samples", []))
    if len(samples) < 2:
        return [trajectory]

    total_duration = float(samples[-1].get("time", 0.0))
    window_count = max(1, int(ONLINE_RL_CONFIG.get("window_count", 4)))
    if total_duration <= 0.0 or window_count <= 1:
        return [trajectory]

    windows: list[dict] = []
    base_window = total_duration / float(window_count)
    for window_index in range(window_count):
        start_time = base_window * window_index
        end_time = total_duration if window_index == window_count - 1 else min(total_duration, base_window * (window_index + 1))
        windows.append(_trajectory_time_window(trajectory, start_time, end_time))
    return windows


def _optimizer_backend() -> tuple[object, str]:
    if cp is None:
        return np, "cpu-numpy-cem"
    try:
        device_id = int(cp.cuda.runtime.getDevice())
        return cp, f"gpu-cupy-cem cuda:{device_id}"
    except Exception:
        return np, "cpu-numpy-cem"


def _candidate_score(metrics: dict, objective_weights: dict[str, float]) -> float:
    precision_weight = float(objective_weights.get("precision", 28)) / 100.0
    stability_weight = float(objective_weights.get("stability", 28)) / 100.0
    vibration_weight = float(objective_weights.get("vibration", 22)) / 100.0
    cycle_weight = float(objective_weights.get("cycle", 14)) / 100.0
    energy_weight = float(objective_weights.get("energy", 8)) / 100.0

    return (
        float(metrics.get("dynamicPeakError", metrics.get("peakError", 0.0))) * 420.0 * precision_weight
        + float(metrics.get("dynamicMeanError", metrics.get("meanError", 0.0))) * 240.0 * precision_weight
        + float(metrics.get("holdPeakError", 0.0)) * 520.0 * stability_weight
        + float(metrics.get("holdPeakVelocity", 0.0)) * 100.0 * stability_weight
        + float(metrics.get("peakVelocity", 0.0)) * 60.0 * vibration_weight
        + float(metrics.get("peakTorque", 0.0)) * 0.08 * energy_weight
        + float(metrics.get("settleTime", 0.0)) * 18.0 * cycle_weight
        + float(metrics.get("oscillationPenalty", 0.0)) * 8.0
    )


def _score_batch(metrics_batch: list[dict] | dict[str, np.ndarray], objective_weights: dict[str, float], xp) -> object:
    precision_weight = float(objective_weights.get("precision", 28)) / 100.0
    stability_weight = float(objective_weights.get("stability", 28)) / 100.0
    vibration_weight = float(objective_weights.get("vibration", 22)) / 100.0
    cycle_weight = float(objective_weights.get("cycle", 14)) / 100.0
    energy_weight = float(objective_weights.get("energy", 8)) / 100.0

    if isinstance(metrics_batch, dict):
        dynamic_peak = xp.asarray(metrics_batch["dynamicPeakError"], dtype=xp.float32)
        dynamic_mean = xp.asarray(metrics_batch["dynamicMeanError"], dtype=xp.float32)
        hold_peak = xp.asarray(metrics_batch["holdPeakError"], dtype=xp.float32)
        hold_peak_vel = xp.asarray(metrics_batch["holdPeakVelocity"], dtype=xp.float32)
        peak_vel = xp.asarray(metrics_batch["peakVelocity"], dtype=xp.float32)
        peak_tau = xp.asarray(metrics_batch["peakTorque"], dtype=xp.float32)
        settle_time = xp.asarray(metrics_batch["settleTime"], dtype=xp.float32)
        oscillation = xp.asarray(metrics_batch["oscillationPenalty"], dtype=xp.float32)
    else:
        dynamic_peak = xp.asarray(
            [float(item.get("dynamicPeakError", item.get("peakError", 0.0))) for item in metrics_batch],
            dtype=xp.float32,
        )
        dynamic_mean = xp.asarray(
            [float(item.get("dynamicMeanError", item.get("meanError", 0.0))) for item in metrics_batch],
            dtype=xp.float32,
        )
        hold_peak = xp.asarray([float(item.get("holdPeakError", 0.0)) for item in metrics_batch], dtype=xp.float32)
        hold_peak_vel = xp.asarray([float(item.get("holdPeakVelocity", 0.0)) for item in metrics_batch], dtype=xp.float32)
        peak_vel = xp.asarray([float(item.get("peakVelocity", 0.0)) for item in metrics_batch], dtype=xp.float32)
        peak_tau = xp.asarray([float(item.get("peakTorque", 0.0)) for item in metrics_batch], dtype=xp.float32)
        settle_time = xp.asarray([float(item.get("settleTime", 0.0)) for item in metrics_batch], dtype=xp.float32)
        oscillation = xp.asarray([float(item.get("oscillationPenalty", 0.0)) for item in metrics_batch], dtype=xp.float32)

    return (
        dynamic_peak * (420.0 * precision_weight)
        + dynamic_mean * (240.0 * precision_weight)
        + hold_peak * (520.0 * stability_weight)
        + hold_peak_vel * (100.0 * stability_weight)
        + peak_vel * (60.0 * vibration_weight)
        + peak_tau * (0.08 * energy_weight)
        + settle_time * (18.0 * cycle_weight)
        + oscillation * 8.0
    )


def _online_score_batch(metrics_batch: list[dict] | dict[str, np.ndarray], objective_weights: dict[str, float], xp) -> object:
    precision_weight = float(objective_weights.get("precision", 28)) / 100.0
    stability_weight = float(objective_weights.get("stability", 28)) / 100.0
    vibration_weight = float(objective_weights.get("vibration", 22)) / 100.0
    cycle_weight = float(objective_weights.get("cycle", 14)) / 100.0
    energy_weight = float(objective_weights.get("energy", 8)) / 100.0
    online_weights = ONLINE_RL_CONFIG.get("score_weights", {})

    dynamic_peak_weight = float(online_weights.get("dynamic_peak", 560.0))
    dynamic_mean_weight = float(online_weights.get("dynamic_mean", 320.0))
    hold_peak_weight = float(online_weights.get("hold_peak", 220.0))
    hold_velocity_weight = float(online_weights.get("hold_velocity", 40.0))
    peak_velocity_weight = float(online_weights.get("peak_velocity", 45.0))
    peak_torque_weight = float(online_weights.get("peak_torque", 0.03))
    settle_time_weight = float(online_weights.get("settle_time", 6.0))
    oscillation_weight = float(online_weights.get("oscillation", 6.0))

    if isinstance(metrics_batch, dict):
        dynamic_peak = xp.asarray(metrics_batch["dynamicPeakError"], dtype=xp.float32)
        dynamic_mean = xp.asarray(metrics_batch["dynamicMeanError"], dtype=xp.float32)
        hold_peak = xp.asarray(metrics_batch["holdPeakError"], dtype=xp.float32)
        hold_peak_vel = xp.asarray(metrics_batch["holdPeakVelocity"], dtype=xp.float32)
        peak_vel = xp.asarray(metrics_batch["peakVelocity"], dtype=xp.float32)
        peak_tau = xp.asarray(metrics_batch["peakTorque"], dtype=xp.float32)
        settle_time = xp.asarray(metrics_batch["settleTime"], dtype=xp.float32)
        oscillation = xp.asarray(metrics_batch["oscillationPenalty"], dtype=xp.float32)
    else:
        dynamic_peak = xp.asarray(
            [float(item.get("dynamicPeakError", item.get("peakError", 0.0))) for item in metrics_batch],
            dtype=xp.float32,
        )
        dynamic_mean = xp.asarray(
            [float(item.get("dynamicMeanError", item.get("meanError", 0.0))) for item in metrics_batch],
            dtype=xp.float32,
        )
        hold_peak = xp.asarray([float(item.get("holdPeakError", 0.0)) for item in metrics_batch], dtype=xp.float32)
        hold_peak_vel = xp.asarray([float(item.get("holdPeakVelocity", 0.0)) for item in metrics_batch], dtype=xp.float32)
        peak_vel = xp.asarray([float(item.get("peakVelocity", 0.0)) for item in metrics_batch], dtype=xp.float32)
        peak_tau = xp.asarray([float(item.get("peakTorque", 0.0)) for item in metrics_batch], dtype=xp.float32)
        settle_time = xp.asarray([float(item.get("settleTime", 0.0)) for item in metrics_batch], dtype=xp.float32)
        oscillation = xp.asarray([float(item.get("oscillationPenalty", 0.0)) for item in metrics_batch], dtype=xp.float32)

    return (
        dynamic_peak * (dynamic_peak_weight * precision_weight)
        + dynamic_mean * (dynamic_mean_weight * precision_weight)
        + hold_peak * (hold_peak_weight * stability_weight)
        + hold_peak_vel * (hold_velocity_weight * stability_weight)
        + peak_vel * (peak_velocity_weight * vibration_weight)
        + peak_tau * (peak_torque_weight * energy_weight)
        + settle_time * (settle_time_weight * cycle_weight)
        + oscillation * oscillation_weight
    )


def _metric_dict(metrics_batch: dict[str, np.ndarray] | list[dict], index: int) -> dict:
    if isinstance(metrics_batch, dict):
        return {
            "peakError": round(float(metrics_batch["peakError"][index]), 5),
            "meanError": round(float(metrics_batch["meanError"][index]), 5),
            "dynamicMeanError": round(float(metrics_batch["dynamicMeanError"][index]), 5),
            "dynamicPeakError": round(float(metrics_batch["dynamicPeakError"][index]), 5),
            "peakVelocity": round(float(metrics_batch["peakVelocity"][index]), 5),
            "peakTorque": round(float(metrics_batch["peakTorque"][index]), 3),
            "settleTime": round(float(metrics_batch["settleTime"][index]), 4),
            "oscillationPenalty": int(metrics_batch["oscillationPenalty"][index]),
            "stabilityIndex": round(float(metrics_batch["stabilityIndex"][index]), 3),
            "holdMeanError": round(float(metrics_batch["holdMeanError"][index]), 5),
            "holdPeakError": round(float(metrics_batch["holdPeakError"][index]), 5),
            "holdMeanVelocity": round(float(metrics_batch["holdMeanVelocity"][index]), 5),
            "holdPeakVelocity": round(float(metrics_batch["holdPeakVelocity"][index]), 5),
            "holdMeanTorque": round(float(metrics_batch["holdMeanTorque"][index]), 3),
            "holdPeakTorque": round(float(metrics_batch["holdPeakTorque"][index]), 3),
            "stable": bool(metrics_batch["stable"][index]),
        }
    return dict(metrics_batch[index])


def _optimizer_layout(base_gains: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mean_values: list[float] = []
    lower_bounds: list[float] = []
    upper_bounds: list[float] = []

    for joint_index, gain in enumerate(base_gains):
        bounds = controller_gain_bounds(joint_index, gain)
        mean_values.extend([float(gain["kp"]), float(gain["ki"]), float(gain["kd"])])
        lower_bounds.extend([float(bounds["kp_min"]), float(bounds["ki_min"]), float(bounds["kd_min"])])
        upper_bounds.extend([float(bounds["kp_max"]), float(bounds["ki_max"]), float(bounds["kd_max"])])

    return (
        np.asarray(mean_values, dtype=np.float32),
        np.asarray(lower_bounds, dtype=np.float32),
        np.asarray(upper_bounds, dtype=np.float32),
    )


def _initial_sigma(lower_bounds: np.ndarray, upper_bounds: np.ndarray, xp) -> object:
    bound_span = xp.asarray(upper_bounds - lower_bounds, dtype=xp.float32)
    min_std = xp.maximum(bound_span * float(CEM_CONFIG["min_std_ratio"]), 1.0e-3)
    max_std = xp.maximum(bound_span * float(CEM_CONFIG["max_std_ratio"]), min_std)
    sigma = xp.clip(bound_span * float(CEM_CONFIG["exploration_start"]), min_std, max_std)
    return sigma


def _roundtrip_candidates(samples, base_gains: list[dict]) -> list[list[dict]]:
    if cp is not None and isinstance(samples, cp.ndarray):  # type: ignore[attr-defined]
        matrix = cp.asnumpy(samples)
    else:
        matrix = np.asarray(samples, dtype=np.float32)

    candidates: list[list[dict]] = []
    for row in matrix:
        candidate: list[dict] = []
        for joint_index, base_gain in enumerate(base_gains):
            offset = joint_index * 3
            candidate.append(
                clamp_controller_gain(
                    joint_index,
                    {
                        **base_gain,
                        "kp": int(round(float(row[offset]))),
                        "ki": round(float(row[offset + 1]), 2),
                        "kd": int(round(float(row[offset + 2]))),
                    },
                )
            )
        candidates.append(candidate)
    return candidates


def _candidate_from_sample(sample, base_gains: list[dict]) -> list[dict]:
    if cp is not None and isinstance(sample, cp.ndarray):  # type: ignore[attr-defined]
        row = cp.asnumpy(sample)
    else:
        row = np.asarray(sample, dtype=np.float32)

    candidate: list[dict] = []
    for joint_index, base_gain in enumerate(base_gains):
        offset = joint_index * 3
        candidate.append(
            clamp_controller_gain(
                joint_index,
                {
                    **base_gain,
                    "kp": int(round(float(row[offset]))),
                    "ki": round(float(row[offset + 1]), 2),
                    "kd": int(round(float(row[offset + 2]))),
                },
            )
        )
    return candidate


def _sample_batch_spec(samples, base_gains: list[dict], xp) -> dict:
    kp = xp.rint(samples[:, 0::3]).astype(xp.float32)
    ki = samples[:, 1::3].astype(xp.float32)
    kd = xp.rint(samples[:, 2::3]).astype(xp.float32)
    force_limits = xp.asarray([abs(float(gain["forcerange"][1])) for gain in base_gains], dtype=xp.float32)
    return {
        "names": [str(gain["name"]) for gain in base_gains],
        "base_gains": [dict(gain) for gain in base_gains],
        "kp": kp,
        "ki": ki,
        "kd": kd,
        "force_limits": force_limits,
    }


def _host_vector(sample) -> np.ndarray:
    if cp is not None and isinstance(sample, cp.ndarray):  # type: ignore[attr-defined]
        return np.asarray(cp.asnumpy(sample), dtype=np.float32)
    return np.asarray(sample, dtype=np.float32)


def _scalar_score(value) -> float:
    if cp is not None and isinstance(value, cp.ndarray):  # type: ignore[attr-defined]
        host_value = cp.asnumpy(value)
        return float(np.asarray(host_value, dtype=np.float32).reshape(-1)[0])
    return float(np.asarray(value, dtype=np.float32).reshape(-1)[0])


def _inject_reference_samples(samples, mean, best_vector) -> object:
    if samples.shape[0] <= 0:
        return samples
    samples[0] = mean
    if best_vector is not None and samples.shape[0] > 1:
        samples[1] = best_vector
    return samples


def _topk_indices(scores, top_k: int, xp) -> list[int]:
    top_k = max(1, min(int(top_k), int(scores.shape[0])))
    if top_k >= int(scores.shape[0]):
        ordered = xp.argsort(scores)
    else:
        partial = xp.argpartition(scores, top_k - 1)[:top_k]
        ordered = partial[xp.argsort(scores[partial])]

    if cp is not None and isinstance(ordered, cp.ndarray):  # type: ignore[attr-defined]
        return [int(value) for value in cp.asnumpy(ordered)]
    return [int(value) for value in np.asarray(ordered)]


def _exploration_scale(round_index: int, rounds: int) -> float:
    start = float(CEM_CONFIG["exploration_start"])
    end = float(CEM_CONFIG["exploration_end"])
    if rounds <= 1:
        return end
    alpha = round_index / max(rounds - 1, 1)
    return max(end, start + (end - start) * alpha)


def _update_distribution(
    mean,
    sigma,
    elite_samples,
    lower_bounds,
    upper_bounds,
    round_index: int,
    rounds: int,
    improved: bool,
    xp,
):
    elite_mean = xp.mean(elite_samples, axis=0)
    elite_std = xp.std(elite_samples, axis=0)
    bound_span = upper_bounds - lower_bounds
    min_std = xp.maximum(bound_span * float(CEM_CONFIG["min_std_ratio"]), 1.0e-3)
    max_std = xp.maximum(bound_span * float(CEM_CONFIG["max_std_ratio"]), min_std)
    exploration = _exploration_scale(round_index, rounds)
    target_std = xp.clip(elite_std * exploration, min_std, max_std)

    freeze_round_ratio = float(CEM_CONFIG.get("freeze_round_ratio", 0.5))
    freeze_mode = round_index >= max(0, int(round(rounds * freeze_round_ratio)) - 1)
    if improved:
        mean_step = float(CEM_CONFIG.get("mean_step_improve", 0.55))
        sigma_shrink = float(CEM_CONFIG.get("sigma_shrink_improve", 0.94))
    elif freeze_mode:
        mean_step = float(CEM_CONFIG.get("mean_step_freeze", 0.06))
        sigma_shrink = float(CEM_CONFIG.get("sigma_shrink_freeze", 0.84))
    else:
        mean_step = float(CEM_CONFIG.get("mean_step_stable", 0.18))
        sigma_shrink = float(CEM_CONFIG.get("sigma_shrink_stable", 0.9))

    next_mean = mean + (elite_mean - mean) * mean_step
    next_mean = xp.clip(next_mean, lower_bounds, upper_bounds)
    next_sigma = sigma * sigma_shrink + target_std * (1.0 - sigma_shrink)
    next_sigma = xp.clip(next_sigma, min_std, max_std)
    return next_mean, next_sigma


def _pooled_elite_samples(candidate_pool: list[dict], elite_count: int, sample_width: int, xp):
    if not candidate_pool:
        return None
    pooled_multiplier = max(1, int(CEM_CONFIG.get("pool_elite_multiplier", 4)))
    pooled_count = min(len(candidate_pool), max(1, elite_count * pooled_multiplier))
    pooled_vectors = [
        np.asarray(candidate_pool[index]["vector"], dtype=np.float32).reshape(sample_width)
        for index in range(pooled_count)
    ]
    return xp.asarray(np.stack(pooled_vectors, axis=0), dtype=xp.float32)


def tune_controller(
    scene_xml: str,
    trajectory: dict,
    base_gains: list[dict],
    objective_weights: dict[str, float],
    rounds: int,
    trials_per_round: int,
    jobs: int,
    seed: int,
    control_mode: dict,
) -> tuple[list[dict], dict, dict]:
    xp, optimizer_backend = _optimizer_backend()
    graph_hint = "cuda-graph-ready" if cp is not None and xp is cp else "no-cuda-graph"
    best: dict | None = None
    best_gains = [dict(item) for item in base_gains]
    online_windows = _build_screen_windows(trajectory)
    total = rounds * trials_per_round * max(1, len(online_windows))
    completed = 0
    global_trial = 0

    online_keep_per_round = max(
        1,
        int(
            VALIDATION_CONFIG.get(
                "online_keep_per_round",
                VALIDATION_CONFIG.get("screen_keep_per_round", 64),
            )
        ),
    )
    final_refine_candidates = max(1, int(VALIDATION_CONFIG.get("final_refine_candidates", 64)))
    survivor_ratio = float(ONLINE_RL_CONFIG.get("survivor_ratio", 0.5))
    survivor_min = max(1, int(ONLINE_RL_CONFIG.get("survivor_min", 256)))
    window_keep_per_round = max(1, int(ONLINE_RL_CONFIG.get("window_keep_per_round", max(online_keep_per_round, 128))))
    elite_ratio = float(CEM_CONFIG["elite_ratio"])
    elite_count = max(
        int(SEARCH_CONFIG["elite_min"]),
        min(
            int(SEARCH_CONFIG["elite_max"]),
            max(1, int(round(trials_per_round * elite_ratio))),
        ),
    )

    mean_np, lower_np, upper_np = _optimizer_layout(base_gains)
    mean = xp.asarray(mean_np, dtype=xp.float32)
    lower_bounds = xp.asarray(lower_np, dtype=xp.float32)
    upper_bounds = xp.asarray(upper_np, dtype=xp.float32)
    sigma = _initial_sigma(lower_np, upper_np, xp)
    best_vector = mean.copy()
    candidate_pool: list[dict] = []

    emit_log(
        "INFO",
        "TUNE_BATCH_BACKEND",
        (
            f"mode={optimizer_backend}-online-rl-final-refine "
            f"jobs={jobs} envCount={trials_per_round} batchSize={trials_per_round} totalTrials={total} "
            f"eliteCount={elite_count} onlineKeepPerRound={online_keep_per_round} "
            f"finalRefineCandidates={final_refine_candidates} graphHint={graph_hint}"
        ),
    )

    if cp is not None and xp is cp:
        cp.random.seed(seed)
    else:
        np.random.seed(seed)

    for round_index in range(rounds):
        round_started_at = time.perf_counter()
        online_started_at = time.perf_counter()
        last_window_metrics: dict[str, np.ndarray] | None = None
        best_round_trial = -1
        best_round_score = float("inf")
        best_round_metrics: dict = {}
        pooled_count = 0
        improved_round = False
        round_survivors = trials_per_round
        for window_index, window_trajectory in enumerate(online_windows):
            prior_pool_best_score = float(candidate_pool[0]["score"]) if candidate_pool else float("inf")
            noise = xp.random.standard_normal((trials_per_round, mean.shape[0]), dtype=xp.float32)
            samples = mean[None, :] + noise * sigma[None, :]
            samples = xp.clip(samples, lower_bounds[None, :], upper_bounds[None, :])
            samples = _inject_reference_samples(samples, mean, best_vector)
            window_base_trial = global_trial + 1
            global_trial += int(samples.shape[0])

            window_spec = _sample_batch_spec(samples, base_gains, xp)
            window_metrics = evaluate_controller_candidates_batch(
                scene_xml,
                window_trajectory,
                window_spec,
                control_mode,
                profile="online",
                return_arrays=True,
            )
            last_window_metrics = window_metrics
            window_scores = _online_score_batch(window_metrics, objective_weights, xp)
            keep_target = min(window_keep_per_round, int(samples.shape[0]))
            keep_indices = _topk_indices(window_scores, keep_target, xp)
            pooled_count = max(pooled_count, len(keep_indices))
            round_survivors = keep_target

            for candidate_index in range(int(samples.shape[0])):
                completed += 1
                emit_progress(
                    "optimize",
                    (
                        f"Backend is running mjwarp online RL tuning round {round_index + 1}/{rounds}, "
                        f"window {window_index + 1}/{len(online_windows)}, trial {completed}/{total}"
                    ),
                    completed,
                    total,
                    best,
                )

            for candidate_index in keep_indices:
                candidate_metrics = _metric_dict(window_metrics, candidate_index)
                candidate_online_score = _scalar_score(window_scores[candidate_index])
                candidate_metrics["onlineScore"] = round(candidate_online_score, 5)
                candidate_pool.append(
                    {
                        "trial": window_base_trial + candidate_index,
                        "sample": _candidate_from_sample(samples[candidate_index], base_gains),
                        "vector": np.asarray(_host_vector(samples[candidate_index]), dtype=np.float32),
                        "score": candidate_online_score,
                        "metrics": candidate_metrics,
                    }
                )

            candidate_pool.sort(key=lambda item: item["score"])
            candidate_pool = candidate_pool[: max(final_refine_candidates * 4, online_keep_per_round)]
            if candidate_pool:
                best_vector = xp.asarray(candidate_pool[0]["vector"], dtype=xp.float32)
            pool_best_score = float(candidate_pool[0]["score"]) if candidate_pool else float("inf")
            improve_threshold_ratio = float(CEM_CONFIG.get("improve_threshold_ratio", 0.01))
            if np.isfinite(prior_pool_best_score):
                required_score = prior_pool_best_score * (1.0 - improve_threshold_ratio)
                improved = pool_best_score < required_score
            else:
                improved = True
            improved_round = improved_round or improved

            elite_indices = _topk_indices(window_scores, elite_count, xp)
            elite_samples = samples[elite_indices]
            pooled_elites = _pooled_elite_samples(candidate_pool, elite_count, int(mean.shape[0]), xp)
            distribution_elites = pooled_elites if pooled_elites is not None else elite_samples
            update_index = round_index * max(1, len(online_windows)) + window_index
            total_updates = max(1, rounds * max(1, len(online_windows)))
            mean, sigma = _update_distribution(
                mean,
                sigma,
                distribution_elites,
                lower_bounds,
                upper_bounds,
                update_index,
                total_updates,
                improved,
                xp,
            )

            best_window_index = keep_indices[0] if keep_indices else elite_indices[0]
            best_window_score = _scalar_score(window_scores[best_window_index])
            if best_window_score < best_round_score:
                best_round_score = best_window_score
                best_round_trial = window_base_trial + int(best_window_index)
                best_round_metrics = _metric_dict(window_metrics, best_window_index)
                best_round_metrics["onlineScore"] = round(best_window_score, 5)

        online_elapsed = time.perf_counter() - online_started_at
        if last_window_metrics is None:
            raise RuntimeError("Online RL evaluation did not produce any metrics.")
        round_elapsed = time.perf_counter() - round_started_at
        throughput = float(trials_per_round) / max(round_elapsed, 1.0e-6)
        terminated_ratio = 0.0
        pool_best_trial = best_round_trial
        pool_best_score = best_round_score
        if candidate_pool:
            pool_best_trial = int(candidate_pool[0]["trial"])
            pool_best_score = float(candidate_pool[0]["score"])
        if isinstance(last_window_metrics, dict) and "terminatedEarly" in last_window_metrics:
            terminated_ratio = float(np.asarray(last_window_metrics["terminatedEarly"], dtype=np.float32).mean())
        emit_log(
            "INFO",
            "TUNE_BATCH_DONE",
            (
                f"round={round_index + 1} envCount={trials_per_round} trials={trials_per_round * len(online_windows)} pooled={pooled_count} "
                f"batchBestTrial={best_round_trial} batchBestScore={best_round_score:.4f} "
                f"peakError={best_round_metrics['peakError']:.5f} holdPeakError={best_round_metrics['holdPeakError']:.5f} "
                f"poolBestTrial={pool_best_trial} poolBestScore={pool_best_score:.4f} "
                f"improved={int(improved_round)} "
                f"windows={len(online_windows)} survivors={round_survivors} "
                f"onlineSec={online_elapsed:.3f} refineSec=0.000 roundSec={round_elapsed:.3f} "
                f"throughput={throughput:.2f}env-round/s terminatedRatio={terminated_ratio:.3f} "
                f"backend={optimizer_backend}-online-rl"
            ),
        )
        time.sleep(0.01)

    if not candidate_pool:
        raise RuntimeError("mjwarp online RL optimization did not produce any candidate pool.")

    final_candidates = candidate_pool[:final_refine_candidates]
    emit_log(
        "INFO",
        "TUNE_FINAL_REFINE_START",
        (
            f"candidates={len(final_candidates)} backend={optimizer_backend}-final-mjwarp-full "
            f"sourcePool={len(candidate_pool)}"
        ),
    )
    final_spec = {
        "names": [str(gain["name"]) for gain in base_gains],
        "base_gains": [dict(gain) for gain in base_gains],
        "kp": xp.asarray(
            [[float(gain["kp"]) for gain in candidate["sample"]] for candidate in final_candidates],
            dtype=xp.float32,
        ),
        "ki": xp.asarray(
            [[float(gain["ki"]) for gain in candidate["sample"]] for candidate in final_candidates],
            dtype=xp.float32,
        ),
        "kd": xp.asarray(
            [[float(gain["kd"]) for gain in candidate["sample"]] for candidate in final_candidates],
            dtype=xp.float32,
        ),
        "force_limits": xp.asarray(
            [[abs(float(gain["forcerange"][1])) for gain in candidate["sample"]] for candidate in final_candidates],
            dtype=xp.float32,
        ),
    }
    refine_started_at = time.perf_counter()
    refined_metrics_batch = evaluate_controller_candidates_batch(
        scene_xml,
        trajectory,
        final_spec,
        control_mode,
        profile="full",
        return_arrays=True,
    )
    refine_elapsed = time.perf_counter() - refine_started_at
    refined_scores = _score_batch(refined_metrics_batch, objective_weights, xp)
    refined_order = _topk_indices(refined_scores, len(final_candidates), xp)

    for refined_rank in refined_order:
        refined_candidate = final_candidates[refined_rank]
        refined_metrics = _metric_dict(refined_metrics_batch, refined_rank)
        refined_score = float(_candidate_score(refined_metrics, objective_weights))
        trial_id = int(refined_candidate["trial"])
        if best is None or refined_score < best["score"]:
            best = {
                "trial": trial_id,
                "score": round(refined_score, 4),
                "metrics": refined_metrics,
                "backend": {"mode": f"{optimizer_backend}-online-rl-final-refine", "jobs": jobs, "profile": "full"},
            }
            best_gains = [dict(item) for item in refined_candidate["sample"]]
            best_vector = xp.asarray(refined_candidate["vector"], dtype=xp.float32)
            emit_log(
                "INFO",
            "TUNE_BEST",
            (
                f"trial={trial_id} peakError={refined_metrics['peakError']:.5f} "
                f"holdPeakError={refined_metrics['holdPeakError']:.5f} "
                f"backend={optimizer_backend}-online-rl-final-refine"
            ),
        )

    emit_log(
        "INFO",
        "TUNE_FINAL_REFINE_DONE",
        (
            f"candidates={len(final_candidates)} refineSec={refine_elapsed:.3f} "
            f"backend={optimizer_backend}-online-rl-final-refine"
        ),
    )

    if best is None:
        raise RuntimeError("Real mjwarp final refine did not produce any candidate result.")

    return best_gains, best["metrics"], best
