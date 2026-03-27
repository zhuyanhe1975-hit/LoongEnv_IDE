from __future__ import annotations

import argparse
import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY_BACKEND = ROOT / "server" / "python_backend"
if str(PY_BACKEND) not in sys.path:
    sys.path.insert(0, str(PY_BACKEND))

from runtime import inject_backend_site_packages, inject_cuda_runtime_dlls

inject_cuda_runtime_dlls()
inject_backend_site_packages()

import numpy as np
import mujoco  # type: ignore
import mujoco_warp as mjw  # type: ignore
import warp as wp  # type: ignore

from mjwarp_runner import _compose_tau, _prepare_control
from mjwarp_runner import _build_schedule
from planner import default_tuning_trajectory
from runtime_config import load_runtime_config


ROBOT_MODEL_PATH = ROOT / "public" / "models" / "er15-1400.mjcf.xml"
MODEL_ASSET_DIR = ROBOT_MODEL_PATH.parent
CONFIG = load_runtime_config()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", type=str, default="cuda:0")
    parser.add_argument("--world-count", type=int, default=8192)
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--dt", type=float, default=0.002)
    parser.add_argument(
        "--modes",
        type=str,
        default="step_only,inverse_only,step_inverse,step_inverse_control,step_inverse_control_traj",
        help="Comma-separated modes.",
    )
    parser.add_argument("--capture", action="store_true", default=True)
    return parser.parse_args()


def prepare_xml() -> str:
    root = ET.fromstring(ROBOT_MODEL_PATH.read_text("utf8"))
    compiler = root.find("compiler")
    if compiler is None:
        compiler = ET.Element("compiler")
        root.insert(0, compiler)
    compiler.set("meshdir", str(MODEL_ASSET_DIR))
    compiler.set("assetdir", str(MODEL_ASSET_DIR))
    compiler.set("texturedir", str(MODEL_ASSET_DIR))
    return ET.tostring(root, encoding="unicode")


def load_model_data(world_count: int):
    xml_text = prepare_xml()
    mjm = mujoco.MjModel.from_xml_string(xml_text)
    mjd = mujoco.MjData(mjm)
    model = mjw.put_model(mjm)
    data = mjw.put_data(mjm, mjd, nworld=world_count)
    return mjm, mjd, model, data


def reset_state(data, qpos_init: np.ndarray, qvel_init: np.ndarray) -> None:
    data.qpos.assign(qpos_init)
    data.qvel.assign(qvel_init)
    data.qacc.zero_()
    data.ctrl.zero_()
    data.qfrc_applied.zero_()
    data.qfrc_inverse.zero_()


def baseline_state(mjd, world_count: int, joint_home: list[float]) -> tuple[np.ndarray, np.ndarray]:
    qpos = np.repeat(mjd.qpos[None, :].astype(np.float32), world_count, axis=0)
    qvel = np.zeros((world_count, mjd.qvel.shape[0]), dtype=np.float32)
    qpos[:, : len(joint_home)] = np.asarray(joint_home, dtype=np.float32)[None, :]
    return qpos, qvel


def control_buffers(world_count: int, joint_count: int, target_q: np.ndarray, schedule: dict | None = None):
    kp = np.repeat(
        np.asarray([[float(item["kp"]) for item in CONFIG["servo"]["baseline"]]], dtype=np.float32),
        world_count,
        axis=0,
    )
    ki = np.repeat(
        np.asarray([[float(item["ki"]) for item in CONFIG["servo"]["baseline"]]], dtype=np.float32),
        world_count,
        axis=0,
    )
    kd = np.repeat(
        np.asarray([[float(item["kd"]) for item in CONFIG["servo"]["baseline"]]], dtype=np.float32),
        world_count,
        axis=0,
    )
    force_limits = np.repeat(
        np.asarray([[abs(float(item["forcerange"][1])) for item in CONFIG["servo"]["baseline"]]], dtype=np.float32),
        world_count,
        axis=0,
    )
    if schedule is None:
        q_ref = np.repeat(target_q[None, :].astype(np.float32), 1, axis=0)
        qd_ref = np.zeros((1, joint_count), dtype=np.float32)
        qdd_ref = np.zeros((1, joint_count), dtype=np.float32)
    else:
        q_ref = np.asarray(schedule["q_ref"], dtype=np.float32)
        qd_ref = np.asarray(schedule["qd_ref"], dtype=np.float32)
        qdd_ref = np.asarray(schedule["qdd_ref"], dtype=np.float32)
    return {
        "kp": wp.array(kp, dtype=float),
        "ki": wp.array(ki, dtype=float),
        "kd": wp.array(kd, dtype=float),
        "force_limits": wp.array(force_limits, dtype=float),
        "q_ref": wp.array(q_ref, dtype=float),
        "qd_ref": wp.array(qd_ref, dtype=float),
        "qdd_ref": wp.array(qdd_ref, dtype=float),
        "integral_error": wp.zeros((world_count, joint_count), dtype=float),
        "tau_fb": wp.zeros((world_count, joint_count), dtype=float),
    }


