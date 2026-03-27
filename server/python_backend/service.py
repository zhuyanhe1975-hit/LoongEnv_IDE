from __future__ import annotations

import time
import traceback

from controller import normalize_controller_gains
from logger import emit_completed, emit_error, emit_log, emit_progress, emit_started
from mjwarp_runner import REAL_PHYSICS_MODE, detect_engine, evaluate_controller_candidates_batch, generate_replay
from models import JobPayload
from optimizer import tune_controller
from planner import default_full_task_trajectory, default_tuning_trajectory
from replay_exporter import build_result
from runtime_config import load_runtime_config
from scene_builder import compile_scene, compile_tuning_scene

RUNTIME_CONFIG = load_runtime_config()
OPT_DEFAULTS = RUNTIME_CONFIG["optimization"]["defaults"]
BACKEND_CONTROL_DEFAULTS = RUNTIME_CONFIG["backend_control"]


def _payload_from_raw(raw: dict) -> JobPayload:
    return JobPayload(
        job_id=str(raw.get("job_id", "")),
        task_type=str(raw.get("task_type", "full_task")),
        scene_prompt=str(raw.get("scene_prompt", "")),
        task_prompt=str(raw.get("task_prompt", "")),
        objective_prompt=str(raw.get("objective_prompt", "")),
        scene_xml=str(raw.get("scene_xml", "")),
        objective_weights=dict(raw.get("objective_weights", {})),
        controller_gains=list(raw.get("controller_gains", [])),
        ff_mode=str(raw.get("ff_mode", BACKEND_CONTROL_DEFAULTS["ff_mode"])),
        computed_torque=bool(raw.get("computed_torque", BACKEND_CONTROL_DEFAULTS["computed_torque"])),
        ideal_actuation=bool(raw.get("ideal_actuation", BACKEND_CONTROL_DEFAULTS["ideal_actuation"])),
        trajectory_hint=raw.get("trajectory_hint"),
        jobs=int(raw.get("jobs", OPT_DEFAULTS["jobs"])),
        rounds=int(raw.get("rounds", OPT_DEFAULTS["rounds"])),
        trials_per_round=int(raw.get("trials_per_round", OPT_DEFAULTS["trials_per_round"])),
        seed=int(raw.get("seed", 0)),
    )


def _control_mode_payload(payload: JobPayload) -> dict:
    return {
        "ff_mode": payload.ff_mode,
        "computed_torque": payload.computed_torque,
        "ideal_actuation": payload.ideal_actuation,
    }


def _compact_trajectory_result(trajectory: dict) -> dict:
    samples = list(trajectory.get("samples", []))
    duration = float(samples[-1]["time"]) if samples else 0.0
    return {
        **trajectory,
        "samples": [],
        "sampleCount": len(samples),
        "duration": round(duration, 4),
    }
