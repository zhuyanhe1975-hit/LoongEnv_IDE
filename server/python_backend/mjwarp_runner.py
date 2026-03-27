from __future__ import annotations

import hashlib
import math
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from pathlib import Path

import numpy as np

from runtime import inject_backend_site_packages, inject_cuda_runtime_dlls, project_root
from runtime_config import load_runtime_config

inject_cuda_runtime_dlls()
inject_backend_site_packages()

try:
    import mujoco  # type: ignore
    import mujoco_warp as mjw  # type: ignore
    import warp as wp  # type: ignore
except Exception:  # pragma: no cover - runtime import guard
    mujoco = None
    mjw = None
    wp = None


RUNTIME_CONFIG = load_runtime_config()
REPLAY_CONFIG = RUNTIME_CONFIG["replay"]
SERVO_CONFIG = RUNTIME_CONFIG["servo"]
VALIDATION_PROFILES = RUNTIME_CONFIG["optimization"]["validation_profiles"]
PHYSICS_CONFIG = RUNTIME_CONFIG["physics"]
ACCEPTANCE = SERVO_CONFIG.get("acceptance", {})
REAL_PHYSICS_MODE = "mjwarp-rigid-step"

ROBOT_MODEL_PATH = project_root() / "public" / "models" / "er15-1400.mjcf.xml"
MODEL_ASSET_DIR = ROBOT_MODEL_PATH.parent
_CONTEXT_CACHE: dict[tuple[str, str, int, str], dict] = {}


@wp.kernel
def _prepare_control(
    qpos: wp.array2d(dtype=float),
    qvel: wp.array2d(dtype=float),
    qacc: wp.array2d(dtype=float),
    integral_error: wp.array2d(dtype=float),
    tau_fb: wp.array2d(dtype=float),
    qacc_fb: wp.array2d(dtype=float),
    q_ref: wp.array2d(dtype=float),
    qd_ref: wp.array2d(dtype=float),
    qdd_ref: wp.array2d(dtype=float),
    kp: wp.array2d(dtype=float),
    ki: wp.array2d(dtype=float),
    kd: wp.array2d(dtype=float),
    qpos_indices: wp.array1d(dtype=int),
    qvel_indices: wp.array1d(dtype=int),
    integral_limit: float,
    step_id: int,
    sim_dt: float,
    mode_code: int,
    active_world: wp.array1d(dtype=int),
):
    world_id, dof_id = wp.tid()
    if active_world[world_id] == 0:
        tau_fb[world_id, dof_id] = 0.0
        qacc[world_id, qvel_indices[dof_id]] = 0.0
        return
    qpos_id = qpos_indices[dof_id]
    qvel_id = qvel_indices[dof_id]
    q_target = q_ref[step_id, dof_id]
    qd_target = qd_ref[step_id, dof_id]
    qdd_target = qdd_ref[step_id, dof_id]

    err = q_target - qpos[world_id, qpos_id]
    derr = qd_target - qvel[world_id, qvel_id]
    integ = integral_error[world_id, dof_id] + err * sim_dt
    integ = wp.clamp(integ, -integral_limit, integral_limit)
    integral_error[world_id, dof_id] = integ

    p_term = kp[world_id, dof_id] * err
    i_term = ki[world_id, dof_id] * integ
    d_term = kd[world_id, dof_id] * derr
    fb = p_term + i_term + d_term
    tau_fb[world_id, dof_id] = fb
    qacc_fb[world_id, dof_id] = p_term + d_term

    qacc_cmd = qdd_target
    if mode_code >= 2:
        qacc_cmd = qdd_target + qacc_fb[world_id, dof_id]
    qacc[world_id, qvel_id] = qacc_cmd


@wp.kernel
def _compose_tau(
    qfrc_inverse: wp.array2d(dtype=float),
    qfrc_applied: wp.array2d(dtype=float),
    tau_fb: wp.array2d(dtype=float),
    qacc_fb: wp.array2d(dtype=float),
    force_limits: wp.array2d(dtype=float),
    qvel_indices: wp.array1d(dtype=int),
    mode_code: int,
    active_world: wp.array1d(dtype=int),
):
    world_id, dof_id = wp.tid()
    qvel_id = qvel_indices[dof_id]
    if active_world[world_id] == 0:
        qfrc_applied[world_id, qvel_id] = 0.0
        return
    tau = tau_fb[world_id, dof_id]
    if mode_code == 1:
        tau = qfrc_inverse[world_id, qvel_id] + tau_fb[world_id, dof_id]
    elif mode_code >= 2:
        tau = qfrc_inverse[world_id, qvel_id] + (tau_fb[world_id, dof_id] - qacc_fb[world_id, dof_id])

    force_limit = force_limits[world_id, dof_id]
    qfrc_applied[world_id, qvel_id] = wp.clamp(tau, -force_limit, force_limit)