def control_step_buffers(world_count: int, joint_count: int, schedule: dict):
    buffers = control_buffers(world_count, joint_count, np.asarray(schedule["q_ref"][0], dtype=np.float32))
    buffers["schedule_q_ref"] = np.asarray(schedule["q_ref"], dtype=np.float32)
    buffers["schedule_qd_ref"] = np.asarray(schedule["qd_ref"], dtype=np.float32)
    buffers["schedule_qdd_ref"] = np.asarray(schedule["qdd_ref"], dtype=np.float32)
    buffers["q_ref_step"] = wp.array(buffers["schedule_q_ref"][0:1], dtype=float)
    buffers["qd_ref_step"] = wp.array(buffers["schedule_qd_ref"][0:1], dtype=float)
    buffers["qdd_ref_step"] = wp.array(buffers["schedule_qdd_ref"][0:1], dtype=float)
    return buffers


def capture_graph(fn):
    with wp.ScopedCapture() as capture:
        fn()
    return capture.graph


def run_graph(graph, steps: int) -> float:
    started_at = time.perf_counter()
    for _ in range(steps):
        wp.capture_launch(graph)
    wp.synchronize()
    return time.perf_counter() - started_at


def benchmark_step_only(model, data, args) -> dict:
    def op():
        mjw.step(model, data)

    graph = capture_graph(op) if args.capture and str(args.device).startswith("cuda") else None
    elapsed = run_graph(graph, args.steps) if graph is not None else _run_loop(op, args.steps)
    return format_result("step_only", elapsed, args.world_count, args.steps, args.dt)


def benchmark_inverse_only(model, data, args) -> dict:
    def op():
        mjw.inverse(model, data)

    graph = capture_graph(op) if args.capture and str(args.device).startswith("cuda") else None
    elapsed = run_graph(graph, args.steps) if graph is not None else _run_loop(op, args.steps)
    return format_result("inverse_only", elapsed, args.world_count, args.steps, args.dt)


def benchmark_step_inverse(model, data, args) -> dict:
    def op():
        mjw.inverse(model, data)
        mjw.step(model, data)

    graph = capture_graph(op) if args.capture and str(args.device).startswith("cuda") else None
    elapsed = run_graph(graph, args.steps) if graph is not None else _run_loop(op, args.steps)
    return format_result("step_inverse", elapsed, args.world_count, args.steps, args.dt)


def benchmark_step_inverse_control(model, data, args, control) -> dict:
    world_count = args.world_count
    joint_count = data.qvel.shape[1]

    def op():
        wp.launch(
            _prepare_control,
            dim=(world_count, joint_count),
            inputs=[
                data.qpos,
                data.qvel,
                data.qacc,
                control["integral_error"],
                control["tau_fb"],
                control["q_ref"],
                control["qd_ref"],
                control["qdd_ref"],
                control["kp"],
                control["ki"],
                control["kd"],
                0.5,
                0,
                args.dt,
                1,
            ],
        )
        mjw.inverse(model, data)
        wp.launch(
            _compose_tau,
            dim=(world_count, joint_count),
            inputs=[data.qfrc_inverse, data.qfrc_applied, control["tau_fb"], control["force_limits"], 1],
        )
        mjw.step(model, data)

    graph = capture_graph(op) if args.capture and str(args.device).startswith("cuda") else None
    elapsed = run_graph(graph, args.steps) if graph is not None else _run_loop(op, args.steps)
    return format_result("step_inverse_control", elapsed, args.world_count, args.steps, args.dt)


