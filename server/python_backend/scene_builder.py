from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path

from runtime_config import load_runtime_config


RUNTIME_CONFIG = load_runtime_config()
ROBOT_MODEL_PATH = Path(__file__).resolve().parents[2] / "public" / "models" / "er15-1400.mjcf.xml"
JOINT_DYNAMICS = dict(RUNTIME_CONFIG.get("physics", {}).get("joint_dynamics", {}))


def _apply_joint_dynamics(raw_xml: str) -> str:
    if not JOINT_DYNAMICS:
        return raw_xml

    root = ET.fromstring(raw_xml)
    for joint in root.iter("joint"):
        joint_name = str(joint.get("name", "")).strip()
        dynamics = JOINT_DYNAMICS.get(joint_name)
        if not dynamics:
            continue
        for attr in ("damping", "frictionloss", "armature"):
            if attr in dynamics:
                joint.set(attr, str(float(dynamics[attr])))
    return ET.tostring(root, encoding="unicode")


def _robot_model_with_dynamics() -> str:
    return _apply_joint_dynamics(ROBOT_MODEL_PATH.read_text("utf8"))


def compile_scene(scene_prompt: str, task_prompt: str, scene_xml: str) -> tuple[str, dict]:
    summary = f"{scene_prompt} / {task_prompt}".strip(" /")
    snapshot = {
        "summary": summary or "Backend scene definition received.",
        "objects": [
            {"id": "pallet_source", "kind": "pallet"},
            {"id": "pallet_target", "kind": "pallet"},
            {"id": "box_payload", "kind": "box"},
        ],
    }
    if scene_xml:
        return scene_xml, snapshot
    return _robot_model_with_dynamics(), snapshot


def compile_tuning_scene() -> tuple[str, dict]:
    return (
        _robot_model_with_dynamics(),
        {
            "summary": "控制器整定使用纯机器人模型，并接入关节阻尼/摩擦参数，不加载场景物体。",
            "objects": [],
        },
    )