@wp.kernel
def _accumulate_metrics(
    qpos: wp.array2d(dtype=float),
    qvel: wp.array2d(dtype=float),
    qfrc_applied: wp.array2d(dtype=float),
    q_ref: wp.array2d(dtype=float),
    prev_error: wp.array2d(dtype=float),
    peak_error: wp.array1d(dtype=float),
    mean_error_sum: wp.array1d(dtype=float),
    dynamic_peak_error: wp.array1d(dtype=float),
    dynamic_error_sum: wp.array1d(dtype=float),
    peak_velocity: wp.array1d(dtype=float),
    peak_torque: wp.array1d(dtype=float),
    hold_peak_error: wp.array1d(dtype=float),
    hold_error_sum: wp.array1d(dtype=float),
    hold_peak_velocity: wp.array1d(dtype=float),
    hold_velocity_sum: wp.array1d(dtype=float),
    hold_peak_torque: wp.array1d(dtype=float),
    hold_torque_sum: wp.array1d(dtype=float),
    oscillation_count: wp.array1d(dtype=int),
    last_unstable_step: wp.array1d(dtype=int),
    qpos_indices: wp.array1d(dtype=int),
    qvel_indices: wp.array1d(dtype=int),
    step_id: int,
    hold_start_step: int,
    settle_error_threshold: float,
    settle_velocity_threshold: float,
    oscillation_threshold: float,
):
    world_id, dof_id = wp.tid()
    qpos_id = qpos_indices[dof_id]
    qvel_id = qvel_indices[dof_id]
    err = q_ref[step_id, dof_id] - qpos[world_id, qpos_id]
    abs_err = wp.abs(err)
    abs_vel = wp.abs(qvel[world_id, qvel_id])
    abs_tau = wp.abs(qfrc_applied[world_id, qvel_id])

    wp.atomic_add(mean_error_sum, world_id, abs_err)
    wp.atomic_max(peak_error, world_id, abs_err)
    wp.atomic_max(peak_velocity, world_id, abs_vel)
    wp.atomic_max(peak_torque, world_id, abs_tau)

    if step_id >= hold_start_step:
        wp.atomic_add(hold_error_sum, world_id, abs_err)
        wp.atomic_add(hold_velocity_sum, world_id, abs_vel)
        wp.atomic_add(hold_torque_sum, world_id, abs_tau)
        wp.atomic_max(hold_peak_error, world_id, abs_err)
        wp.atomic_max(hold_peak_velocity, world_id, abs_vel)
        wp.atomic_max(hold_peak_torque, world_id, abs_tau)
    else:
        wp.atomic_add(dynamic_error_sum, world_id, abs_err)
        wp.atomic_max(dynamic_peak_error, world_id, abs_err)

    if abs_err > settle_error_threshold or abs_vel > settle_velocity_threshold:
        wp.atomic_max(last_unstable_step, world_id, step_id)

    prev = prev_error[world_id, dof_id]
    if wp.abs(prev) > oscillation_threshold and abs_err > oscillation_threshold and prev * err < 0.0:
        wp.atomic_add(oscillation_count, world_id, 1)
    prev_error[world_id, dof_id] = err


@wp.kernel
def _accumulate_metrics_step(
    qpos: wp.array2d(dtype=float),
    qvel: wp.array2d(dtype=float),
    qfrc_applied: wp.array2d(dtype=float),
    q_ref_step: wp.array2d(dtype=float),
    prev_error: wp.array2d(dtype=float),
    peak_error: wp.array1d(dtype=float),
    mean_error_sum: wp.array1d(dtype=float),
    dynamic_peak_error: wp.array1d(dtype=float),
    dynamic_error_sum: wp.array1d(dtype=float),
    peak_velocity: wp.array1d(dtype=float),
    peak_torque: wp.array1d(dtype=float),
    hold_peak_error: wp.array1d(dtype=float),
    hold_error_sum: wp.array1d(dtype=float),
    hold_peak_velocity: wp.array1d(dtype=float),
    hold_velocity_sum: wp.array1d(dtype=float),
    hold_peak_torque: wp.array1d(dtype=float),
    hold_torque_sum: wp.array1d(dtype=float),
    oscillation_count: wp.array1d(dtype=int),
    last_unstable_step: wp.array1d(dtype=int),
    step_meta: wp.array1d(dtype=int),
    qpos_indices: wp.array1d(dtype=int),
    qvel_indices: wp.array1d(dtype=int),
    hold_start_step: int,
    settle_error_threshold: float,
    settle_velocity_threshold: float,
    oscillation_threshold: float,
    active_world: wp.array1d(dtype=int),
):
    world_id, dof_id = wp.tid()
    if active_world[world_id] == 0:
        return
    step_id = step_meta[0]
    qpos_id = qpos_indices[dof_id]
    qvel_id = qvel_indices[dof_id]
    err = q_ref_step[0, dof_id] - qpos[world_id, qpos_id]
    abs_err = wp.abs(err)
    abs_vel = wp.abs(qvel[world_id, qvel_id])
    abs_tau = wp.abs(qfrc_applied[world_id, qvel_id])

    wp.atomic_add(mean_error_sum, world_id, abs_err)
    wp.atomic_max(peak_error, world_id, abs_err)
    wp.atomic_max(peak_velocity, world_id, abs_vel)
    wp.atomic_max(peak_torque, world_id, abs_tau)

    if step_id >= hold_start_step:
        wp.atomic_add(hold_error_sum, world_id, abs_err)
        wp.atomic_add(hold_velocity_sum, world_id, abs_vel)
        wp.atomic_add(hold_torque_sum, world_id, abs_tau)
        wp.atomic_max(hold_peak_error, world_id, abs_err)
        wp.atomic_max(hold_peak_velocity, world_id, abs_vel)
        wp.atomic_max(hold_peak_torque, world_id, abs_tau)
    else:
        wp.atomic_add(dynamic_error_sum, world_id, abs_err)
        wp.atomic_max(dynamic_peak_error, world_id, abs_err)

    if abs_err > settle_error_threshold or abs_vel > settle_velocity_threshold:
        wp.atomic_max(last_unstable_step, world_id, step_id)

    prev = prev_error[world_id, dof_id]
    if wp.abs(prev) > oscillation_threshold and abs_err > oscillation_threshold and prev * err < 0.0:
        wp.atomic_add(oscillation_count, world_id, 1)
    prev_error[world_id, dof_id] = err