def benchmark_step_inverse_control_traj(model, data, args, control, schedule) -> dict:
    world_count = args.world_count
    joint_count = data.qvel.shape[1]
    schedule_steps = int(schedule["step_count"])
    max_steps = min(int(args.steps), schedule_steps)

    def run_once():
        wp.launch(
            _prepare_control,
            dim=(world_count, joint_count),
            inputs=[
                data.qpos,
                data.qvel,
                data.qacc,
                control["integral_error"],
                control["tau_fb"],
                control["q_ref_step"],
                control["qd_ref_step"],
                control["qdd_ref_step"],
                control["kp"],
                control["ki"],
                control["kd"],
                0.5,
                0,
                args.dt,
                1,
            ],
        )
        mjw.inverse(model, data)
        wp.launch(
            _compose_tau,
            dim=(world_count, joint_count),
            inputs=[data.qfrc_inverse, data.qfrc_applied, control["tau_fb"], control["force_limits"], 1],
        )
        mjw.step(model, data)

    graph = capture_graph(run_once) if args.capture and str(args.device).startswith("cuda") else None
    started_at = time.perf_counter()
    for step_id in range(max_steps):
        control["q_ref_step"].assign(control["schedule_q_ref"][step_id : step_id + 1])
        control["qd_ref_step"].assign(control["schedule_qd_ref"][step_id : step_id + 1])
        control["qdd_ref_step"].assign(control["schedule_qdd_ref"][step_id : step_id + 1])
        if graph is not None:
            wp.capture_launch(graph)
        else:
            run_once()
    wp.synchronize()
    elapsed = time.perf_counter() - started_at

    return format_result("step_inverse_control_traj", elapsed, args.world_count, max_steps, args.dt)


def _run_loop(fn, steps: int) -> float:
    started_at = time.perf_counter()
    for _ in range(steps):
        fn()
    wp.synchronize()
    return time.perf_counter() - started_at


def format_result(mode: str, elapsed: float, world_count: int, steps: int, dt: float) -> dict:
    total_steps = world_count * steps
    return {
        "mode": mode,
        "worldCount": world_count,
        "steps": steps,
        "dt": dt,
        "elapsedSec": round(elapsed, 6),
        "stepsPerSec": round(total_steps / max(elapsed, 1.0e-9), 1),
        "realtimeFactor": round((total_steps * dt) / max(elapsed, 1.0e-9), 2),
        "timePerWorldStepNs": round(elapsed / max(total_steps, 1) * 1.0e9, 3),
    }


def main() -> int:
    args = parse_args()
    wp.init()
    modes = [item.strip() for item in args.modes.split(",") if item.strip()]
    trajectory = default_tuning_trajectory()
    joint_home = [float(value) for value in trajectory["samples"][0]["joints"]]
    schedule = _build_schedule(trajectory, "screen")

    with wp.ScopedDevice(args.device):
        mjm, mjd, model, data = load_model_data(args.world_count)
        qpos_init, qvel_init = baseline_state(mjd, args.world_count, joint_home)
        joint_count = int(mjm.nv)
        control = control_buffers(args.world_count, joint_count, np.asarray(joint_home, dtype=np.float32))
        control_traj = control_step_buffers(args.world_count, joint_count, schedule=schedule)

        results = []
        for mode in modes:
            reset_state(data, qpos_init, qvel_init)
            control["integral_error"].zero_()
            control["tau_fb"].zero_()
            control_traj["integral_error"].zero_()
            control_traj["tau_fb"].zero_()

            if mode == "step_only":
                result = benchmark_step_only(model, data, args)
            elif mode == "inverse_only":
                result = benchmark_inverse_only(model, data, args)
            elif mode == "step_inverse":
                result = benchmark_step_inverse(model, data, args)
            elif mode == "step_inverse_control":
                result = benchmark_step_inverse_control(model, data, args, control)
            elif mode == "step_inverse_control_traj":
                result = benchmark_step_inverse_control_traj(model, data, args, control_traj, schedule)
            else:
                raise RuntimeError(f"Unsupported mode: {mode}")

            result["peakTorque"] = round(float(np.max(np.abs(data.qfrc_applied.numpy()))), 5)
            result["peakInverse"] = round(float(np.max(np.abs(data.qfrc_inverse.numpy()))), 5)
            results.append(result)

    print(
        json.dumps(
            {
                "device": args.device,
                "model": str(ROBOT_MODEL_PATH),
                "results": results,
                "notes": {
                    "step_only_has_inverse_result": False,
                    "inverse_is_separate_pass": True,
                    "trajectory_reference_profile": "screen",
                    "comparison_target": "mjwarp-testspeed on same model and nworld",
                },
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
