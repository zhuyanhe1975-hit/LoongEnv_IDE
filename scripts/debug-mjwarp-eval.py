import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY_BACKEND = ROOT / "server" / "python_backend"
if str(PY_BACKEND) not in sys.path:
    sys.path.insert(0, str(PY_BACKEND))

from mjwarp_runner import evaluate_controller_candidates_batch
from planner import default_tuning_trajectory
from runtime_config import load_runtime_config


def main() -> None:
    root = ROOT
    xml = (root / "public" / "models" / "er15-1400.mjcf.xml").read_text("utf8")
    config = load_runtime_config()
    base = config["servo"]["baseline"]
    spec = {
        "names": [item["name"] for item in base],
        "base_gains": base,
        "kp": [[float(item["kp"]) for item in base]],
        "ki": [[float(item["ki"]) for item in base]],
        "kd": [[float(item["kd"]) for item in base]],
        "force_limits": [[abs(float(item["forcerange"][1])) for item in base]],
    }
    metrics = evaluate_controller_candidates_batch(
        xml,
        default_tuning_trajectory(),
        spec,
        {"ff_mode": "ref", "computed_torque": False, "ideal_actuation": False},
        profile="screen",
        return_arrays=True,
    )
    print(
        json.dumps(
            {
                key: (bool(value[0]) if str(value.dtype) == "bool" else float(value[0]))
                for key, value in metrics.items()
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