@wp.kernel
def _freeze_inactive_worlds(
    qvel: wp.array2d(dtype=float),
    qacc: wp.array2d(dtype=float),
    qfrc_applied: wp.array2d(dtype=float),
    active_world: wp.array1d(dtype=int),
):
    world_id, dof_id = wp.tid()
    if active_world[world_id] == 0:
        qvel[world_id, dof_id] = 0.0
        qacc[world_id, dof_id] = 0.0
        qfrc_applied[world_id, dof_id] = 0.0


@wp.kernel
def _mark_unstable_worlds(
    peak_error: wp.array1d(dtype=float),
    peak_velocity: wp.array1d(dtype=float),
    oscillation_count: wp.array1d(dtype=int),
    active_world: wp.array1d(dtype=int),
    terminated_step: wp.array1d(dtype=int),
    step_meta: wp.array1d(dtype=int),
    peak_error_limit: float,
    peak_velocity_limit: float,
    oscillation_limit: int,
):
    world_id = wp.tid()
    if active_world[world_id] == 0:
        return
    if (
        peak_error[world_id] >= peak_error_limit
        or peak_velocity[world_id] >= peak_velocity_limit
        or oscillation_count[world_id] >= oscillation_limit
    ):
        active_world[world_id] = 0
        if terminated_step[world_id] < 0:
            terminated_step[world_id] = step_meta[0]


@contextmanager
def _warp_device(device_name: str):
    with wp.ScopedDevice(device_name):
        yield


def detect_engine() -> str:
    if mujoco is None or mjw is None or wp is None:
        return "mjwarp-unavailable"
    wp.init()
    try:
        device = wp.get_preferred_device()
    except Exception:
        return "mjwarp-unavailable"
    if str(device).startswith("cuda"):
        return "mjwarp-cuda"
    return "mjwarp-cpu"


def _prepare_validation_xml(scene_xml: str) -> str:
    raw_xml = scene_xml.strip() if scene_xml.strip() else ROBOT_MODEL_PATH.read_text("utf8")
    root = ET.fromstring(raw_xml)
    compiler = root.find("compiler")
    if compiler is None:
        compiler = ET.Element("compiler")
        root.insert(0, compiler)
    compiler.set("meshdir", str(MODEL_ASSET_DIR))
    compiler.set("assetdir", str(MODEL_ASSET_DIR))
    compiler.set("texturedir", str(MODEL_ASSET_DIR))
    return ET.tostring(root, encoding="unicode")


def _load_host_model(scene_xml: str) -> tuple[object, object, str]:
    prepared_xml = _prepare_validation_xml(scene_xml)
    mjm = mujoco.MjModel.from_xml_string(prepared_xml)
    mjd = mujoco.MjData(mjm)
    return mjm, mjd, prepared_xml


def _control_mode_code(control_mode: dict) -> int:
    ff_mode = str(control_mode.get("ff_mode", "ref")).strip().lower()
    computed_torque = bool(control_mode.get("computed_torque", False))
    ideal_actuation = bool(control_mode.get("ideal_actuation", False))
    if ff_mode == "no" and not computed_torque and not ideal_actuation:
        return 0
    if ff_mode in {"ideal"} or computed_torque or ideal_actuation:
        return 2
    return 1


def _scene_signature(scene_xml: str) -> str:
    prepared_xml = _prepare_validation_xml(scene_xml)
    return hashlib.sha1(prepared_xml.encode("utf8")).hexdigest()


def _interpolate_joint_samples(samples: list[dict], sample_time: float) -> np.ndarray:
    if sample_time <= float(samples[0]["time"]):
        return np.asarray(samples[0]["joints"], dtype=np.float32)
    if sample_time >= float(samples[-1]["time"]):
        return np.asarray(samples[-1]["joints"], dtype=np.float32)

    for index in range(1, len(samples)):
        right = samples[index]
        left = samples[index - 1]
        left_time = float(left["time"])
        right_time = float(right["time"])
        if sample_time <= right_time:
            alpha = 0.0 if right_time <= left_time else (sample_time - left_time) / (right_time - left_time)
            left_joints = np.asarray(left["joints"], dtype=np.float32)
            right_joints = np.asarray(right["joints"], dtype=np.float32)
            return left_joints * (1.0 - alpha) + right_joints * alpha
    return np.asarray(samples[-1]["joints"], dtype=np.float32)


