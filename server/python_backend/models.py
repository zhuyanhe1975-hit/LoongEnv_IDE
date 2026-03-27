from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class JobPayload:
    job_id: str
    task_type: str
    scene_prompt: str
    task_prompt: str
    objective_prompt: str
    scene_xml: str
    objective_weights: dict[str, float]
    controller_gains: list[dict[str, Any]]
    ff_mode: str
    computed_torque: bool
    ideal_actuation: bool
    trajectory_hint: dict[str, Any] | None
    jobs: int
    rounds: int
    trials_per_round: int
    seed: int
