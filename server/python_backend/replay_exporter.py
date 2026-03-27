from __future__ import annotations


def build_result(
    task_type: str,
    engine: str,
    physics_mode: str,
    control_mode: dict,
    scene_xml: str,
    scene_snapshot: dict,
    trajectory: dict,
    controller_gains: list[dict],
    metrics: dict,
    replay: dict | None,
) -> dict:
    return {
        "task_type": task_type,
        "engine": engine,
        "physics_mode": physics_mode,
        "control_mode": control_mode,
        "scene_xml": scene_xml,
        "scene_snapshot": scene_snapshot,
        "trajectory": trajectory,
        "controller_gains": controller_gains,
        "metrics": metrics,
        "stability_metrics": {
            "holdMeanError": metrics.get("holdMeanError", 0),
            "holdPeakError": metrics.get("holdPeakError", 0),
            "holdMeanVelocity": metrics.get("holdMeanVelocity", 0),
            "holdPeakVelocity": metrics.get("holdPeakVelocity", 0),
            "holdMeanTorque": metrics.get("holdMeanTorque", 0),
            "holdPeakTorque": metrics.get("holdPeakTorque", 0),
            "stable": metrics.get("stable", False),
        },
        "collision_events": [],
        "warnings_errors": [],
        "replay": replay,
        "summary": trajectory.get("summary", "后端权威任务已完成。"),
    }