def _build_schedule(trajectory: dict, profile: str) -> dict:
    profile_config = VALIDATION_PROFILES[profile]
    sim_dt = float(PHYSICS_CONFIG["sim_dt"])
    time_scale = float(profile_config.get("trajectory_scale", 1.0))
    hold_extra = float(profile_config.get("hold_extra_duration", 0.0))
    samples = list(trajectory.get("samples", []))
    if not samples:
        raise RuntimeError("Trajectory samples are required for mjwarp validation.")

    scaled_samples: list[dict] = []
    for sample in samples:
        scaled_samples.append(
            {
                **sample,
                "time": round(float(sample["time"]) * time_scale, 6),
                "joints": [float(value) for value in sample["joints"]],
            }
        )

    trajectory_end = float(scaled_samples[-1]["time"])
    total_duration = trajectory_end + hold_extra
    step_count = max(2, int(math.floor(total_duration / sim_dt)) + 1)
    times = np.linspace(0.0, total_duration, step_count, dtype=np.float32)

    q_ref = np.stack(
        [
            _interpolate_joint_samples(scaled_samples, min(float(time_value), trajectory_end))
            for time_value in times
        ],
        axis=0,
    ).astype(np.float32)
    qd_ref = np.gradient(q_ref, sim_dt, axis=0).astype(np.float32)
    qdd_ref = np.gradient(qd_ref, sim_dt, axis=0).astype(np.float32)
    hold_start_step = int(np.searchsorted(times, trajectory_end, side="left"))

    return {
        "times": times,
        "q_ref": q_ref,
        "qd_ref": qd_ref,
        "qdd_ref": qdd_ref,
        "sim_dt": sim_dt,
        "step_count": step_count,
        "trajectory_end": trajectory_end,
        "hold_start_step": hold_start_step,
        "hold_steps": max(1, step_count - hold_start_step),
        "dynamic_steps": max(1, hold_start_step),
    }


def _device_name() -> str:
    engine = detect_engine()
    return "cuda:0" if engine == "mjwarp-cuda" else "cpu"


def _wp_array2d(value: np.ndarray) -> object:
    return wp.array(value.astype(np.float32, copy=False), dtype=float)


def _resolve_control_joint_indices(mjm, joint_names: list[str]) -> tuple[np.ndarray, np.ndarray]:
    qpos_indices: list[int] = []
    qvel_indices: list[int] = []
    for joint_name in joint_names:
        joint_id = mujoco.mj_name2id(mjm, mujoco.mjtObj.mjOBJ_JOINT, joint_name)
        if joint_id < 0:
            raise RuntimeError(f"mjwarp validation scene does not contain joint '{joint_name}'.")
        qpos_indices.append(int(mjm.jnt_qposadr[joint_id]))
        qvel_indices.append(int(mjm.jnt_dofadr[joint_id]))
    return (
        np.asarray(qpos_indices, dtype=np.int32),
        np.asarray(qvel_indices, dtype=np.int32),
    )


def _create_context(scene_xml: str, trajectory: dict, joint_names: list[str], world_count: int, profile: str, control_mode: dict) -> dict:
    if mujoco is None or mjw is None or wp is None:
        raise RuntimeError("mujoco_warp backend is not available in the current project environment.")

    device_name = _device_name()
    with _warp_device(device_name):
        mjm, mjd, prepared_xml = _load_host_model(scene_xml)
        schedule = _build_schedule(trajectory, profile)
        model = mjw.put_model(mjm)
        data = mjw.put_data(mjm, mjd, nworld=world_count)

        qpos_indices_host, qvel_indices_host = _resolve_control_joint_indices(mjm, joint_names)
        joint_count = int(len(joint_names))
        if schedule["q_ref"].shape[1] != joint_count:
            raise RuntimeError(
                f"Trajectory joint count {schedule['q_ref'].shape[1]} does not match controller joint count {joint_count}."
            )

        q_ref = _wp_array2d(schedule["q_ref"])
        qd_ref = _wp_array2d(schedule["qd_ref"])
        qdd_ref = _wp_array2d(schedule["qdd_ref"])
        q_ref_step = _wp_array2d(schedule["q_ref"][0:1])
        qd_ref_step = _wp_array2d(schedule["qd_ref"][0:1])
        qdd_ref_step = _wp_array2d(schedule["qdd_ref"][0:1])

        baseline_qpos_single = np.asarray(mjd.qpos, dtype=np.float32).copy()
        baseline_qvel_single = np.asarray(mjd.qvel, dtype=np.float32).copy()
        baseline_qpos_single[qpos_indices_host] = schedule["q_ref"][0].astype(np.float32)
        baseline_qvel_single[qvel_indices_host] = 0.0
        baseline_qpos = np.repeat(baseline_qpos_single[None, :], world_count, axis=0)
        baseline_qvel = np.repeat(baseline_qvel_single[None, :], world_count, axis=0)
        data.qpos.assign(baseline_qpos)
        data.qvel.assign(baseline_qvel)
        data.qacc.zero_()
        data.qfrc_applied.zero_()
        data.ctrl.zero_()

        context = {
            "prepared_xml": prepared_xml,
            "device_name": device_name,
            "mjm": mjm,
            "mjd": mjd,
            "model": model,
            "data": data,
            "world_count": world_count,
            "joint_count": joint_count,
            "schedule": schedule,
            "q_ref": q_ref,
            "qd_ref": qd_ref,
            "qdd_ref": qdd_ref,
            "q_ref_step": q_ref_step,
            "qd_ref_step": qd_ref_step,
            "qdd_ref_step": qdd_ref_step,
            "qpos_indices": wp.array(qpos_indices_host, dtype=int),
            "qvel_indices": wp.array(qvel_indices_host, dtype=int),
            "baseline_qpos": baseline_qpos,
            "baseline_qvel": baseline_qvel,
            "kp": wp.zeros((world_count, joint_count), dtype=float),
            "ki": wp.zeros((world_count, joint_count), dtype=float),
            "kd": wp.zeros((world_count, joint_count), dtype=float),
            "force_limits": wp.zeros((world_count, joint_count), dtype=float),
            "integral_error": wp.zeros((world_count, joint_count), dtype=float),
            "prev_error": wp.zeros((world_count, joint_count), dtype=float),
            "tau_fb": wp.zeros((world_count, joint_count), dtype=float),
            "qacc_fb": wp.zeros((world_count, joint_count), dtype=float),
            "peak_error": wp.zeros(world_count, dtype=float),
            "mean_error_sum": wp.zeros(world_count, dtype=float),
            "dynamic_peak_error": wp.zeros(world_count, dtype=float),
            "dynamic_error_sum": wp.zeros(world_count, dtype=float),
            "peak_velocity": wp.zeros(world_count, dtype=float),
            "peak_torque": wp.zeros(world_count, dtype=float),
            "hold_peak_error": wp.zeros(world_count, dtype=float),
            "hold_error_sum": wp.zeros(world_count, dtype=float),
            "hold_peak_velocity": wp.zeros(world_count, dtype=float),
            "hold_velocity_sum": wp.zeros(world_count, dtype=float),
            "hold_peak_torque": wp.zeros(world_count, dtype=float),
            "hold_torque_sum": wp.zeros(world_count, dtype=float),
            "oscillation_count": wp.zeros(world_count, dtype=int),
            "last_unstable_step": wp.zeros(world_count, dtype=int),
            "active_world": wp.ones(world_count, dtype=int),
            "terminated_step": wp.array(np.full(world_count, -1, dtype=np.int32), dtype=int),
            "step_meta": wp.array(np.asarray([0], dtype=np.int32), dtype=int),
            "mode_code": _control_mode_code(control_mode),
            "graph": None,
        }
        if device_name.startswith("cuda"):
            _capture_rollout_graph(context)
        return context