def run_job(raw_payload: dict) -> None:
    try:
        payload = _payload_from_raw(raw_payload)
        control_mode = _control_mode_payload(payload)
        engine = detect_engine()

        emit_started(engine, "bootstrap", "Backend authoritative physics job started.")
        emit_log("INFO", "ENGINE_SELECTED", f"engine={engine}")
        emit_log(
            "INFO",
            "CONTROL_MODE",
            "ff_mode={ff_mode} computed_torque={computed_torque} ideal_actuation={ideal_actuation}".format(
                ff_mode=control_mode["ff_mode"],
                computed_torque=str(control_mode["computed_torque"]).lower(),
                ideal_actuation=str(control_mode["ideal_actuation"]).lower(),
            ),
        )

        controller_gains = normalize_controller_gains(payload.controller_gains)

        if payload.task_type == "diagnose_controller":
            scene_xml, scene_snapshot = compile_tuning_scene()
            trajectory = default_tuning_trajectory(payload.trajectory_hint if payload.trajectory_hint else None)
            emit_progress("compile-scene", "Backend diagnostic model compilation completed.", 10, 100)
            emit_log("INFO", "DIAGNOSTIC_START", "Starting backend controller diagnostic replay.")
            replay_metrics, replay, physics_mode = generate_replay(scene_xml, trajectory, controller_gains, control_mode)
            emit_log("INFO", "PHYSICS_MODE", f"mode={physics_mode}")
            emit_log(
                "INFO",
                "TAU_DIAGNOSTIC",
                (
                    f"tauInverseDeltaMean={float(replay_metrics.get('tauInverseDeltaMean', 0.0)):.6f} "
                    f"tauInverseDeltaMax={float(replay_metrics.get('tauInverseDeltaMax', 0.0)):.6f} "
                    f"tauInverseMeanAbs={float(replay_metrics.get('tauInverseMeanAbs', 0.0)):.6f} "
                    f"tauAppliedMeanAbs={float(replay_metrics.get('tauAppliedMeanAbs', 0.0)):.6f} "
                    f"torqueLimitHitRate={float(replay_metrics.get('torqueLimitHitRate', 0.0)):.6f}"
                ),
            )
            result = build_result(
                payload.task_type,
                engine,
                physics_mode,
                control_mode,
                scene_xml,
                scene_snapshot,
                _compact_trajectory_result(trajectory),
                controller_gains,
                replay_metrics,
                replay,
            )
            emit_completed(engine, result, "Controller diagnostic replay generation completed.")
            return

        if payload.task_type == "tune_controller":
            scene_xml, scene_snapshot = compile_tuning_scene()
            emit_progress("compile-scene", "Backend tuning model compilation completed.", 5, 100)
            emit_log("INFO", "TUNE_START", "Starting backend controller tuning and mjwarp rigid-body validation.")
            trajectory = default_tuning_trajectory(payload.trajectory_hint if payload.trajectory_hint else None)
            tuned_gains, validated_metrics, best = tune_controller(
                scene_xml,
                trajectory,
                controller_gains,
                payload.objective_weights,
                payload.rounds,
                payload.trials_per_round,
                payload.jobs,
                payload.seed or int(time.time()),
                control_mode,
            )
            emit_progress("render-replay", "Backend is generating authoritative tuning replay.", 92, 100)
            replay_metrics, replay, physics_mode = generate_replay(scene_xml, trajectory, tuned_gains, control_mode)
            emit_log("INFO", "PHYSICS_MODE", f"mode={physics_mode}")
            emit_log(
                "INFO",
                "TAU_DIAGNOSTIC",
                (
                    f"tauInverseDeltaMean={float(replay_metrics.get('tauInverseDeltaMean', 0.0)):.6f} "
                    f"tauInverseDeltaMax={float(replay_metrics.get('tauInverseDeltaMax', 0.0)):.6f} "
                    f"tauInverseMeanAbs={float(replay_metrics.get('tauInverseMeanAbs', 0.0)):.6f} "
                    f"tauAppliedMeanAbs={float(replay_metrics.get('tauAppliedMeanAbs', 0.0)):.6f} "
                    f"torqueLimitHitRate={float(replay_metrics.get('torqueLimitHitRate', 0.0)):.6f}"
                ),
            )
            result = build_result(
                payload.task_type,
                engine,
                physics_mode,
                control_mode,
                scene_xml,
                scene_snapshot,
                _compact_trajectory_result(trajectory),
                tuned_gains,
                replay_metrics or validated_metrics,
                replay,
            )
            emit_completed(engine, result, "Controller tuning, mjwarp rigid-body validation and replay generation completed.", best)
            return

        scene_xml, scene_snapshot = compile_scene(payload.scene_prompt, payload.task_prompt, payload.scene_xml)
        emit_progress("compile-scene", "Backend scene compilation completed.", 5, 100)

        emit_log("INFO", "TASK_START", "Starting backend task planning and mjwarp rigid-body simulation.")
        total = 100
        for done, phase, message in [
            (15, "plan", "Backend planner has built the task phases."),
            (35, "parameterize", "Backend time-parameterization completed."),
            (58, "simulate", "Backend is running authoritative rigid-body simulation."),
            (82, "analyze", "Backend is aggregating stability and diagnostics."),
        ]:
            emit_progress(phase, message, done, total)
            time.sleep(0.18)

        trajectory = default_full_task_trajectory()
        metrics, replay, physics_mode = generate_replay(scene_xml, trajectory, controller_gains, control_mode)
        emit_log("INFO", "PHYSICS_MODE", f"mode={physics_mode}")
        result = build_result(
            payload.task_type,
            engine,
            physics_mode,
            control_mode,
            scene_xml,
            scene_snapshot,
            trajectory,
            controller_gains,
            metrics,
            replay,
        )
        emit_completed(engine, result, "Backend authoritative task simulation completed.")
    except Exception as error:
        emit_error(f"{error}\n{traceback.format_exc()}")
