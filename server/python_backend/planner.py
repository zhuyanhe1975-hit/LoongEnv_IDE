from __future__ import annotations

import math

from runtime_config import load_runtime_config

RUNTIME_CONFIG = load_runtime_config()
PLANNER_CONFIG = RUNTIME_CONFIG["planner"]
TUNING_CONFIG = PLANNER_CONFIG["tuning_validation"]
HOME_JOINTS = [float(value) for value in PLANNER_CONFIG["home_joints"]]


def default_full_task_trajectory() -> dict:
    samples = [dict(sample) for sample in PLANNER_CONFIG["full_task"]["samples"]]
    return {
        "summary": "Backend full-task trajectory generated for authoritative execution and replay.",
        "profile": "mjwarp backend full-task execution",
        "planner": "Backend planner / Planner Authority",
        "parameterization": "Backend timing / Time Authority",
        "controller": "Backend joint servo / Backend Servo",
        "gripperMode": "Backend suction grasp",
        "clearance": "Backend unified collision validation",
        "transferMode": "pick-transfer-place",
        "cycleTime": "optimized for stability",
        "smoothness": "backend-smoothed trajectory",
        "accuracy": "authoritative backend validation",
        "pickupBoxId": "box_payload",
        "waypoints": [
            {"name": "approach", "pose": "source", "note": "Approach the pickup workstation."},
            {"name": "pick", "pose": "pick", "note": "Grasp the target in closed loop."},
            {"name": "place", "pose": "place", "note": "Transfer and place on the target pallet."},
        ],
        "phases": [
            {"name": "plan", "focus": "trajectory generation", "speed": "offline", "note": "Generate executable task trajectory."},
            {"name": "execute", "focus": "tracking", "speed": "medium", "note": "Execute with backend controller."},
            {"name": "hold", "focus": "final hold", "speed": "low", "note": "Validate steady-state stability."},
        ],
        "samples": samples,
    }


def _build_cosine_trajectory(
    *,
    duration: float,
    dt: float,
    amplitudes: list[float],
    phases: list[float],
    cycles: float,
    hold_duration: float,
    label: str,
    summary: str,
    transfer_mode: str,
    smoothness: str,
    waypoints: list[dict],
    phases_meta: list[dict],
) -> dict:
    step_count = max(1, int(round(duration / dt)))
    samples = [
        {
            "time": 0.0,
            "joints": [round(value, 6) for value in HOME_JOINTS],
            "suction": False,
            "label": label,
        }
    ]

    for step_index in range(1, step_count + 1):
        alpha = step_index / step_count
        sample_time = duration * alpha
        joints = []
        for joint_index, center in enumerate(HOME_JOINTS):
            phase = phases[joint_index] + 2.0 * math.pi * cycles * alpha
            joint_value = center + amplitudes[joint_index] * 0.5 * (1.0 - math.cos(phase))
            joints.append(round(joint_value, 6))
        samples.append(
            {
                "time": round(sample_time, 4),
                "joints": joints,
                "suction": False,
                "label": label,
            }
        )

    if hold_duration > 0.0:
        hold_steps = max(1, int(round(hold_duration / dt)))
        last_joints = list(samples[-1]["joints"])
        base_time = float(samples[-1]["time"])
        for hold_index in range(1, hold_steps + 1):
            samples.append(
                {
                    "time": round(base_time + hold_index * dt, 4),
                    "joints": [round(value, 6) for value in last_joints],
                    "suction": False,
                    "label": "validate-hold-entry",
                }
            )

    return {
        "summary": summary,
        "profile": "mjwarp backend cosine validation",
        "planner": "Backend validation trajectory / Validation Authority",
        "parameterization": "Fixed timestep / Time Authority",
        "controller": "Backend joint servo / Backend Servo",
        "gripperMode": "Suction idle",
        "clearance": "Controller validation uses the pure robot model only and excludes scene objects.",
        "transferMode": transfer_mode,
        "cycleTime": f"{duration:g} s",
        "smoothness": smoothness,
        "accuracy": "authoritative backend replay",
        "pickupBoxId": None,
        "waypoints": waypoints,
        "phases": phases_meta,
        "samples": samples,
    }


def default_tuning_trajectory(trajectory_hint: str | None = None) -> dict:
    duration = float(TUNING_CONFIG["duration"])
    dt = float(TUNING_CONFIG.get("dt", PLANNER_CONFIG["segment_dt"]))
    cycles = float(TUNING_CONFIG.get("cycles", 1.0))
    amplitudes = [float(value) for value in TUNING_CONFIG["amplitudes"]]
    phases = [float(value) for value in TUNING_CONFIG.get("phases", [0.0] * len(HOME_JOINTS))]
    hold_duration = float(TUNING_CONFIG.get("hold_duration", 0.0))

    if trajectory_hint == "joint2_stiction_probe":
        probe_amplitudes = [0.0 for _ in HOME_JOINTS]
        probe_amplitudes[1] = 0.22
        probe_phases = [0.0 for _ in HOME_JOINTS]
        return _build_cosine_trajectory(
            duration=8.0,
            dt=dt,
            amplitudes=probe_amplitudes,
            phases=probe_phases,
            cycles=2.0,
            hold_duration=0.0,
            label="joint2-stiction-probe",
            summary="Backend joint_2 low-speed reversal probe on the pure robot model.",
            transfer_mode="joint_2 low-speed reversal probe",
            smoothness="Two low-speed cosine cycles with repeated direction reversals near zero velocity.",
            waypoints=[
                {"name": "start", "pose": "home", "note": "Start from the home pose with zero velocity."},
                {"name": "probe", "pose": "joint2-probe", "note": "Only joint_2 moves to expose stiction during reversals."},
                {"name": "end", "pose": "final", "note": "Return to zero velocity at the end of the probe."},
            ],
            phases_meta=[
                {"name": "probe", "focus": "joint_2 stiction", "speed": "low", "note": "Observe torque response around repeated low-speed reversals."},
            ],
        )

    return _build_cosine_trajectory(
        duration=duration,
        dt=dt,
        amplitudes=amplitudes,
        phases=phases,
        cycles=cycles,
        hold_duration=hold_duration,
        label="validate-cosine",
        summary="Backend controller tuning uses a simple 5 second cosine reference on the pure robot model.",
        transfer_mode="single cosine reference",
        smoothness="Cosine joint trajectory with zero velocity at the start and the end.",
        waypoints=[
            {"name": "start", "pose": "home", "note": "Start from the home pose with zero velocity."},
            {"name": "cosine", "pose": "cosine", "note": "All joints follow a safe single-cycle cosine reference."},
            {"name": "end", "pose": "final", "note": "Return to zero speed at the end of the cycle."},
        ],
        phases_meta=[
            {"name": "tune", "focus": "parameter search", "speed": "offline", "note": "Batch parameter search on the backend."},
            {"name": "validate", "focus": "cosine replay", "speed": "medium", "note": "Validate against the continuous cosine joint reference."},
        ],
    )