def _capture_rollout_graph(context: dict) -> None:
    with _warp_device(context["device_name"]):
        with wp.ScopedCapture() as capture:
            _launch_rollout_step(context)
        context["graph"] = capture.graph


def _launch_rollout_step(context: dict) -> None:
    data = context["data"]
    world_count = int(context["world_count"])
    joint_count = int(context["joint_count"])
    schedule = context["schedule"]
    mode_code = int(context["mode_code"])
    sim_dt = float(schedule["sim_dt"])
    hold_start_step = int(schedule["hold_start_step"])
    settle_error_threshold = float(ACCEPTANCE.get("peak_error", 0.12))
    settle_velocity_threshold = float(ACCEPTANCE.get("peak_velocity", 1.6))
    oscillation_threshold = float(ACCEPTANCE.get("tracking_error_warn", 0.02))

    wp.launch(
        _prepare_control,
        dim=(world_count, joint_count),
        inputs=[
            data.qpos,
            data.qvel,
            data.qacc,
            context["integral_error"],
            context["tau_fb"],
            context["qacc_fb"],
            context["q_ref_step"],
            context["qd_ref_step"],
            context["qdd_ref_step"],
            context["kp"],
            context["ki"],
            context["kd"],
            context["qpos_indices"],
            context["qvel_indices"],
            0.5,
            0,
            sim_dt,
            mode_code,
            context["active_world"],
        ],
    )
    mjw.inverse(context["model"], data)
    wp.launch(
        _compose_tau,
        dim=(world_count, joint_count),
        inputs=[
            data.qfrc_inverse,
            data.qfrc_applied,
            context["tau_fb"],
            context["qacc_fb"],
            context["force_limits"],
            context["qvel_indices"],
            mode_code,
            context["active_world"],
        ],
    )
    wp.launch(
        _freeze_inactive_worlds,
        dim=(world_count, int(context["mjm"].nv)),
        inputs=[data.qvel, data.qacc, data.qfrc_applied, context["active_world"]],
    )
    mjw.step(context["model"], data)
    wp.launch(
        _accumulate_metrics_step,
        dim=(world_count, joint_count),
        inputs=[
            data.qpos,
            data.qvel,
            data.qfrc_applied,
            context["q_ref_step"],
            context["prev_error"],
            context["peak_error"],
            context["mean_error_sum"],
            context["dynamic_peak_error"],
            context["dynamic_error_sum"],
            context["peak_velocity"],
            context["peak_torque"],
            context["hold_peak_error"],
            context["hold_error_sum"],
            context["hold_peak_velocity"],
            context["hold_velocity_sum"],
            context["hold_peak_torque"],
            context["hold_torque_sum"],
            context["oscillation_count"],
            context["last_unstable_step"],
            context["step_meta"],
            context["qpos_indices"],
            context["qvel_indices"],
            hold_start_step,
            settle_error_threshold,
            settle_velocity_threshold,
            oscillation_threshold,
            context["active_world"],
        ],
    )


