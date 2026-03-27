import json
import sys
import xml.etree.ElementTree as ET
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY_BACKEND = ROOT / "server" / "python_backend"
if str(PY_BACKEND) not in sys.path:
    sys.path.insert(0, str(PY_BACKEND))

from mjwarp_runner import evaluate_controller_candidates_batch
from planner import default_tuning_trajectory
from runtime_config import load_runtime_config


def apply_joint_dynamics(raw_xml: str, joint_dynamics: dict[str, dict[str, float]]) -> str:
    root = ET.fromstring(raw_xml)
    for joint in root.iter("joint"):
        name = str(joint.get("name", "")).strip()
        if name not in joint_dynamics:
            continue
        for attr in ("damping", "frictionloss", "armature"):
            if attr in joint_dynamics[name]:
                joint.set(attr, str(float(joint_dynamics[name][attr])))
            elif attr in joint.attrib:
                joint.attrib.pop(attr, None)
    return ET.tostring(root, encoding="unicode")


def build_candidate_spec(base: list[dict]) -> dict:
    return {
        "names": [item["name"] for item in base],
        "base_gains": deepcopy(base),
        "kp": [[float(item["kp"]) for item in base]],
        "ki": [[float(item["ki"]) for item in base]],
        "kd": [[float(item["kd"]) for item in base]],
        "force_limits": [[abs(float(item["forcerange"][1])) for item in base]],
    }


def simplify(metrics: dict) -> dict:
    output = {}
    for key, value in metrics.items():
        output[key] = bool(value[0]) if str(value.dtype) == "bool" else float(value[0])
    return output


def main() -> None:
    config = load_runtime_config()
    raw_xml = (ROOT / "public" / "models" / "er15-1400.mjcf.xml").read_text("utf8")
    baseline = config["servo"]["baseline"]
    candidate_spec = build_candidate_spec(baseline)
    control_mode = {
        "ff_mode": config["backend_control"]["ff_mode"],
        "computed_torque": config["backend_control"]["computed_torque"],
        "ideal_actuation": config["backend_control"]["ideal_actuation"],
    }
    trajectory = default_tuning_trajectory()

    current_dynamics = deepcopy(config["physics"]["joint_dynamics"])
    industrial_dynamics = {
        "joint_1": {"damping": 8.0, "frictionloss": 3.2, "armature": 0.08},
        "joint_2": {"damping": 9.0, "frictionloss": 3.6, "armature": 0.08},
        "joint_3": {"damping": 8.5, "frictionloss": 3.0, "armature": 0.07},
        "joint_4": {"damping": 2.8, "frictionloss": 0.9, "armature": 0.02},
        "joint_5": {"damping": 2.0, "frictionloss": 0.5, "armature": 0.015},
        "joint_6": {"damping": 0.8, "frictionloss": 0.18, "armature": 0.006},
    }

    scenarios = {
        "no_dynamics": {},
        "current_dynamics": current_dynamics,
        "industrial_dynamics": industrial_dynamics,
    }

    results = {}
    for name, dynamics in scenarios.items():
        scene_xml = apply_joint_dynamics(raw_xml, dynamics)
        metrics = evaluate_controller_candidates_batch(
            scene_xml,
            trajectory,
            candidate_spec,
            control_mode,
            profile="full",
            return_arrays=True,
        )
        results[name] = simplify(metrics)

    print(
        json.dumps(
            {
                "control_mode": control_mode,
                "scenarios": results,
                "industrial_dynamics": industrial_dynamics,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