def _reset_context(context: dict, candidate_spec: dict) -> None:
    data = context["data"]
    baseline_qpos = context["baseline_qpos"]
    baseline_qvel = context["baseline_qvel"]

    data.qpos.assign(baseline_qpos)
    data.qvel.assign(baseline_qvel)
    data.qacc.zero_()
    data.ctrl.zero_()
    data.qfrc_applied.zero_()
    data.qfrc_inverse.zero_()
    context["integral_error"].zero_()
    context["prev_error"].zero_()
    context["tau_fb"].zero_()
    context["qacc_fb"].zero_()
    context["peak_error"].zero_()
    context["mean_error_sum"].zero_()
    context["dynamic_peak_error"].zero_()
    context["dynamic_error_sum"].zero_()
    context["peak_velocity"].zero_()
    context["peak_torque"].zero_()
    context["hold_peak_error"].zero_()
    context["hold_error_sum"].zero_()
    context["hold_peak_velocity"].zero_()
    context["hold_velocity_sum"].zero_()
    context["hold_peak_torque"].zero_()
    context["hold_torque_sum"].zero_()
    context["oscillation_count"].zero_()
    context["last_unstable_step"].zero_()
    context["active_world"].assign(np.ones(context["world_count"], dtype=np.int32))
    context["terminated_step"].assign(np.full(context["world_count"], -1, dtype=np.int32))
    context["step_meta"].assign(np.asarray([0], dtype=np.int32))
    context["q_ref_step"].assign(context["schedule"]["q_ref"][0:1])
    context["qd_ref_step"].assign(context["schedule"]["qd_ref"][0:1])
    context["qdd_ref_step"].assign(context["schedule"]["qdd_ref"][0:1])

    kp = _host_matrix(candidate_spec["kp"])
    ki = _host_matrix(candidate_spec["ki"])
    kd = _host_matrix(candidate_spec["kd"])
    force_limits = _host_matrix(candidate_spec["force_limits"])
    if force_limits.ndim == 1:
        force_limits = np.repeat(force_limits[None, :], kp.shape[0], axis=0)

    context["kp"].assign(kp)
    context["ki"].assign(ki)
    context["kd"].assign(kd)
    context["force_limits"].assign(force_limits)


def _context_cache_key(scene_xml: str, trajectory: dict, joint_names: list[str], world_count: int, profile: str, control_mode: dict) -> tuple[str, str, str, int, str]:
    return (
        _scene_signature(scene_xml),
        hashlib.sha1(str(trajectory.get("summary", "trajectory")).encode("utf8")).hexdigest(),
        "|".join(joint_names),
        world_count,
        f"{profile}:{_control_mode_code(control_mode)}",
    )


def _get_context(scene_xml: str, trajectory: dict, joint_names: list[str], world_count: int, profile: str, control_mode: dict) -> dict:
    key = _context_cache_key(scene_xml, trajectory, joint_names, world_count, profile, control_mode)
    cached = _CONTEXT_CACHE.get(key)
    if cached is None:
        cached = _create_context(scene_xml, trajectory, joint_names, world_count, profile, control_mode)
        _CONTEXT_CACHE[key] = cached
    return cached


def _array_to_numpy(value) -> np.ndarray:
    return np.asarray(value.numpy(), dtype=np.float32)


def _host_matrix(value) -> np.ndarray:
    if isinstance(value, np.ndarray):
        return value.astype(np.float32, copy=False)
    getter = getattr(value, "get", None)
    if callable(getter):
        return np.asarray(getter(), dtype=np.float32)
    return np.asarray(value, dtype=np.float32)


def _build_metrics(context: dict) -> dict[str, np.ndarray]:
    schedule = context["schedule"]
    joint_count = int(context["joint_count"])
    dynamic_steps = int(schedule["dynamic_steps"])
    hold_steps = int(schedule["hold_steps"])
    sim_dt = float(schedule["sim_dt"])
    peak_error = _array_to_numpy(context["peak_error"])
    mean_error_sum = _array_to_numpy(context["mean_error_sum"])
    dynamic_peak_error = _array_to_numpy(context["dynamic_peak_error"])
    dynamic_error_sum = _array_to_numpy(context["dynamic_error_sum"])
    peak_velocity = _array_to_numpy(context["peak_velocity"])
    peak_torque = _array_to_numpy(context["peak_torque"])
    hold_peak_error = _array_to_numpy(context["hold_peak_error"])
    hold_error_sum = _array_to_numpy(context["hold_error_sum"])
    hold_peak_velocity = _array_to_numpy(context["hold_peak_velocity"])
    hold_velocity_sum = _array_to_numpy(context["hold_velocity_sum"])
    hold_peak_torque = _array_to_numpy(context["hold_peak_torque"])
    hold_torque_sum = _array_to_numpy(context["hold_torque_sum"])
    oscillation_count = np.asarray(context["oscillation_count"].numpy(), dtype=np.int32)
    last_unstable_step = np.asarray(context["last_unstable_step"].numpy(), dtype=np.int32)
    terminated_step = np.asarray(context["terminated_step"].numpy(), dtype=np.int32)
    active_world = np.asarray(context["active_world"].numpy(), dtype=np.int32)

    mean_error = mean_error_sum / max(1, (dynamic_steps + hold_steps) * joint_count)
    dynamic_mean_error = dynamic_error_sum / max(1, dynamic_steps * joint_count)
    hold_mean_error = hold_error_sum / max(1, hold_steps * joint_count)
    hold_mean_velocity = hold_velocity_sum / max(1, hold_steps * joint_count)
    hold_mean_torque = hold_torque_sum / max(1, hold_steps * joint_count)
    settle_time = np.maximum(0.0, last_unstable_step.astype(np.float32) * sim_dt)
    stability_index = 1.0 / (1.0 + hold_peak_error * 200.0 + hold_peak_velocity * 10.0 + oscillation_count.astype(np.float32))
    stable = (hold_peak_error <= 0.01) & (hold_peak_velocity <= 0.05) & (oscillation_count == 0)

    return {
        "peakError": peak_error,
        "meanError": mean_error,
        "dynamicMeanError": dynamic_mean_error,
        "dynamicPeakError": dynamic_peak_error,
        "peakVelocity": peak_velocity,
        "peakTorque": peak_torque,
        "settleTime": settle_time,
        "oscillationPenalty": oscillation_count.astype(np.float32),
        "stabilityIndex": stability_index.astype(np.float32),
        "holdMeanError": hold_mean_error,
        "holdPeakError": hold_peak_error,
        "holdMeanVelocity": hold_mean_velocity,
        "holdPeakVelocity": hold_peak_velocity,
        "holdMeanTorque": hold_mean_torque,
        "holdPeakTorque": hold_peak_torque,
        "stable": stable.astype(bool),
        "terminatedEarly": (terminated_step >= 0),
        "terminatedStep": terminated_step.astype(np.float32),
        "activeWorld": active_world.astype(np.float32),
    }


def evaluate_controller_candidates_batch(
    scene_xml: str,
    trajectory: dict,
    candidate_spec: dict,
    control_mode: dict,
    profile: str = "full",
    return_arrays: bool = True,
):
    world_count = int(_host_matrix(candidate_spec["kp"]).shape[0])
    context = _get_context(scene_xml, trajectory, list(candidate_spec["names"]), world_count, profile, control_mode)
    _reset_context(context, candidate_spec)

    with _warp_device(context["device_name"]):
        schedule = context["schedule"]
        step_count = int(schedule["step_count"])
        profile_config = VALIDATION_PROFILES.get(profile, {})
        early_stop_peak_error = float(profile_config.get("early_stop_peak_error", 0.0))
        early_stop_peak_velocity = float(profile_config.get("early_stop_peak_velocity", 0.0))
        early_stop_oscillations = int(profile_config.get("early_stop_oscillations", 0))
        active_check_interval = max(1, int(profile_config.get("active_check_interval", 16)))
        for step_id in range(step_count):
            context["step_meta"].assign(np.asarray([step_id], dtype=np.int32))
            context["q_ref_step"].assign(schedule["q_ref"][step_id : step_id + 1])
            context["qd_ref_step"].assign(schedule["qd_ref"][step_id : step_id + 1])
            context["qdd_ref_step"].assign(schedule["qdd_ref"][step_id : step_id + 1])
            if context["graph"] is not None:
                wp.capture_launch(context["graph"])
            else:
                _launch_rollout_step(context)
            if (
                profile == "screen"
                and early_stop_peak_error > 0.0
                and ((step_id + 1) % active_check_interval == 0 or step_id == step_count - 1)
            ):
                wp.launch(
                    _mark_unstable_worlds,
                    dim=(world_count,),
                    inputs=[
                        context["peak_error"],
                        context["peak_velocity"],
                        context["oscillation_count"],
                        context["active_world"],
                        context["terminated_step"],
                        context["step_meta"],
                        early_stop_peak_error,
                        early_stop_peak_velocity,
                        early_stop_oscillations,
                    ],
                )
                wp.synchronize()
                active_host = np.asarray(context["active_world"].numpy(), dtype=np.int32)
                if int(active_host.sum()) <= 0:
                    break
        wp.synchronize()

    metrics = _build_metrics(context)
    if return_arrays:
        return metrics

    world_metrics = []
    for index in range(world_count):
        world_metrics.append({key: (bool(value[index]) if value.dtype == np.bool_ else float(value[index])) for key, value in metrics.items()})
    return world_metrics


def _single_candidate_spec(controller_gains: list[dict]) -> dict:
    return {
        "names": [str(item["name"]) for item in controller_gains],
        "base_gains": [dict(item) for item in controller_gains],
        "kp": np.asarray([[float(item["kp"]) for item in controller_gains]], dtype=np.float32),
        "ki": np.asarray([[float(item["ki"]) for item in controller_gains]], dtype=np.float32),
        "kd": np.asarray([[float(item["kd"]) for item in controller_gains]], dtype=np.float32),
        "force_limits": np.asarray([[abs(float(item["forcerange"][1])) for item in controller_gains]], dtype=np.float32),
    }


def _metrics_from_arrays(metrics: dict[str, np.ndarray]) -> dict:
    return {
        key: (bool(value[0]) if value.dtype == np.bool_ else round(float(value[0]), 5))
        for key, value in metrics.items()
    }


def _phase_for_time(trajectory: dict, time_value: float) -> str:
    samples = list(trajectory.get("samples", []))
    if not samples:
        return "backend-replay"
    current_label = str(samples[0].get("label", "backend-replay"))
    for sample in samples:
        sample_time = float(sample.get("time", 0.0))
        if time_value + 1e-6 < sample_time:
            break
        current_label = str(sample.get("label", current_label))
    return current_label


def _build_replay(context: dict, trajectory: dict, joint_names: list[str]) -> tuple[dict, dict]:
    schedule = context["schedule"]
    playback_dt = float(REPLAY_CONFIG["dt"])
    sim_dt = float(schedule["sim_dt"])
    playback_stride = max(1, int(round(playback_dt / sim_dt)))
    qpos_indices = np.asarray(context["qpos_indices"].numpy(), dtype=np.int32)
    qvel_indices = np.asarray(context["qvel_indices"].numpy(), dtype=np.int32)
    force_limits = np.asarray(context["force_limits"].numpy(), dtype=np.float32)[0]
    frames: list[dict] = []
    tau_delta_sum = 0.0
    tau_delta_max = 0.0
    tau_inverse_abs_sum = 0.0
    tau_applied_abs_sum = 0.0
    torque_limit_hits = 0
    torque_limit_checks = 0

    data = context["data"]
    step_count = int(schedule["step_count"])
    q_ref = schedule["q_ref"]

    with _warp_device(context["device_name"]):
        for step_id in range(step_count):
            context["step_meta"].assign(np.asarray([step_id], dtype=np.int32))
            context["q_ref_step"].assign(schedule["q_ref"][step_id : step_id + 1])
            context["qd_ref_step"].assign(schedule["qd_ref"][step_id : step_id + 1])
            context["qdd_ref_step"].assign(schedule["qdd_ref"][step_id : step_id + 1])
            if context["graph"] is not None:
                wp.capture_launch(context["graph"])
            else:
                _launch_rollout_step(context)

            if step_id % playback_stride != 0 and step_id != step_count - 1:
                continue

            wp.synchronize()
            qpos = np.asarray(data.qpos.numpy(), dtype=np.float32)[0]
            qvel = np.asarray(data.qvel.numpy(), dtype=np.float32)[0]
            qfrc_applied = np.asarray(data.qfrc_applied.numpy(), dtype=np.float32)[0]
            qfrc_inverse = np.asarray(data.qfrc_inverse.numpy(), dtype=np.float32)[0]
            qfrc_passive = np.asarray(data.qfrc_passive.numpy(), dtype=np.float32)[0]
            qfrc_constraint = np.asarray(data.qfrc_constraint.numpy(), dtype=np.float32)[0]
            joints = []
            for joint_index, joint_name in enumerate(joint_names):
                qpos_id = int(qpos_indices[joint_index])
                qvel_id = int(qvel_indices[joint_index])
                target = float(q_ref[step_id, joint_index])
                position = float(qpos[qpos_id])
                velocity = float(qvel[qvel_id])
                torque = float(qfrc_applied[qvel_id])
                inverse_tau = float(qfrc_inverse[qvel_id])
                passive_tau = float(qfrc_passive[qvel_id])
                constraint_tau = float(qfrc_constraint[qvel_id])
                tau_delta = abs(torque - inverse_tau)
                tau_delta_sum += tau_delta
                tau_delta_max = max(tau_delta_max, tau_delta)
                tau_inverse_abs_sum += abs(inverse_tau)
                tau_applied_abs_sum += abs(torque)
                torque_limit = float(force_limits[joint_index])
                torque_limit_checks += 1
                if torque_limit > 0.0 and abs(torque) >= torque_limit - 1e-3:
                    torque_limit_hits += 1
                joints.append(
                    {
                        "name": joint_name,
                        "position": round(position, 6),
                        "velocity": round(velocity, 6),
                        "torque": round(torque, 6),
                        "inverseTorque": round(inverse_tau, 6),
                        "passiveTorque": round(passive_tau, 6),
                        "constraintTorque": round(constraint_tau, 6),
                        "error": round(target - position, 6),
                    }
                )
            frame_time = float(schedule["times"][step_id])
            frames.append(
                {
                    "time": round(frame_time, 4),
                    "phase": _phase_for_time(trajectory, frame_time),
                    "collisionActiveCount": 0,
                    "lastCollisionPair": "-",
                    "joints": joints,
                }
            )

    replay = {
        "duration": round(float(schedule["times"][-1]), 4),
        "playback_fps": int(REPLAY_CONFIG["playback_fps"]),
        "frames": frames,
    }
    tau_delta_mean = tau_delta_sum / max(1, torque_limit_checks)
    inverse_tau_mean_abs = tau_inverse_abs_sum / max(1, torque_limit_checks)
    applied_tau_mean_abs = tau_applied_abs_sum / max(1, torque_limit_checks)
    replay_diag = {
        "tauInverseDeltaMean": round(float(tau_delta_mean), 6),
        "tauInverseDeltaMax": round(float(tau_delta_max), 6),
        "tauInverseMeanAbs": round(float(inverse_tau_mean_abs), 6),
        "tauAppliedMeanAbs": round(float(applied_tau_mean_abs), 6),
        "torqueLimitHitRate": round(float(torque_limit_hits / max(1, torque_limit_checks)), 6),
    }
    return replay, replay_diag


def generate_replay(scene_xml: str, trajectory: dict, controller_gains: list[dict], control_mode: dict) -> tuple[dict, dict | None, str]:
    candidate_spec = _single_candidate_spec(controller_gains)
    context = _get_context(scene_xml, trajectory, list(candidate_spec["names"]), 1, "full", control_mode)
    _reset_context(context, candidate_spec)
    replay, replay_diag = _build_replay(context, trajectory, list(candidate_spec["names"]))
    metrics_arrays = _build_metrics(context)
    metrics = _metrics_from_arrays(metrics_arrays)
    metrics.update(replay_diag)
    return metrics, replay, REAL_PHYSICS_MODE
