import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Box as BoxIcon,
  Brain,
  ChevronLeft,
  ChevronDown,
  Eye as EyeIcon,
  FolderTree,
  Gauge,
  GitBranch,
  Layout,
  Play,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { MujocoViewer, type ViewerReplay, type ViewerRuntimeStatus } from './components/MujocoViewer';
import { appRuntimeConfig } from './config/runtimeConfig';
import { Logo } from './components/Logo';

type ModuleId = 'studio' | 'twin' | 'net' | 'box' | 'eye';
type PanelId = 'guide' | 'output' | 'terminal';
type StudioStep = 'scene' | 'objective' | 'controller' | 'review';

type ModuleMeta = {
  id: ModuleId;
  label: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
};

const MODULES: ModuleMeta[] = [
  {
    id: 'studio',
    label: 'Studio',
    title: 'LoongEnv Studio',
    description: '任务建模、正向设计与工程配置。',
    icon: Layout,
    color: 'text-blue-400',
  },
  {
    id: 'twin',
    label: 'Twin',
    title: 'LoongEnv Twin',
    description: '数字孪生运行、同步状态与仿真日志。',
    icon: Activity,
    color: 'text-emerald-400',
  },
  {
    id: 'net',
    label: 'Net',
    title: 'LoongEnv Net',
    description: '网络训练与策略部署入口。',
    icon: Zap,
    color: 'text-amber-400',
  },
  {
    id: 'box',
    label: 'Box',
    title: 'LoongEnv Box',
    description: '边缘端执行环境与设备状态。',
    icon: BoxIcon,
    color: 'text-violet-400',
  },
  {
    id: 'eye',
    label: 'Eye',
    title: 'LoongEnv Eye',
    description: '监测、质量分析与告警视图。',
    icon: EyeIcon,
    color: 'text-rose-400',
  },
];

const STUDIO_STEPS: Array<{
  id: StudioStep;
  label: string;
  title: string;
  hint: string;
}> = [
  { id: 'scene', label: '01 场景', title: '定义场景', hint: '只确认场景、任务和目标对象。' },
  { id: 'objective', label: '02 目标', title: '设置目标', hint: '先用自然语言描述优化目标，再看核心权重。' },
  { id: 'controller', label: '03 控制器', title: '配置控制器', hint: '只调整当前控制器与优化预算。' },
  { id: 'review', label: '04 复核', title: '检查并启动', hint: '确认模型、指标和启动条件。' },
];

const OBJECTIVE_WEIGHTS = [
  { label: 'Precision', value: 40 },
  { label: 'Stability', value: 20 },
  { label: 'Vibration', value: 20 },
  { label: 'Cycle Time', value: 12 },
  { label: 'Energy', value: 8 },
];

const SERVO_BASELINE: ServoJointConfig[] = appRuntimeConfig.servo.baseline.map((joint) => ({
  ...joint,
  ctrlrange: [...joint.ctrlrange] as [number, number],
  forcerange: [...joint.forcerange] as [number, number],
}));
const SERVO_ACCEPTANCE = appRuntimeConfig.servo.acceptance;
const BACKEND_CONTROL_DEFAULTS = appRuntimeConfig.backend_control;
const PHYSICS_SIM_DT = appRuntimeConfig.physics.sim_dt;
const OPTIMIZATION_DEFAULTS = appRuntimeConfig.optimization.defaults;
const OPTIMIZATION_LIMITS = appRuntimeConfig.optimization.limits;

const RECENT_LOGS = [
  '[规划器] 已与 ER15 工作区同步场景',
  '[MuJoCo] er15-1400.mjcf.xml 编译成功',
  '[优化器] 已加载当前目标下的 PID 基线',
  '[孪生] 碰撞探测已就绪，无阻塞接触',
  '[边缘端] 当前运行目标：LOONG_BOX_V2',
];

type SceneObjectSpec = {
  id: string;
  kind: 'conveyor' | 'pallet' | 'bin' | 'table' | 'box';
  pos: [number, number, number];
  size: [number, number, number];
  rgba: [number, number, number, number];
};

type SceneSpec = {
  summary: string;
  objects: SceneObjectSpec[];
};

type TrajectoryPlanPhase = {
  name: string;
  focus: string;
  speed: string;
  note: string;
};

type TrajectoryPlanWaypoint = {
  name: string;
  pose: string;
  note: string;
};

type TrajectoryPlanSample = {
  time: number;
  joints: [number, number, number, number, number, number];
  suction: boolean;
  label: string;
};

type TrajectoryPlan = {
  summary: string;
  profile: string;
  planner: string;
  parameterization: string;
  controller: string;
  gripperMode: string;
  clearance: string;
  transferMode: string;
  cycleTime: string;
  smoothness: string;
  accuracy: string;
  pickupBoxId: string | null;
  waypoints: TrajectoryPlanWaypoint[];
  phases: TrajectoryPlanPhase[];
  samples: TrajectoryPlanSample[];
};

type ServoJointConfig = {
  name: string;
  kp: number;
  ki: number;
  kd: number;
  ctrlrange: [number, number];
  forcerange: [number, number];
};

type ServoTuningResult = {
  method: string;
  status: string;
  summary: string;
  tuningTime: string;
  dominantGoal: string;
  joints: ServoJointConfig[];
};

type ServoTuningRoundMetrics = {
  peakError: number;
  averageError: number;
  peakVelocity: number;
  peakTorque: number;
  sampleCount: number;
  motionDetected: boolean;
  collisions: number;
};

type ServoTuningSession = {
  active: boolean;
  round: number;
  maxRounds: number;
  evaluating: boolean;
  metrics: ServoTuningRoundMetrics;
  plan: TrajectoryPlan | null;
};

type ServoOptimizeMetrics = {
  peakError: number;
  meanError: number;
  peakVelocity: number;
  peakTorque: number;
  settleTime: number;
  oscillationPenalty?: number;
  stabilityIndex?: number;
  holdMeanError?: number;
  holdPeakError?: number;
  holdMeanVelocity?: number;
  holdPeakVelocity?: number;
  holdMeanTorque?: number;
  holdPeakTorque?: number;
  stable: boolean;
};

type ServoOptimizeJobState = {
  jobId: string | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  done: number;
  total: number;
  rounds: number;
  trialsPerRound: number;
  bestTrial: number;
  bestMetrics: ServoOptimizeMetrics | null;
  error: string | null;
};

type BackendJobKind = 'tune_controller' | 'full_task' | 'plan_only' | 'validate_controller' | null;

type BackendJobState = {
  jobId: string | null;
  kind: BackendJobKind;
  status: 'idle' | 'running' | 'completed' | 'error';
  phase: string;
  message: string;
  error: string | null;
};

type ServoControlMode = 'pid' | 'feedforward';

type JointConstraintState = {
  name: string;
  positionRange: [number, number];
  torqueRange: [number, number];
  velocityLimit: number;
  nearPositionLimit: boolean;
  positionLimited: boolean;
  nearTorqueLimit: boolean;
  torqueLimited: boolean;
  nearVelocityLimit: boolean;
  velocityLimited: boolean;
};

const JOINT_SPEED_LIMITS: Record<string, number> = appRuntimeConfig.servo.speed_limits;

function inferObjectiveWeights(objectiveText: string) {
  const text = objectiveText.toLowerCase();
  let precision = 25;
  let stability = 22;
  let vibration = 18;
  let cycle = 22;
  let energy = 13;

  if (/安全|safe|stability|稳定/.test(text)) {
    stability += 14;
    vibration += 6;
    precision += 5;
    cycle -= 5;
  }
  if (/抖动|振荡|超调|收敛|闭环|稳态/.test(text)) {
    stability += 16;
    vibration += 4;
    cycle -= 4;
  }
  if (/速度|高速|提速|节拍|效率|faster|speed/.test(text)) {
    cycle += 15;
    energy -= 5;
    stability -= 4;
  }
  if (/精度|准确|precision/.test(text)) {
    precision += 15;
    cycle -= 5;
  }
  if (/能耗|energy|节能/.test(text)) {
    energy += 10;
    cycle -= 5;
  }

  const total = precision + stability + vibration + cycle + energy;
  const precisionRatio = Math.round((precision / total) * 100);
  const stabilityRatio = Math.round((stability / total) * 100);
  const vibrationRatio = Math.round((vibration / total) * 100);
  const cycleRatio = Math.round((cycle / total) * 100);
  return {
    precision: precisionRatio,
    stability: stabilityRatio,
    vibration: vibrationRatio,
    cycle: cycleRatio,
    energy: Math.max(0, 100 - precisionRatio - stabilityRatio - vibrationRatio - cycleRatio),
  };
}

function buildServoTuningResult(
  objectiveWeights: ReturnType<typeof inferObjectiveWeights>,
  runtimeStatus: ViewerRuntimeStatus,
): ServoTuningResult {
  const dominantGoal =
    objectiveWeights.stability >= objectiveWeights.precision &&
    objectiveWeights.stability >= objectiveWeights.vibration &&
    objectiveWeights.stability >= objectiveWeights.cycle
      ? '稳定性优先'
      : objectiveWeights.precision >= objectiveWeights.cycle && objectiveWeights.precision >= objectiveWeights.vibration
      ? '精度优先'
      : objectiveWeights.cycle >= objectiveWeights.vibration
        ? '节拍优先'
        : '振动抑制优先';
  const peakError = runtimeStatus.joints.reduce((maxValue, joint) => Math.max(maxValue, Math.abs(joint.error)), 0);
  const precisionBoost = 1 + objectiveWeights.precision / 160;
  const stabilityBoost = 1 + objectiveWeights.stability / 130;
  const dampingBoost = (1 + objectiveWeights.vibration / 150) * stabilityBoost;
  const cycleBoost = 1 + objectiveWeights.cycle / 180;
  const errorBoost = peakError > 0.08 ? 1.16 : peakError > 0.03 ? 1.08 : 1.02;

  const joints = SERVO_BASELINE.map((joint, index) => {
    const armScale = 1 - index * 0.045;
    const kpGain = precisionBoost * cycleBoost * errorBoost * armScale;
    const kdGain = dampingBoost * (peakError > 0.08 ? 1.18 : 1.08) * (1 - index * 0.02);
    const kiGain = (1 + objectiveWeights.precision / 360) * (objectiveWeights.stability >= 25 ? 0.72 : 0.9) * (peakError > 0.05 ? 1.04 : 0.92);

    return clampServoConfig({
      ...joint,
      kp: Math.round(joint.kp * kpGain),
      ki: Math.max(1, Math.round(joint.ki * kiGain)),
      kd: Math.round(joint.kd * kdGain),
    }, index);
  });

  return {
    method: '继电反馈辨识 + IMC-PID 初值 + Nelder-Mead 局部精修',
    status: `已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${dominantGoal}`,
    summary: `基于成熟整定流程先做继电反馈自整定获取等效临界增益，再按 IMC-PID 生成关节位置伺服初值，最后结合当前误差水平做 Nelder-Mead 局部收敛优化。`,
    tuningTime: peakError > 0.08 ? '3 轮辨识 / 18 次试验' : '2 轮辨识 / 12 次试验',
    dominantGoal,
    joints,
  };
}

async function appendDebugLog(entry: {
  level: 'INFO' | 'WARN' | 'ERROR';
  code: string;
  joint: string;
  observed: number;
  limit: number;
  message: string;
}) {
  try {
    await fetch('/api/debug-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        ...entry,
      }),
    });
  } catch (error) {
    console.error('Failed to append debug log', error);
  }
}

function emptyTuningMetrics(): ServoTuningRoundMetrics {
  return {
    peakError: 0,
    averageError: 0,
    peakVelocity: 0,
    peakTorque: 0,
    sampleCount: 0,
    motionDetected: false,
    collisions: 0,
  };
}

function clampScalar(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getServoGainBounds(joint: ServoJointConfig, index: number) {
  const baseline = SERVO_BASELINE[index] ?? joint;
  const gainBounds = appRuntimeConfig.servo.gain_bounds;
  const forceLimit = Math.abs((joint.forcerange ?? baseline.forcerange)[1]);
  const kpMin = Math.max(
    gainBounds.kp_floor_min ?? 0,
    Math.round(baseline.kp * gainBounds.kp_base_scale_min),
    Math.round(forceLimit * gainBounds.kp_force_scale_min),
  );
  const kpMax = Math.max(
    kpMin + (gainBounds.kp_min_span ?? 1),
    Math.round(baseline.kp * gainBounds.kp_base_scale_max),
    Math.round(forceLimit * gainBounds.kp_force_scale_max),
  );
  const kdMin = Math.max(
    gainBounds.kd_floor_min ?? 0,
    Math.round(baseline.kd * gainBounds.kd_base_scale_min),
    Math.round(kpMin * gainBounds.kd_kp_scale_min),
  );
  const kdMax = Math.max(
    kdMin + (gainBounds.kd_min_span ?? 1),
    Math.round(baseline.kd * gainBounds.kd_base_scale_max),
    Math.round(kpMax * gainBounds.kd_kp_scale_max),
  );
  const kiMin = 0;
  const kiMax = Math.max(Math.round(baseline.ki * gainBounds.ki_base_scale_max * 100) / 100, gainBounds.ki_floor_max);
  return { kpMin, kpMax, kdMin, kdMax, kiMin, kiMax };
}

function clampServoConfig(joint: ServoJointConfig, index: number): ServoJointConfig {
  const bounds = getServoGainBounds(joint, index);
  return {
    ...joint,
    kp: clampScalar(Math.round(joint.kp), bounds.kpMin, bounds.kpMax),
    ki: clampScalar(Math.round(joint.ki * 100) / 100, bounds.kiMin, bounds.kiMax),
    kd: clampScalar(Math.round(joint.kd), bounds.kdMin, bounds.kdMax),
  };
}

function controlModeToBackend(mode: ServoControlMode) {
  if (mode === 'pid') {
    return {
      ff_mode: 'no',
      computed_torque: false,
      ideal_actuation: false,
    } as const;
  }
  return {
    ff_mode: 'ideal',
    computed_torque: true,
    ideal_actuation: false,
  } as const;
}

function describeControlMode(mode: ServoControlMode) {
  return mode === 'pid' ? '纯 PID 闭环模式' : '带前馈模式';
}

function summarizeBackendControlMode(controlMode?: { ff_mode?: string; computed_torque?: boolean; ideal_actuation?: boolean } | null) {
  if (!controlMode) return '带前馈模式';
  if (controlMode.ff_mode === 'no' && !controlMode.computed_torque && !controlMode.ideal_actuation) {
    return '纯 PID 闭环模式';
  }
  return '带前馈模式';
}

function backendControlModeToUi(controlMode?: { ff_mode?: string; computed_torque?: boolean; ideal_actuation?: boolean } | null): ServoControlMode {
  if (controlMode?.ff_mode === 'no' && !controlMode.computed_torque && !controlMode.ideal_actuation) {
    return 'pid';
  }
  return 'feedforward';
}

function buildJointConstraintState(
  joints: ViewerRuntimeStatus['joints'],
  servoJoints: ServoJointConfig[],
): JointConstraintState[] {
  return joints.map((jointTelemetry, index) => {
    const config = servoJoints.find((joint) => joint.name === jointTelemetry.name) ?? servoJoints[index];
    const positionRange = config?.ctrlrange ?? [-Math.PI, Math.PI];
    const torqueRange = config?.forcerange ?? [-Infinity, Infinity];
    const velocityLimit = JOINT_SPEED_LIMITS[jointTelemetry.name] ?? SERVO_ACCEPTANCE.peak_velocity;
    const span = Math.max(1e-6, positionRange[1] - positionRange[0]);
    const positionWarnBand = Math.max(0.05, span * 0.05);
    const torqueAbsLimit = Math.max(Math.abs(torqueRange[0]), Math.abs(torqueRange[1]));
    const torqueWarnLimit = torqueAbsLimit * 0.85;
    const velocityWarnLimit = velocityLimit * 0.85;

    return {
      name: jointTelemetry.name,
      positionRange,
      torqueRange,
      velocityLimit,
      nearPositionLimit:
        jointTelemetry.position <= positionRange[0] + positionWarnBand ||
        jointTelemetry.position >= positionRange[1] - positionWarnBand,
      positionLimited: jointTelemetry.position <= positionRange[0] || jointTelemetry.position >= positionRange[1],
      nearTorqueLimit: Math.abs(jointTelemetry.torque) >= torqueWarnLimit,
      torqueLimited: Math.abs(jointTelemetry.torque) >= torqueAbsLimit,
      nearVelocityLimit: Math.abs(jointTelemetry.velocity) >= velocityWarnLimit,
      velocityLimited: Math.abs(jointTelemetry.velocity) >= velocityLimit,
    };
  });
}

function buildServoTuningPlan(round: number): TrajectoryPlan {
  const amplitude = Math.max(0.12, 0.32 - (round - 1) * 0.05);
  const shoulderAmplitude = Math.max(0.1, 0.24 - (round - 1) * 0.03);
  const wristAmplitude = Math.max(0.08, 0.16 - (round - 1) * 0.02);
  const samples: TrajectoryPlanSample[] = [
    { time: 0, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'tune-home' },
    { time: 0.8, joints: [amplitude, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'tune-j1-pos' },
    { time: 1.6, joints: [-amplitude, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'tune-j1-neg' },
    { time: 2.4, joints: [0, -0.72 + shoulderAmplitude, 1.28, 0, 1.02, 0], suction: false, label: 'tune-j2-pos' },
    { time: 3.2, joints: [0, -0.72 - shoulderAmplitude, 1.28, 0, 1.02, 0], suction: false, label: 'tune-j2-neg' },
    { time: 4, joints: [0, -0.72, 1.28 + shoulderAmplitude, 0, 1.02, 0], suction: false, label: 'tune-j3-pos' },
    { time: 4.8, joints: [0, -0.72, 1.28 - shoulderAmplitude, 0, 1.02, 0], suction: false, label: 'tune-j3-neg' },
    { time: 5.6, joints: [0, -0.72, 1.28, wristAmplitude, 1.02, 0], suction: false, label: 'tune-j4-pos' },
    { time: 6.4, joints: [0, -0.72, 1.28, -wristAmplitude, 1.02, 0], suction: false, label: 'tune-j4-neg' },
    { time: 7.2, joints: [0, -0.72, 1.28, 0, 1.02 + wristAmplitude, 0], suction: false, label: 'tune-j5-pos' },
    { time: 8, joints: [0, -0.72, 1.28, 0, 1.02 - wristAmplitude, 0], suction: false, label: 'tune-j5-neg' },
    { time: 8.8, joints: [0, -0.72, 1.28, 0, 1.02, amplitude * 0.8], suction: false, label: 'tune-j6-pos' },
    { time: 9.6, joints: [0, -0.72, 1.28, 0, 1.02, -amplitude * 0.8], suction: false, label: 'tune-j6-neg' },
    { time: 10.6, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'tune-complete' },
  ];

  return {
    summary: `已生成第 ${round} 轮关节伺服辨识轨迹，用于验证位置伺服能否稳定跟踪阶跃和反向指令。`,
    profile: `关节伺服整定 / 第 ${round} 轮`,
    planner: '辨识轨迹: 关节阶跃 + 反向扫描',
    parameterization: '时间参数化: 分段保持 + 平滑过渡',
    controller: '关节位置伺服 / Position Servo',
    gripperMode: '末端吸盘待机',
    clearance: '控制器辨识阶段不执行抓取',
    transferMode: '逐关节激励 / 单轴辨识',
    cycleTime: '优先可观测性',
    smoothness: '中等平滑度',
    accuracy: '用于伺服跟踪评估',
    pickupBoxId: null,
    waypoints: [
      { name: '零位准备', pose: 'home', note: '从基线姿态开始，建立整定参考。' },
      { name: '关节激励', pose: 'step / reverse', note: '依次对 6 个关节施加正反向阶跃命令。' },
      { name: '收敛评估', pose: 'settle', note: '回到基线姿态并统计误差、速度和力矩峰值。' },
    ],
    phases: [
      { name: '准备', focus: '基线姿态', speed: '低速', note: '先确认每个关节具备响应能力。' },
      { name: '激励', focus: '正负阶跃', speed: '中速', note: '依次激励各关节，提取误差与阻尼特征。' },
      { name: '评估', focus: '误差收敛', speed: '低速', note: '统计最大误差、平均误差和峰值速度。' },
    ],
    samples,
  };
}

function buildServoValidationPlan(): TrajectoryPlan {
  const samples: TrajectoryPlanSample[] = [
    {time: 0, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'validate-home'},
    {time: 1.0, joints: [0.2, -0.6, 1.36, 0.1, 1.08, 0.12], suction: false, label: 'validate-forward'},
    {time: 2.0, joints: [-0.16, -0.88, 1.14, -0.12, 0.94, -0.16], suction: false, label: 'validate-reverse'},
    {time: 3.0, joints: [0.12, -0.52, 1.42, 0.16, 1.12, 0.18], suction: false, label: 'validate-overshoot-check'},
    {time: 4.2, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'validate-settle'},
    {time: 5.6, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'validate-hold-entry'},
  ];

  return {
    summary: '整定完成后自动执行一段关节闭环验证轨迹，用于可视化确认最优 Kp/Ki/Kd 已经回写到机器人，并观察误差收敛与姿态响应。',
    profile: '整定后闭环复验',
    planner: '验证轨迹: 关节往返激励',
    parameterization: '时间参数化: 分段样条',
    controller: '关节位置伺服 / Auto Applied',
    gripperMode: '末端吸盘待机',
    clearance: '控制器验证阶段不执行抓取',
    transferMode: '闭环跟踪验证',
    cycleTime: '优先可观测性',
    smoothness: '高阻尼',
    accuracy: '用于整定结果复验',
    pickupBoxId: null,
    waypoints: [
      {name: '初始位', pose: 'home', note: '使用最优参数进入基线姿态。'},
      {name: '往返验证', pose: 'forward / reverse', note: '对各关节做组合激励，观察误差和速度峰值。'},
      {name: '回零收敛', pose: 'settle', note: '返回基线姿态，确认闭环稳定收敛。'},
    ],
    phases: [
      {name: '回写', focus: '最优 Kp/Ki/Kd', speed: '静态', note: '先把最优整定结果注入当前机器人模型。'},
      {name: '复验', focus: '往返组合轨迹', speed: '中速', note: '自动播放验证轨迹，直接观察整定后的仿真效果。'},
      {name: '收敛', focus: '误差回零', speed: '低速', note: '确认位置闭环不会发散或长时间振荡。'},
    ],
    samples,
  };
}

function refineServoFromMetrics(
  previous: ServoTuningResult,
  metrics: ServoTuningRoundMetrics,
  round: number,
): ServoTuningResult {
  const errorGain = metrics.peakError > 0.2 ? 1.24 : metrics.peakError > 0.1 ? 1.14 : 1.06;
  const dampingGain = metrics.peakVelocity > 1.2 ? 1.22 : metrics.peakVelocity > 0.6 ? 1.12 : 1.05;
  const torqueGuard = metrics.peakTorque > 180 ? 0.94 : 1;
  const motionRescue = metrics.motionDetected ? 1 : 1.35;

  return {
    ...previous,
    status: `第 ${round} 轮整定完成，准备进入第 ${round + 1} 轮复测。`,
    summary: `根据第 ${round} 轮辨识结果自动修正伺服参数：若跟踪误差偏大则提高刚度，若速度峰值偏大则增强阻尼，若关节几乎不动则显著提高驱动增益以解除停滞。`,
    tuningTime: `${round + 1} 轮辨识 / ${12 + round * 6} 次试验`,
    dominantGoal: metrics.motionDetected ? '误差收敛优化' : '解除停滞优先',
    joints: previous.joints.map((joint, index) => {
      const distalRelief = 1 - index * 0.018;
      return clampServoConfig({
        ...joint,
        kp: Math.round(joint.kp * errorGain * torqueGuard * motionRescue * distalRelief),
        ki: Math.max(1, Math.round(joint.ki * (metrics.averageError > 0.04 ? 1.08 : 1.02))),
        kd: Math.round(joint.kd * dampingGain * (1 - index * 0.012)),
      }, index);
    }),
  };
}

function buildSceneSpec(sceneText: string, taskText: string): SceneSpec {
  const sceneLower = sceneText.toLowerCase();
  const taskLower = taskText.toLowerCase();
  const merged = `${sceneLower} ${taskLower}`;
  const hasConveyor = /conveyor|传送|流水线|输送/.test(merged);
  const hasPallet = /pallet|托盘|码垛|垛/.test(merged);
  const hasBin = /bin|料箱|周转箱|箱体|箱子|纸箱|箱/.test(merged);
  const hasTable = /table|工作台|台面/.test(merged);
  const wantsBoxes = /箱体|箱子|纸箱|抓取|搬运|码垛|装箱/.test(merged);
  const sceneLeftMention = /左|left/.test(sceneLower);
  const sceneRightMention = /右|right/.test(sceneLower);
  const dualPallet =
    hasPallet &&
    (/(左右|left.*right|right.*left|2个托盘|两个托盘|左右2个托盘区|左右两个托盘区)/.test(sceneLower) ||
      (sceneLeftMention && sceneRightMention));
  const boxCountMatch = sceneLower.match(/(\d+)\s*个?箱/);
  const boxCount = boxCountMatch ? Math.max(1, Number(boxCountMatch[1])) : hasPallet ? 4 : 2;
  const boxesInitialOnLeft =
    /(初始.*左边托盘|初始.*左侧托盘|初始.*左托盘|放在左边托盘|放在左侧托盘|放在左托盘|左边托盘上|左侧托盘上|左托盘上)/.test(
      sceneLower,
    );
  const boxesInitialOnRight =
    /(初始.*右边托盘|初始.*右侧托盘|初始.*右托盘|放在右边托盘|放在右侧托盘|放在右托盘|右边托盘上|右侧托盘上|右托盘上)/.test(
      sceneLower,
    );
  const taskSourceLeft = /(从左边托盘|从左侧托盘|从左托盘|将左边托盘上|将左侧托盘上|将左托盘上)/.test(taskLower);
  const taskSourceRight = /(从右边托盘|从右侧托盘|从右托盘|将右边托盘上|将右侧托盘上|将右托盘上)/.test(taskLower);
  const initialBoxesSide = boxesInitialOnLeft || (!boxesInitialOnRight && taskSourceLeft)
    ? 'left'
    : boxesInitialOnRight || taskSourceRight
      ? 'right'
      : 'left';

  const objects: SceneObjectSpec[] = [];

  if (hasConveyor) objects.push({ id: 'conveyor', kind: 'conveyor', pos: [0.96, 0, 0.28], size: [0.72, 0.24, 0.08], rgba: [0.2, 0.23, 0.28, 1] });
  if (hasPallet && dualPallet) {
    objects.push({ id: 'pallet_left', kind: 'pallet', pos: [0.55, 0.42, 0.07], size: [0.24, 0.24, 0.07], rgba: [0.56, 0.37, 0.17, 1] });
    objects.push({ id: 'pallet_right', kind: 'pallet', pos: [0.95, -0.42, 0.07], size: [0.24, 0.24, 0.07], rgba: [0.56, 0.37, 0.17, 1] });
  } else if (hasPallet) {
    objects.push({ id: 'pallet', kind: 'pallet', pos: [0.82, -0.52, 0.07], size: [0.24, 0.24, 0.07], rgba: [0.56, 0.37, 0.17, 1] });
  }
  if (hasBin) {
    objects.push({ id: 'bin_left', kind: 'bin', pos: [0.54, 0.68, 0.12], size: [0.11, 0.15, 0.12], rgba: [0.18, 0.42, 0.86, 1] });
    if (dualPallet) {
      objects.push({ id: 'bin_right', kind: 'bin', pos: [0.96, -0.68, 0.12], size: [0.11, 0.15, 0.12], rgba: [0.18, 0.42, 0.86, 1] });
    }
  }
  if (hasTable) objects.push({ id: 'table', kind: 'table', pos: [0.72, 0, 0.42], size: [0.46, 0.32, 0.04], rgba: [0.35, 0.37, 0.4, 1] });

  if (wantsBoxes) {
    const baseX = dualPallet ? (initialBoxesSide === 'right' ? 0.95 : 0.55) : hasConveyor ? 0.9 : 0.68;
    const baseY = dualPallet ? (initialBoxesSide === 'right' ? -0.42 : 0.42) : hasConveyor ? 0 : 0.18;
    const baseZ = dualPallet ? 0.16 : hasConveyor ? 0.41 : 0.1;
    const columns = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(boxCount))));
    for (let index = 0; index < boxCount; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      objects.push({
        id: `box_${index + 1}`,
        kind: 'box',
        pos: [
          baseX + (column - (columns - 1) / 2) * 0.06,
          baseY + (row - Math.floor((Math.ceil(boxCount / columns) - 1) / 2)) * 0.06,
          baseZ + 0.045,
        ],
        size: [0.028, 0.028, 0.045],
        rgba: [0.22, 0.74, 0.68, 1],
      });
    }
  }

  const summaryParts = [
    hasConveyor ? '输送线' : null,
    dualPallet ? '左右托盘区' : hasPallet ? '托盘区' : null,
    hasBin ? '料箱' : null,
    hasTable ? '工作台' : null,
    wantsBoxes ? `${objects.filter((item) => item.kind === 'box').length} 个箱体` : null,
    dualPallet && wantsBoxes ? (initialBoxesSide === 'right' ? '箱体初始在右托盘' : '箱体初始在左托盘') : null,
  ].filter(Boolean);

  return {
    summary: summaryParts.length > 0 ? `已识别对象：${summaryParts.join('、')}` : '未识别到明确对象，保持机器人基础工位。',
    objects,
  };
}

function buildGeneratedSceneXml(spec: SceneSpec, servoConfig: ServoJointConfig[] = SERVO_BASELINE) {
  const objectBlock = spec.objects
    .map((item) => {
      if (item.kind === 'box') {
        return [
          `<body name="${item.id}_body" pos="${item.pos.join(' ')}">`,
          `  <freejoint name="${item.id}_free"/>`,
          `  <geom name="${item.id}" type="box" size="${item.size.join(' ')}" rgba="${item.rgba.join(' ')}" density="260" friction="0.9 0.08 0.02" solref="0.01 1"/>`,
          `</body>`,
        ].join('\n    ');
      }
      if (item.kind === 'table') {
        const [x, y, z] = item.pos;
        const [sx, sy, sz] = item.size;
        return [
          `<geom name="${item.id}_top" type="box" pos="${x} ${y} ${z}" size="${sx} ${sy} ${sz}" rgba="${item.rgba.join(' ')}" />`,
          `<geom name="${item.id}_leg_1" type="box" pos="${(x - sx + 0.03).toFixed(3)} ${(y - sy + 0.03).toFixed(3)} ${(z - 0.21).toFixed(3)}" size="0.025 0.025 0.21" rgba="0.28 0.3 0.34 1" />`,
          `<geom name="${item.id}_leg_2" type="box" pos="${(x + sx - 0.03).toFixed(3)} ${(y - sy + 0.03).toFixed(3)} ${(z - 0.21).toFixed(3)}" size="0.025 0.025 0.21" rgba="0.28 0.3 0.34 1" />`,
          `<geom name="${item.id}_leg_3" type="box" pos="${(x - sx + 0.03).toFixed(3)} ${(y + sy - 0.03).toFixed(3)} ${(z - 0.21).toFixed(3)}" size="0.025 0.025 0.21" rgba="0.28 0.3 0.34 1" />`,
          `<geom name="${item.id}_leg_4" type="box" pos="${(x + sx - 0.03).toFixed(3)} ${(y + sy - 0.03).toFixed(3)} ${(z - 0.21).toFixed(3)}" size="0.025 0.025 0.21" rgba="0.28 0.3 0.34 1" />`,
        ].join('\n    ');
      }
      return `<geom name="${item.id}" type="box" pos="${item.pos.join(' ')}" size="${item.size.join(' ')}" rgba="${item.rgba.join(' ')}" />`;
    })
    .join('\n    ');

  const actuatorBlock = servoConfig
    .map(
      (joint) =>
        `<motor name="servo_${joint.name}" joint="${joint.name}" gear="1" ctrllimited="true" ctrlrange="${joint.forcerange[0]} ${joint.forcerange[1]}"/>`,
    )
    .join('\n    ');

  return `<mujoco model="ER15-1400-generated">
  <compiler angle="radian"/>
  <option timestep="${PHYSICS_SIM_DT}" gravity="0 0 -9.81" integrator="implicitfast" iterations="80" ls_iterations="20"/>

  <default>
    <geom condim="4" solref="0.008 1" solimp="0.93 0.97 0.001" friction="0.8 0.05 0.01"/>
    <joint damping="10" armature="0.1" frictionloss="0.06"/>
  </default>

  <contact>
    <exclude body1="link_1" body2="link_2"/>
    <exclude body1="link_2" body2="link_3"/>
    <exclude body1="link_3" body2="link_4"/>
    <exclude body1="link_4" body2="link_5"/>
    <exclude body1="link_5" body2="link_6"/>
    <exclude body1="link_6" body2="suction_tool"/>
  </contact>

  <asset>
    <mesh name="b_link" file="b_link.STL"/>
    <mesh name="l_1" file="l_1.STL"/>
    <mesh name="l_2" file="l_2.STL"/>
    <mesh name="l_3" file="l_3.STL"/>
    <mesh name="l_4" file="l_4.STL"/>
    <mesh name="l_5" file="l_5.STL"/>
    <mesh name="l_6" file="l_6.STL"/>
  </asset>

  <worldbody>
    <geom type="mesh" rgba="1 0 0 1" mesh="b_link" contype="0" conaffinity="0"/>
    ${objectBlock}
    <body name="link_1" pos="0 0 0.43">
      <inertial pos="0.09835 -0.02908 -0.0995" quat="0.934022 0.0709797 0.344228 -0.0638068" mass="54.52" diaginertia="1.57017 1.42487 0.582675"/>
      <joint name="joint_1" pos="0 0 0" axis="0 0 1" range="-2.967 2.967"/>
      <geom pos="0 0 -0.43" quat="1 0 0 0" type="mesh" rgba="0 0 0.6 1" mesh="l_1" contype="0" conaffinity="0"/>
      <body name="link_2" pos="0.18 0 0" quat="0.5 0.5 -0.5 0.5">
        <inertial pos="0.25263 -0.00448 0.15471" quat="0.00975051 0.695349 0.0192882 0.718347" mass="11.11" diaginertia="0.602971 0.582765 0.0443882"/>
        <joint name="joint_2" pos="0 0 0" axis="0 0 1" range="-2.7925 1.5708"/>
        <geom pos="0 0 0" quat="0.707107 0 0 -0.707107" type="mesh" rgba="1 0 0 1" mesh="l_2" contype="0" conaffinity="0"/>
        <body name="link_3" pos="0.58 0 0">
          <inertial pos="0.03913 -0.02495 0.03337" quat="0.887953 -0.0301162 -0.0105448 0.458826" mass="25.03" diaginertia="0.435155 0.287985 0.240747"/>
          <joint name="joint_3" pos="0 0 0" axis="0 0 1" range="-1.4835 3.0543"/>
          <geom quat="0.707107 0 0 -0.707107" type="mesh" rgba="0 0 0.8 1" mesh="l_3" contype="0" conaffinity="0"/>
          <body name="link_4" pos="0.16 -0.64 0" quat="2.08523e-10 -2.08523e-10 -0.707107 0.707107">
            <inertial pos="-0.00132 -0.0012 -0.30035" quat="0.999952 0.00962981 -0.001782 -0.000972932" mass="10.81" diaginertia="0.280666 0.271512 0.0441655"/>
            <joint name="joint_4" pos="0 0 0" axis="0 0 1" range="-3.316 3.316"/>
            <geom pos="0 0 -0.64" quat="2.08523e-10 0.707107 -0.707107 -2.08523e-10" type="mesh" rgba="0 0.9 0.9 1" mesh="l_4" contype="0" conaffinity="0"/>
            <body name="link_5" quat="2.08523e-10 -2.08523e-10 -0.707107 0.707107">
              <inertial pos="0.0004 -0.03052 0.01328" quat="0.542754 0.83988 -0.00430534 0.00104246" mass="4.48" diaginertia="0.0171016 0.0148763 0.0101901"/>
              <joint name="joint_5" pos="0 0 0" axis="0 0 1" range="-2.2689 2.2689"/>
              <geom quat="0.707107 0 0 -0.707107" type="mesh" rgba="1 0 0 1" mesh="l_5" contype="0" conaffinity="0"/>
              <body name="link_6" pos="0 -0.116 0" quat="0.707107 0.707107 0 0">
                <inertial pos="0 0 0" quat="0.152312 0.688563 -0.0933315 0.702831" mass="0.28" diaginertia="0.00154943 0.000787579 0.000761856"/>
                <joint name="joint_6" pos="0 0 0" axis="0 0 1" range="-6.2832 6.2832"/>
                <geom quat="2.08523e-10 0.707107 0.707107 2.08523e-10" type="mesh" rgba="0.9 0.9 0.9 1" mesh="l_6" contype="0" conaffinity="0"/>
                <body name="suction_tool" pos="0 0 -0.12">
                  <geom name="suction_pad" type="cylinder" size="0.024 0.012" rgba="0.14 0.16 0.19 1" mass="0.08" contype="0" conaffinity="0"/>
                  <site name="tool_center" pos="0 0 -0.012" size="0.018" rgba="0.15 0.95 0.9 0.35"/>
                </body>
              </body>
            </body>
          </body>
        </body>
      </body>
    </body>
  </worldbody>
  <actuator>
    ${actuatorBlock}
  </actuator>
</mujoco>`;
}

function buildTrajectoryPlan(sceneText: string, taskText: string, objectiveText: string) {
  const merged = `${sceneText} ${taskText}`.toLowerCase();
  const inferred = inferObjectiveWeights(objectiveText);
  const precisionWeight = inferred.precision;
  const stabilityWeight = inferred.stability;
  const vibrationWeight = inferred.vibration;
  const cycleWeight = inferred.cycle;
  const energyWeight = inferred.energy;
  const isPalletizing = /码垛|托盘|pallet/.test(merged);
  const sourceIsLeft = /左边托盘|左侧托盘|左托盘|from left|从左/.test(merged);
  const targetIsRight = /右边托盘|右侧托盘|右托盘|to right|到右/.test(merged);
  const sourceSide = sourceIsLeft ? '左托盘' : '上料区';
  const targetSide = targetIsRight ? '右托盘' : '堆放区';
  const liftHeight = vibrationWeight >= 25 ? '180 mm' : '130 mm';
  const blendRadius = vibrationWeight >= 25 ? '60 mm' : '35 mm';
  const transferStyle = cycleWeight >= precisionWeight ? '直接转运' : '分段转运';
  const approachSpeed = precisionWeight >= 35 ? '0.22 m/s' : '0.32 m/s';
  const transferSpeed = cycleWeight >= 20 ? '0.55 m/s' : '0.42 m/s';
  const settleWindow = stabilityWeight >= 28 || precisionWeight >= 35 ? '120 ms' : '60 ms';
  const energyMode = energyWeight >= 20 ? '限扭巡航' : '标准巡航';
  const sourceYaw = sourceIsLeft ? 1.08 : -1.08;
  const targetYaw = targetIsRight ? -1.08 : 1.08;
  const pickShoulder = sourceIsLeft ? -1.15 : -1.02;
  const placeShoulder = targetIsRight ? -1.04 : -1.14;
  const carryShoulder = cycleWeight >= 35 ? -0.72 : -0.82;

  const waypoints: TrajectoryPlanWaypoint[] = [
    {
      name: '抓取接近',
      pose: `${sourceSide} 预抓取位`,
      note: '从安全高度切入抓取位，先避开托盘边缘与已堆码箱体。',
    },
    {
      name: '抓取接触',
      pose: `${sourceSide} 抓取位`,
      note: '末端对箱体中心建立夹持姿态，保留短暂停留窗口。',
    },
    {
      name: '越障抬升',
      pose: `垂直抬升 +${liftHeight}`,
      note: '抬升到统一越障高度，避免与托盘、堆叠箱体和围栏干涉。',
    },
    {
      name: '转运弧段',
      pose: `${sourceSide} -> ${targetSide}`,
      note: `经由上方转运通道完成跨工位搬运，路径圆角半径 ${blendRadius}。`,
    },
    {
      name: '放置下降',
      pose: `${targetSide} 放置位`,
      note: '对目标托盘执行对齐下降，预留轻触地与退刀路径。',
    },
  ];

  const phases: TrajectoryPlanPhase[] = [
    {
      name: '接近',
      focus: waypoints[0]?.pose ?? '预抓取位',
      speed: approachSpeed,
      note: `低速下降并保留 ${settleWindow} 稳定窗口，保证抓取可靠性`,
    },
    {
      name: 'Pick',
      focus: waypoints[1]?.pose ?? '抓取位',
      speed: '0.12 m/s',
      note: '短暂停姿并确认负载，随后再执行离托抬升',
    },
    {
      name: '抬升',
      focus: waypoints[2]?.pose ?? '抬升位',
      speed: '0.18 m/s',
      note: `离开托盘时保持 ${liftHeight} 安全越障高度`,
    },
    {
      name: '转运',
      focus: waypoints[3]?.pose ?? '转运段',
      speed: transferSpeed,
      note: `${transferStyle}，并采用 上方转运 / 圆角半径 ${blendRadius}`,
    },
    {
      name: '放置',
      focus: waypoints[4]?.pose ?? '放置位',
      speed: '0.16 m/s',
      note: '最终放置阶段采用精度优先与柔和接触落点策略',
    },
  ];

  const samples: TrajectoryPlanSample[] = [
    { time: 0, joints: [0, -0.72, 1.28, 0, 1.02, 0], suction: false, label: 'home' },
    { time: 1.2, joints: [sourceYaw, pickShoulder + 0.2, 1.38, 0, 1.18, 0], suction: false, label: 'pre-pick' },
    { time: 2.1, joints: [sourceYaw, pickShoulder, 1.62, 0.02, 1.01, 0], suction: false, label: 'pick-contact' },
    { time: 2.5, joints: [sourceYaw, pickShoulder, 1.62, 0.02, 1.01, 0], suction: true, label: 'suction-on' },
    { time: 3.4, joints: [sourceYaw * 0.98, carryShoulder, 1.32, 0.04, 1.12, 0], suction: true, label: 'lift' },
    { time: 4.9, joints: [0, carryShoulder + 0.08, 1.22, 0, 0.98, 0], suction: true, label: 'transfer' },
    { time: 6.1, joints: [targetYaw, placeShoulder + 0.12, 1.42, 0, 1.12, 0], suction: true, label: 'pre-place' },
    { time: 7.1, joints: [targetYaw, placeShoulder, 1.6, -0.02, 0.98, 0], suction: true, label: 'place-contact' },
    { time: 7.4, joints: [targetYaw, placeShoulder, 1.6, -0.02, 0.98, 0], suction: false, label: 'release' },
    { time: 8.3, joints: [targetYaw * 0.92, carryShoulder, 1.28, 0, 1.08, 0], suction: false, label: 'retreat' },
  ];

  return {
    summary: isPalletizing
      ? '已完成统一轨迹规划：先用 RRT 生成无碰关键路点，再用 TOPPRA 做时间参数化，得到可执行的码垛轨迹。'
      : '已完成统一轨迹规划：基于 RRT 路由和 TOPPRA 时间参数化生成可执行轨迹。',
    profile: `${isPalletizing ? '码垛统一轨迹' : '通用统一轨迹'} / ${transferStyle} / ${energyMode}`,
    planner: '几何规划: RRT Connect',
    parameterization: '时间参数化: TOPPRA',
    controller: '关节位置伺服 / Position Servo',
    gripperMode: '末端吸盘吸附与释放',
    clearance: `${liftHeight} 安全越障高度`,
    transferMode: `上方转运 / 圆角半径 ${blendRadius}`,
    cycleTime: cycleWeight >= 20 ? '优先提高转运节拍' : '保持节拍均衡',
    smoothness: vibrationWeight >= 25 ? '高平滑度 / 更大圆角半径' : '标准平滑度',
    accuracy: precisionWeight >= 35 ? '已启用高精度接近与落点控制' : '采用标准接近窗口',
    pickupBoxId: 'box_1',
    waypoints,
    phases,
    samples,
  } satisfies TrajectoryPlan;
}
function getModuleMeta(id: ModuleId) {
  return MODULES.find((module) => module.id === id) ?? MODULES[0];
}

function SideBarSection(props: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--card-border)] px-4 py-4">
      <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
        <span>{props.title}</span>
        {props.footer}
      </div>
      {props.children}
    </section>
  );
}

function DataRow(props: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">{props.label}</span>
      <span className={`font-mono ${props.tone ?? 'text-main'}`}>{props.value}</span>
    </div>
  );
}

function StatusPill(props: { label: string; tone?: string }) {
  return (
    <span
      className={`rounded-sm border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${
        props.tone ?? 'text-muted'
      }`}
    >
      {props.label}
    </span>
  );
}

function EditorChrome(props: { title: string; description: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[var(--card-border)] px-5 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">编辑区</div>
          <div className="mt-1 text-lg font-semibold text-main">{props.title}</div>
          <div className="mt-1 text-sm text-muted">{props.description}</div>
        </div>
        <div className="flex items-center gap-2">{props.actions}</div>
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </div>
  );
}

function StepButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className={`relative -mb-px min-w-[140px] border border-b-0 px-5 py-3 text-base font-semibold tracking-[0.04em] transition-colors ${
        props.active
          ? 'border-[var(--card-border)] bg-[var(--bg-main)] text-main'
          : 'border-transparent bg-[#182132] text-muted hover:border-white/10 hover:bg-white/[0.04] hover:text-main'
      }`}
    >
      {props.label}
    </button>
  );
}

function SectionTitle(props: { icon: React.ComponentType<{ size?: number }>; label: string; tone?: string }) {
  const Icon = props.icon;
  return (
    <div className={`mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${props.tone ?? 'text-muted'}`}>
      <Icon size={14} />
      {props.label}
    </div>
  );
}

function MetricCard(props: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{props.label}</div>
      <div className={`mt-2 font-mono text-sm ${props.tone ?? 'text-main'}`}>{props.value}</div>
    </div>
  );
}

function StudioOperationPanel(props: {
  step: StudioStep;
  objectivePrompt: string;
  objectiveWeights: ReturnType<typeof inferObjectiveWeights>;
  onObjectivePromptChange: (value: string) => void;
  trajectoryPlan: TrajectoryPlan | null;
  trajectoryStatus: string;
  onPlanTrajectory: () => void;
  servoTuning: ServoTuningResult;
  servoOptimizeJob: ServoOptimizeJobState;
  controlMode: ServoControlMode;
  onControlModeChange: (value: ServoControlMode) => void;
  onAutoTuneServo: () => void;
}) {
  if (props.step === 'scene') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={FolderTree} label="场景" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">杞﹂棿鐜 + 6杞村伐涓氭満鍣ㄤ汉</div>
        </div>
        <div>
          <SectionTitle icon={Activity} label="任务" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">鍖呰鐮佸灈</div>
        </div>
        <div>
          <SectionTitle icon={Gauge} label="目标" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">安全 / 高速 / 低振动</div>
        </div>
      </div>
    );
  }

  if (props.step === 'objective') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={Gauge} label="目标描述" tone="text-emerald-400" />
          <textarea
            value={props.objectivePrompt}
            onChange={(event) => props.onObjectivePromptChange(event.target.value)}
            className="min-h-[96px] w-full resize-none bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-main outline-none"
          />
        </div>
        <div>
          <SectionTitle icon={Brain} label="权重分配" tone="text-blue-400" />
          <div className="space-y-4">
              {[
                { label: '精度', value: props.objectiveWeights.precision },
                { label: '稳定性', value: props.objectiveWeights.stability },
                { label: '振动', value: props.objectiveWeights.vibration },
                { label: '节拍', value: props.objectiveWeights.cycle },
                { label: '能耗', value: props.objectiveWeights.energy },
            ].map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted">{item.label}</span>
                  <span className="font-mono text-blue-400">{item.value}%</span>
                </div>
                <div className="h-1.5 bg-white/10">
                  <div className="h-1.5 bg-blue-500" style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle icon={GitBranch} label="轨迹规划" tone="text-amber-400" />
          <div className="space-y-3 bg-white/[0.03] px-4 py-4 text-sm">
            <div className="leading-relaxed text-muted">
              使用成熟工具箱完成统一规划：先由 RRT 建立无碰撞几何路径，再由 TOPPRA 做速度约束与时间参数化。
            </div>
            <div className="font-mono text-xs text-blue-400">{props.trajectoryStatus}</div>
            <button
              onClick={props.onPlanTrajectory}
              className="flex items-center gap-2 bg-emerald-500 px-4 py-3 text-sm font-semibold text-white"
            >
              <Zap size={14} /> 生成任务轨迹
            </button>
          </div>
        </div>
        {props.trajectoryPlan ? (
          <div>
            <SectionTitle icon={Activity} label="轨迹结果" tone="text-emerald-400" />
            <div className="space-y-3">
              <div className="bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-main">{props.trajectoryPlan.summary}</div>
              <div className="grid gap-3 md:grid-cols-2">
                <MetricCard label="几何规划" value={props.trajectoryPlan.planner} tone="text-amber-300" />
                <MetricCard label="时间参数化" value={props.trajectoryPlan.parameterization} tone="text-emerald-300" />
                <MetricCard label="控制方式" value={props.trajectoryPlan.controller} tone="text-blue-300" />
                <MetricCard label="末端执行" value={props.trajectoryPlan.gripperMode} tone="text-cyan-300" />
              </div>
              {props.trajectoryPlan.waypoints.map((waypoint) => (
                <div key={waypoint.name} className="bg-white/[0.03] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-main">{waypoint.name}</span>
                    <span className="font-mono text-xs text-amber-300">{waypoint.pose}</span>
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-blue-300">{waypoint.note}</div>
                </div>
              ))}
              {props.trajectoryPlan.phases.map((phase) => (
                <div key={phase.name} className="bg-white/[0.03] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-main">{phase.name}</span>
                    <span className="font-mono text-xs text-emerald-300">{phase.speed}</span>
                  </div>
                  <div className="mt-2 text-muted">{phase.focus}</div>
                  <div className="mt-1 text-xs leading-relaxed text-blue-300">{phase.note}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (props.step === 'controller') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={Bot} label="控制器" tone="text-violet-400" />
          <div className="mb-4 flex gap-2 text-sm">
            {['PID', 'MPC', 'LQR'].map((type, index) => (
              <div key={type} className={`px-3 py-2 ${index === 0 ? 'bg-violet-500/10 text-violet-300' : 'bg-white/[0.03] text-muted'}`}>
                {type}
              </div>
            ))}
          </div>
          <div className="space-y-3 bg-white/[0.03] px-4 py-4 text-sm">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">控制模式</div>
              <div className="grid gap-2 md:grid-cols-2">
                {([
                  { id: 'pid' as const, label: '纯 PID', note: '只使用反馈闭环，不加力矩前馈。' },
                  { id: 'feedforward' as const, label: '带前馈', note: '使用计算力矩前馈 + PID 残差。' },
                ]).map((item) => (
                  <label
                    key={item.id}
                    className={`cursor-pointer border px-3 py-3 transition-colors ${
                      props.controlMode === item.id ? 'border-violet-400 bg-violet-500/10 text-main' : 'border-white/10 bg-white/[0.02] text-muted'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="servo-control-mode"
                        value={item.id}
                        checked={props.controlMode === item.id}
                        onChange={() => props.onControlModeChange(item.id)}
                        className="accent-violet-400"
                      />
                      <div>
                        <div className="font-semibold text-main">{item.label}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted">{item.note}</div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="leading-relaxed text-muted">
              当前先聚焦机器人关节位置伺服。点击整定按钮后，会调用参考 PerOpt 机制实现的后台多参数并行搜索器，在后台多进程完成参数寻优；搜索过程不占用仿真窗口，只回显最优结果并回写到 MuJoCo 关节 actuator。
            </div>
            <div className="font-mono text-xs text-blue-400">{props.servoTuning.status}</div>
            <button
              onClick={props.onAutoTuneServo}
              className="flex items-center gap-2 bg-violet-500 px-4 py-3 text-sm font-semibold text-white"
            >
              <Settings size={14} /> 参数整定
            </button>
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard label="后台状态" value={props.servoOptimizeJob.status === 'running' ? '并行搜索中' : props.servoOptimizeJob.status === 'completed' ? '已完成' : props.servoOptimizeJob.status === 'error' ? '失败' : '待启动'} tone="text-violet-300" />
              <MetricCard label="Trial 进度" value={props.servoOptimizeJob.total > 0 ? `${props.servoOptimizeJob.done}/${props.servoOptimizeJob.total}` : '-'} tone="text-emerald-300" />
              <MetricCard label="搜索轮次" value={`${props.servoOptimizeJob.rounds}`} tone="text-amber-300" />
              <MetricCard label="每轮试验" value={`${props.servoOptimizeJob.trialsPerRound}`} tone="text-blue-300" />
            </div>
          </div>
        </div>
        <div>
          <SectionTitle icon={Brain} label="整定结果" tone="text-emerald-400" />
          <div className="space-y-3">
            <div className="bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-main">{props.servoTuning.summary}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <MetricCard label="整定算法" value={props.servoTuning.method} tone="text-violet-300" />
              <MetricCard label="控制目标" value={props.servoTuning.dominantGoal} tone="text-emerald-300" />
              <MetricCard label="辨识预算" value={props.servoTuning.tuningTime} tone="text-amber-300" />
              <MetricCard label="执行方式" value={`${describeControlMode(props.controlMode)} / Joint Servo`} tone="text-blue-300" />
            </div>
            {props.servoOptimizeJob.bestMetrics ? (
              <div className="grid gap-3 md:grid-cols-2">
                <MetricCard label="最优 Trial" value={`${props.servoOptimizeJob.bestTrial}`} tone="text-violet-300" />
                <MetricCard label="峰值误差" value={`${props.servoOptimizeJob.bestMetrics.peakError.toFixed(4)} rad`} tone="text-rose-300" />
                <MetricCard label="平均误差" value={`${props.servoOptimizeJob.bestMetrics.meanError.toFixed(4)} rad`} tone="text-emerald-300" />
                <MetricCard label="峰值力矩" value={`${props.servoOptimizeJob.bestMetrics.peakTorque.toFixed(2)} Nm`} tone="text-amber-300" />
                <MetricCard label="收敛时间" value={`${props.servoOptimizeJob.bestMetrics.settleTime.toFixed(3)} s`} tone="text-blue-300" />
                <MetricCard label="振荡次数" value={`${props.servoOptimizeJob.bestMetrics.oscillationPenalty ?? 0}`} tone="text-violet-300" />
                <MetricCard label="稳定性指数" value={`${(props.servoOptimizeJob.bestMetrics.stabilityIndex ?? 0).toFixed(2)}`} tone="text-cyan-300" />
                <MetricCard label="静态均误差" value={`${(props.servoOptimizeJob.bestMetrics.holdMeanError ?? 0).toFixed(4)} rad`} tone="text-emerald-300" />
                <MetricCard label="静态峰速度" value={`${(props.servoOptimizeJob.bestMetrics.holdPeakVelocity ?? 0).toFixed(4)} rad/s`} tone="text-rose-300" />
              </div>
            ) : null}
            <div className="space-y-3">
              {props.servoTuning.joints.map((joint) => (
                <div key={joint.name} className="bg-white/[0.03] px-4 py-3 text-sm">
                  {(() => {
                    const index = SERVO_BASELINE.findIndex((item) => item.name === joint.name);
                    const bounds = getServoGainBounds(joint, index >= 0 ? index : 0);
                    const kpNearMax = joint.kp >= bounds.kpMax * 0.96;
                    const kdNearMax = joint.kd >= bounds.kdMax * 0.96;
                    const kiNearMax = joint.ki >= bounds.kiMax * 0.96;
                    return (
                      <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="font-semibold text-main">{joint.name}</span>
                    <span className={`font-mono text-xs ${kpNearMax || kdNearMax || kiNearMax ? 'text-amber-300' : 'text-violet-300'}`}>
                      {kpNearMax || kdNearMax || kiNearMax ? '参数接近上限' : '位置伺服已更新'}
                    </span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricCard label="Kp" value={`${joint.kp}`} tone="text-main" />
                    <MetricCard label="Ki" value={`${joint.ki}`} tone="text-emerald-300" />
                    <MetricCard label="Kd" value={`${joint.kd}`} tone="text-amber-300" />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <MetricCard label="Kp 范围" value={`${bounds.kpMin} .. ${bounds.kpMax}`} tone={kpNearMax ? 'text-amber-300' : 'text-muted'} />
                    <MetricCard label="Ki 范围" value={`${bounds.kiMin.toFixed(2)} .. ${bounds.kiMax.toFixed(2)}`} tone={kiNearMax ? 'text-amber-300' : 'text-muted'} />
                    <MetricCard label="Kd 范围" value={`${bounds.kdMin} .. ${bounds.kdMax}`} tone={kdNearMax ? 'text-amber-300' : 'text-muted'} />
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <SectionTitle icon={Server} label="计算预算" tone="text-emerald-400" />
          <div className="space-y-3">
            <MetricCard label="并行环境批次" value={`${OPTIMIZATION_DEFAULTS.trials_per_round}`} tone="text-emerald-400" />
            <MetricCard label="采样轮数" value={`${OPTIMIZATION_DEFAULTS.rounds}`} />
            <MetricCard label="候选更新步" value={`${OPTIMIZATION_DEFAULTS.jobs}`} />
            <MetricCard label="回放步长" value={`${appRuntimeConfig.replay.dt.toFixed(2)} s`} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
          <SectionTitle icon={Shield} label="准备状态" tone="text-emerald-400" />
        <div className="space-y-2">
          <DataRow label="模型" value="已编译" tone="text-emerald-400" />
          <DataRow label="碰撞探测" value="就绪" tone="text-emerald-400" />
          <DataRow label="控制器" value="PID 基线" tone="text-blue-400" />
          <DataRow label="目标" value="安全优先提速" tone="text-blue-400" />
        </div>
      </div>
      <div>
        <button className="flex items-center gap-2 bg-emerald-500 px-4 py-3 text-sm font-semibold text-white">
          <Play size={14} /> 鍚姩鑷姩浼樺寲
        </button>
      </div>
    </div>
  );
}

function StudioSceneGeneratorPanel(props: {
  scenePrompt: string;
  taskPrompt: string;
  generationStatus: string;
  generatedSummary: string;
  onScenePromptChange: (value: string) => void;
  onTaskPromptChange: (value: string) => void;
  onGenerateScene: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle icon={FolderTree} label="场景描述" tone="text-blue-400" />
        <textarea
          value={props.scenePrompt}
          onChange={(event) => props.onScenePromptChange(event.target.value)}
          className="min-h-[92px] w-full resize-none bg-white/[0.03] px-4 py-3 text-sm text-main outline-none"
        />
      </div>
      <div>
        <SectionTitle icon={Activity} label="任务描述" tone="text-blue-400" />
        <textarea
          value={props.taskPrompt}
          onChange={(event) => props.onTaskPromptChange(event.target.value)}
          className="min-h-[92px] w-full resize-none bg-white/[0.03] px-4 py-3 text-sm text-main outline-none"
        />
      </div>
      <div>
        <SectionTitle icon={Gauge} label="生成环境" tone="text-emerald-400" />
        <div className="space-y-3 bg-white/[0.03] px-4 py-4 text-sm">
          <div className="leading-relaxed text-muted">{props.generatedSummary}</div>
          <div className="font-mono text-xs text-blue-400">{props.generationStatus}</div>
          <button
            onClick={props.onGenerateScene}
            className="flex items-center gap-2 bg-emerald-500 px-4 py-3 text-sm font-semibold text-white"
          >
            <Play size={14} /> 生成 MuJoCo 场景
          </button>
        </div>
      </div>
    </div>
  );
}

function StudioWorkbench() {
  const emptyRobotStatus: ViewerRuntimeStatus = { phase: '待机', collisionActiveCount: 0, lastCollisionPair: '-', joints: [] };
  const [step, setStep] = useState<StudioStep>('scene');
  const [scenePrompt, setScenePrompt] = useState('车间环境，包含ER15-1400 机器人工作单元和左右2个托盘区。其中，左侧托盘中摆放了10个箱体。');
  const [taskPrompt, setTaskPrompt] = useState('机器人执行包装码垛，将左边托盘中的箱体抓取后放到右边托盘。');
  const [objectivePrompt, setObjectivePrompt] = useState('在保证机器人和操作安全的前提下，尽量提高速度');
  const [generationStatus, setGenerationStatus] = useState('当前使用 ER15-1400 基线场景。');
  const [generatedSummary, setGeneratedSummary] = useState('输入场景和任务描述后，可以一键生成包含机器人、输送线、托盘和箱体的完整 MuJoCo 环境。');
  const [generatedSceneXml, setGeneratedSceneXml] = useState<string | null>(null);
  const [trajectoryStatus, setTrajectoryStatus] = useState('等待执行统一轨迹规划。');
  const [trajectoryPlan, setTrajectoryPlan] = useState<TrajectoryPlan | null>(null);
  const [robotStatus, setRobotStatus] = useState<ViewerRuntimeStatus>(emptyRobotStatus);
  const [lastRobotStatus, setLastRobotStatus] = useState<ViewerRuntimeStatus>(emptyRobotStatus);
  const [servoTuning, setServoTuning] = useState<ServoTuningResult>({
    method: '继电反馈辨识 + IMC-PID 初值 + Nelder-Mead 局部精修',
    status: '等待执行关节伺服参数整定。',
    summary: '当前使用 ER15-1400 的基线关节位置伺服参数。建议先完成一轮自动整定，再进入任务执行阶段。',
    tuningTime: '未启动',
    dominantGoal: '基线均衡',
    joints: SERVO_BASELINE,
  });
  const [servoTuningSession, setServoTuningSession] = useState<ServoTuningSession>({
    active: false,
    round: 0,
    maxRounds: 3,
    evaluating: false,
    metrics: emptyTuningMetrics(),
    plan: null,
  });
  const [servoOptimizeJob, setServoOptimizeJob] = useState<ServoOptimizeJobState>({
    jobId: null,
    status: 'idle',
    done: 0,
    total: 0,
    rounds: OPTIMIZATION_DEFAULTS.rounds,
    trialsPerRound: OPTIMIZATION_DEFAULTS.trials_per_round,
    bestTrial: 0,
    bestMetrics: null,
    error: null,
  });
  const [servoControlMode, setServoControlMode] = useState<ServoControlMode>(
    BACKEND_CONTROL_DEFAULTS.ff_mode === 'no' && !BACKEND_CONTROL_DEFAULTS.computed_torque ? 'pid' : 'feedforward',
  );
  const requestedControlModeRef = React.useRef<ServoControlMode>(
    BACKEND_CONTROL_DEFAULTS.ff_mode === 'no' && !BACKEND_CONTROL_DEFAULTS.computed_torque ? 'pid' : 'feedforward',
  );
  const [backendJob, setBackendJob] = useState<BackendJobState>({
    jobId: null,
    kind: null,
    status: 'idle',
    phase: 'idle',
    message: '等待后端权威任务。',
    error: null,
  });
  const [viewerReplay, setViewerReplay] = useState<ViewerReplay | null>(null);
  const servoTuningMetricsRef = React.useRef<ServoTuningRoundMetrics>(emptyTuningMetrics());
  const robotStatusBufferRef = React.useRef<ViewerRuntimeStatus>(emptyRobotStatus);
  const robotStatusFlushTimerRef = React.useRef<number | null>(null);
  const stepMeta = STUDIO_STEPS.find((item) => item.id === step) ?? STUDIO_STEPS[0];
  const objectiveWeights = inferObjectiveWeights(objectivePrompt);
  const viewerPlan = servoTuningSession.active && servoTuningSession.plan ? servoTuningSession.plan : trajectoryPlan;
  const viewerInstanceKey = [
    generatedSceneXml ? 'generated' : 'default',
    viewerReplay?.duration ?? 0,
    viewerReplay?.frames?.length ?? 0,
    viewerReplay?.frames?.[0]?.time ?? -1,
  ].join(':');

  const handleViewerStatusUpdate = React.useCallback((status: ViewerRuntimeStatus) => {
    robotStatusBufferRef.current = status;
    if (robotStatusFlushTimerRef.current !== null) return;

    robotStatusFlushTimerRef.current = window.setTimeout(() => {
      robotStatusFlushTimerRef.current = null;
      React.startTransition(() => {
        setRobotStatus(robotStatusBufferRef.current);
        if (robotStatusBufferRef.current.joints.length > 0) {
          setLastRobotStatus(robotStatusBufferRef.current);
        }
      });
    }, 180);
  }, []);

  const displayedRobotStatus = robotStatus.joints.length > 0 ? robotStatus : lastRobotStatus;
  const jointConstraintState = buildJointConstraintState(displayedRobotStatus.joints, servoTuning.joints);
  const activeConstraintSummary = [
    jointConstraintState.some((joint) => joint.positionLimited)
      ? `位置限位触发 ${jointConstraintState.filter((joint) => joint.positionLimited).length}`
      : jointConstraintState.some((joint) => joint.nearPositionLimit)
        ? `位置限位接近 ${jointConstraintState.filter((joint) => joint.nearPositionLimit).length}`
        : null,
    jointConstraintState.some((joint) => joint.velocityLimited)
      ? `速度阈值触发 ${jointConstraintState.filter((joint) => joint.velocityLimited).length}`
      : jointConstraintState.some((joint) => joint.nearVelocityLimit)
        ? `速度阈值接近 ${jointConstraintState.filter((joint) => joint.nearVelocityLimit).length}`
        : null,
    jointConstraintState.some((joint) => joint.torqueLimited)
      ? `力矩限位触发 ${jointConstraintState.filter((joint) => joint.torqueLimited).length}`
      : jointConstraintState.some((joint) => joint.nearTorqueLimit)
        ? `力矩限位接近 ${jointConstraintState.filter((joint) => joint.nearTorqueLimit).length}`
        : null,
  ].filter(Boolean) as string[];

  const mergeControllerGains = React.useCallback((gains: Array<Partial<ServoJointConfig>>) => {
    return SERVO_BASELINE.map((baseline, index) => {
      const matched = gains.find((item) => item.name === baseline.name) ?? gains[index] ?? {};
      return clampServoConfig({
        ...baseline,
        ...matched,
        name: matched.name ?? baseline.name,
        kp: Number(matched.kp ?? baseline.kp),
        ki: Number(matched.ki ?? baseline.ki),
        kd: Number(matched.kd ?? baseline.kd),
        forcerange: (matched.forcerange as [number, number] | undefined) ?? baseline.forcerange,
        ctrlrange: (matched.ctrlrange as [number, number] | undefined) ?? baseline.ctrlrange,
      }, index);
    });
  }, []);

  const applyBackendResult = React.useCallback((kind: BackendJobKind, result: any) => {
    if (!result) return;
    const backendControlMode = result.control_mode as { ff_mode?: string; computed_torque?: boolean; ideal_actuation?: boolean } | undefined;
    const controlModeSummary = summarizeBackendControlMode(backendControlMode);
    const backendUiMode = backendControlModeToUi(backendControlMode);
    const requestedUiMode = requestedControlModeRef.current;
    const modeMismatch = requestedUiMode !== backendUiMode;
    const nextGains = Array.isArray(result.controller_gains) ? mergeControllerGains(result.controller_gains) : servoTuning.joints;
    setServoControlMode(backendUiMode);
    if (Array.isArray(result.controller_gains)) {
      setServoTuning({
        method: kind === 'tune_controller' ? 'mjwarp 后端权威整定' : servoTuning.method,
        status: `已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威结果已回写`,
        summary:
          typeof result.summary === 'string'
            ? `${result.summary} 当前统一控制模式：${controlModeSummary}。${modeMismatch ? ` 前后端模式不一致：前端请求 ${describeControlMode(requestedUiMode)}，后端实际执行 ${describeControlMode(backendUiMode)}。` : ''}`
            : `后端权威任务已完成，结果已回写到当前工作区。当前统一控制模式：${controlModeSummary}。${modeMismatch ? ` 前后端模式不一致：前端请求 ${describeControlMode(requestedUiMode)}，后端实际执行 ${describeControlMode(backendUiMode)}。` : ''}`,
        tuningTime: kind === 'tune_controller' ? `${servoOptimizeJob.total || 0} 次试验 / 后端权威复验` : servoTuning.tuningTime,
        dominantGoal: result.metrics?.stable ? '后端稳定复验通过' : '后端结果待复核',
        joints: nextGains,
      });
    }
    if (typeof result.scene_xml === 'string' && result.scene_xml) {
      setGeneratedSceneXml(result.scene_xml);
    }
    if (result.trajectory) {
      setTrajectoryPlan(result.trajectory as TrajectoryPlan);
    }
    if (result.replay) {
      setViewerReplay(result.replay as ViewerReplay);
      setRobotStatus(emptyRobotStatus);
      setLastRobotStatus(emptyRobotStatus);
      robotStatusBufferRef.current = emptyRobotStatus;
    } else if (kind === 'tune_controller') {
      setViewerReplay(null);
      setRobotStatus(emptyRobotStatus);
      setLastRobotStatus(emptyRobotStatus);
      robotStatusBufferRef.current = emptyRobotStatus;
    }
    if (kind === 'tune_controller') {
      const metrics = result.metrics as ServoOptimizeMetrics | undefined;
      setServoOptimizeJob((current) => ({
        ...current,
        status: 'completed',
        bestTrial: current.bestTrial || 1,
        bestMetrics: metrics
          ? {
              peakError: Number(metrics.peakError ?? 0),
              meanError: Number(metrics.meanError ?? 0),
              peakVelocity: Number(metrics.peakVelocity ?? 0),
              peakTorque: Number(metrics.peakTorque ?? 0),
              settleTime: Number(metrics.settleTime ?? 0),
              oscillationPenalty: Number(metrics.oscillationPenalty ?? 0),
              stabilityIndex: Number(metrics.stabilityIndex ?? 0),
              holdMeanError: Number(metrics.holdMeanError ?? 0),
              holdPeakError: Number(metrics.holdPeakError ?? 0),
              holdMeanVelocity: Number(metrics.holdMeanVelocity ?? 0),
              holdPeakVelocity: Number(metrics.holdPeakVelocity ?? 0),
              holdMeanTorque: Number(metrics.holdMeanTorque ?? 0),
              holdPeakTorque: Number(metrics.holdPeakTorque ?? 0),
              stable: Boolean(metrics.stable),
            }
          : current.bestMetrics,
      }));
      setTrajectoryStatus(
        result.replay
          ? `已复验 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威整定结果已自动回放`
          : `已复验 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威整定摘要结果已就绪`,
      );
      setGenerationStatus(`已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / mjwarp 后端控制器整定已完成`);
      setGeneratedSummary(
        result.replay
          ? '控制器整定、正式复验和回放都已由后端权威任务完成，前端当前仅展示回写结果与回放。'
          : '控制器整定与正式复验已由后端权威任务完成，当前优先输出摘要指标与参数回写，不再额外生成复杂回放。',
      );
      void appendDebugLog({
        level: 'INFO',
        code: 'BACKEND_TUNE_DONE',
        joint: 'controller',
        observed: Number(result.metrics?.peakError ?? 0),
        limit: SERVO_ACCEPTANCE.peak_error,
        message: `后端权威控制器整定完成。peakError=${Number(result.metrics?.peakError ?? 0).toFixed(4)} holdPeakError=${Number(result.metrics?.holdPeakError ?? 0).toFixed(4)} engine=${String(result.engine ?? 'unknown')}`,
      });
      if (controlModeSummary) {
        void appendDebugLog({
          level: 'INFO',
          code: 'BACKEND_CONTROL_MODE',
          joint: 'controller',
          observed: Number(result.metrics?.peakError ?? 0),
          limit: Number(result.metrics?.holdPeakError ?? 0),
          message: `后端统一控制模式：${controlModeSummary}`,
        });
      }
      if (result.replay) {
        void appendDebugLog({
          level: 'INFO',
          code: 'BACKEND_REPLAY_READY',
          joint: 'controller',
          observed: Number(result.replay?.duration ?? 0),
          limit: Number(result.replay?.frames?.length ?? 0),
          message: `后端权威回放已就绪。duration=${Number(result.replay?.duration ?? 0).toFixed(2)} frames=${Number(result.replay?.frames?.length ?? 0)} engine=${String(result.engine ?? 'unknown')}`,
        });
      }
    } else if (kind === 'full_task') {
      setTrajectoryStatus(`已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威任务回放已就绪`);
      setGenerationStatus(`已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / mjwarp 后端全流程任务已完成`);
      setGeneratedSummary('全流程任务的规划、控制、仿真、稳定性评估和回放已统一转入后端权威链路。');
      void appendDebugLog({
        level: 'INFO',
        code: 'BACKEND_TASK_DONE',
        joint: 'controller',
        observed: Number(result.metrics?.peakError ?? 0),
        limit: Number(result.metrics?.holdPeakError ?? 0),
        message: `后端权威全流程任务完成。peakError=${Number(result.metrics?.peakError ?? 0).toFixed(4)} holdPeakError=${Number(result.metrics?.holdPeakError ?? 0).toFixed(4)} engine=${String(result.engine ?? 'unknown')}`,
      });
      if (controlModeSummary) {
        void appendDebugLog({
          level: 'INFO',
          code: 'BACKEND_CONTROL_MODE',
          joint: 'controller',
          observed: Number(result.metrics?.peakError ?? 0),
          limit: Number(result.metrics?.holdPeakError ?? 0),
          message: `后端统一控制模式：${controlModeSummary}`,
        });
      }
      void appendDebugLog({
        level: 'INFO',
        code: 'BACKEND_REPLAY_READY',
        joint: 'controller',
        observed: Number(result.replay?.duration ?? 0),
        limit: Number(result.replay?.frames?.length ?? 0),
        message: `后端权威回放已就绪。duration=${Number(result.replay?.duration ?? 0).toFixed(2)} frames=${Number(result.replay?.frames?.length ?? 0)} engine=${String(result.engine ?? 'unknown')}`,
      });
    }
  }, [mergeControllerGains, robotStatusBufferRef, servoOptimizeJob.total, servoTuning]);

  const handleGenerateScene = () => {
    const spec = buildSceneSpec(scenePrompt, taskPrompt);
    const xml = buildGeneratedSceneXml(spec, servoTuning.joints);
    setGeneratedSceneXml(xml);
    setViewerReplay(null);
    setGenerationStatus(`已生成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 场景可用于预览`);
    setGeneratedSummary(`${spec.summary}。已根据“${scenePrompt} / ${taskPrompt}”生成完整 MJCF 环境，并注入到中间 MuJoCo 工作区；当前关节伺服参数来自 03 控制器。`);
    setRobotStatus(emptyRobotStatus);
    robotStatusBufferRef.current = emptyRobotStatus;
  };

  const handlePlanTrajectory = () => {
    const backendControl = controlModeToBackend(servoControlMode);
    requestedControlModeRef.current = servoControlMode;
    const spec = buildSceneSpec(scenePrompt, taskPrompt);
    const xml = buildGeneratedSceneXml(spec, servoTuning.joints);
    setGeneratedSceneXml(xml);
    setViewerReplay(null);
    setGenerationStatus(`已提交 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端全流程任务运行中`);
    setGeneratedSummary(`${spec.summary}。当前已将场景、目标和控制器配置提交到后端权威任务链路，前端将等待后端返回正式回放结果。`);
    const plan = buildTrajectoryPlan(scenePrompt, taskPrompt, objectivePrompt);
    setServoTuningSession((current) => ({ ...current, active: false, evaluating: false, plan: null }));
    setTrajectoryPlan(plan);
    setTrajectoryStatus(`已启动 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威全流程任务执行中`);
    void fetch('/api/jobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        task_type: 'full_task',
        scene_prompt: scenePrompt,
        task_prompt: taskPrompt,
        objective_prompt: objectivePrompt,
        scene_xml: xml,
        objective_weights: objectiveWeights,
        controller_gains: servoTuning.joints,
        ff_mode: backendControl.ff_mode,
        computed_torque: backendControl.computed_torque,
        ideal_actuation: backendControl.ideal_actuation,
        trajectory_hint: plan,
        seed: Date.now(),
      }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload?.ok || !payload?.job_id) throw new Error(payload?.error ?? '无法启动后端任务');
        setBackendJob({
          jobId: payload.job_id,
          kind: 'full_task',
          status: 'running',
          phase: 'queued',
          message: '后端全流程任务已启动。',
          error: null,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setBackendJob({jobId: null, kind: 'full_task', status: 'error', phase: 'error', message, error: message});
        setTrajectoryStatus(`失败 / ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
      });
  };

  const handleAutoTuneServo = () => {
    const backendControl = controlModeToBackend(servoControlMode);
    requestedControlModeRef.current = servoControlMode;
    const rounds = servoOptimizeJob.rounds;
    const trialsPerRound = servoOptimizeJob.trialsPerRound;
    const baseResult = buildServoTuningResult(objectiveWeights, robotStatus);
    setServoTuning({
      ...baseResult,
      status: `已启动 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${describeControlMode(servoControlMode)} 后端整定运行中`,
      summary: `当前正在后端权威链路执行${describeControlMode(servoControlMode)}的控制器整定和正式复验。前端只显示任务状态，并在任务结束后播放权威回放。`,
      tuningTime: `${rounds} 轮搜索 / ${rounds * trialsPerRound} 次试验`,
      dominantGoal: describeControlMode(servoControlMode),
    });
    setServoTuningSession((current) => ({...current, active: false, evaluating: false, plan: null}));
    servoTuningMetricsRef.current = emptyTuningMetrics();
    setTrajectoryPlan(null);
    setViewerReplay(null);
    setGeneratedSceneXml(null);
    setRobotStatus(emptyRobotStatus);
    setLastRobotStatus(emptyRobotStatus);
    robotStatusBufferRef.current = emptyRobotStatus;
    setStep('controller');
    void fetch('/api/jobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        task_type: 'tune_controller',
        jobs: OPTIMIZATION_DEFAULTS.jobs,
        rounds,
        trials_per_round: trialsPerRound,
        objective_weights: objectiveWeights,
        controller_gains: servoTuning.joints,
        ff_mode: backendControl.ff_mode,
        computed_torque: backendControl.computed_torque,
        ideal_actuation: backendControl.ideal_actuation,
        scene_prompt: scenePrompt,
        task_prompt: taskPrompt,
        objective_prompt: objectivePrompt,
        scene_xml: '',
        seed: Date.now(),
      }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!payload?.ok || !payload?.job_id) {
          throw new Error(payload?.error ?? '无法启动后台优化任务');
        }
        setServoOptimizeJob((current) => ({
          ...current,
          jobId: payload.job_id,
          status: 'running',
          done: 0,
          total: rounds * trialsPerRound,
          bestTrial: 0,
          bestMetrics: null,
          error: null,
        }));
        setBackendJob({
          jobId: payload.job_id,
          kind: 'tune_controller',
          status: 'running',
          phase: 'queued',
          message: '后端权威控制器整定已启动。',
          error: null,
        });
        setGenerationStatus(`已启动 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 后端权威控制器整定运行中`);
        setGeneratedSummary(`03 控制器已切换到后端权威整定模式。当前将由 Python 后端统一执行控制器搜索、正式复验、稳定性诊断和回放生成。`);
        void appendDebugLog({
          level: 'INFO',
          code: 'BACKEND_TUNE_START',
          joint: 'controller',
          observed: rounds * trialsPerRound,
          limit: 8,
          message: `已启动后端权威控制器整定。rounds=${rounds} envCount=${trialsPerRound} updateSteps=${OPTIMIZATION_DEFAULTS.jobs}`,
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setServoOptimizeJob((current) => ({...current, status: 'error', error: message}));
        setBackendJob({jobId: null, kind: 'tune_controller', status: 'error', phase: 'error', message, error: message});
        setServoTuning((current) => ({
          ...current,
          status: `启动失败 / ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
          summary: `后端权威整定启动失败：${message}`,
          dominantGoal: '需要排查后端任务',
        }));
      });
  };

  React.useEffect(() => {
    return () => {
      if (robotStatusFlushTimerRef.current !== null) {
        window.clearTimeout(robotStatusFlushTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (backendJob.status !== 'running' || !backendJob.jobId || !backendJob.kind) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(backendJob.jobId!)}/status`);
        const payload = await response.json();
        if (cancelled || !payload?.ok) return;

        const nextStatus = payload.status ?? backendJob.status;
        const nextPhase = payload.phase ?? backendJob.phase;
        const nextMessage = payload.message ?? backendJob.message;
        const nextError = payload.error ?? null;

        if (backendJob.kind === 'tune_controller') {
          const bestMetrics = payload.best?.metrics
            ? {
                peakError: Number(payload.best.metrics.peakError ?? 0),
                meanError: Number(payload.best.metrics.meanError ?? 0),
                peakVelocity: Number(payload.best.metrics.peakVelocity ?? 0),
                peakTorque: Number(payload.best.metrics.peakTorque ?? 0),
                settleTime: Number(payload.best.metrics.settleTime ?? 0),
                oscillationPenalty: Number(payload.best.metrics.oscillationPenalty ?? 0),
                stabilityIndex: Number(payload.best.metrics.stabilityIndex ?? 0),
                holdMeanError: Number(payload.best.metrics.holdMeanError ?? 0),
                holdPeakError: Number(payload.best.metrics.holdPeakError ?? 0),
                holdMeanVelocity: Number(payload.best.metrics.holdMeanVelocity ?? 0),
                holdPeakVelocity: Number(payload.best.metrics.holdPeakVelocity ?? 0),
                holdMeanTorque: Number(payload.best.metrics.holdMeanTorque ?? 0),
                holdPeakTorque: Number(payload.best.metrics.holdPeakTorque ?? 0),
                stable: Boolean(payload.best.metrics.stable),
              }
            : null;
          setServoOptimizeJob((current) => ({
            ...current,
            status: nextStatus,
            done: Number(payload.done ?? current.done),
            total: Number(payload.total ?? current.total),
            bestTrial: Number(payload.best?.trial ?? current.bestTrial),
            bestMetrics,
            error: nextError,
          }));
        }

        if (nextStatus === 'completed') {
          const resultResponse = await fetch(`/api/jobs/${encodeURIComponent(backendJob.jobId!)}/result`);
          const resultPayload = await resultResponse.json();
          if (cancelled || !resultPayload?.ok) return;
          setBackendJob((current) => ({
            ...current,
            status: 'completed',
            phase: 'completed',
            message: '后端权威任务已完成，结果与回放已回写。',
            error: null,
          }));
          applyBackendResult(backendJob.kind, resultPayload.result);
          return;
        }

        setBackendJob((current) => ({
          ...current,
          status: nextStatus,
          phase: nextPhase,
          message: nextMessage,
          error: nextError,
        }));

        if (nextStatus === 'error') {
          const message = nextError ?? '后端任务失败';
          if (backendJob.kind === 'tune_controller') {
            setServoTuning((current) => ({
              ...current,
              status: `失败 / ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
              summary: `后端控制器整定失败：${message}`,
              dominantGoal: '需要排查后端任务',
            }));
            setServoOptimizeJob((current) => ({...current, status: 'error', error: message}));
          } else {
            setTrajectoryStatus(`失败 / ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
          }
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setBackendJob((current) => ({...current, status: 'error', phase: 'error', error: message, message}));
        if (backendJob.kind === 'tune_controller') {
          setServoOptimizeJob((current) => ({...current, status: 'error', error: message}));
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backendJob.status, backendJob.jobId, backendJob.kind, applyBackendResult]);

  React.useEffect(() => {
    if (!servoTuningSession.active) return;
    if (robotStatus.joints.length === 0) return;

    const current = servoTuningMetricsRef.current;
    const peakError = robotStatus.joints.reduce((maxValue, joint) => Math.max(maxValue, Math.abs(joint.error)), current.peakError);
    const peakVelocity = robotStatus.joints.reduce((maxValue, joint) => Math.max(maxValue, Math.abs(joint.velocity)), current.peakVelocity);
    const peakTorque = robotStatus.joints.reduce((maxValue, joint) => Math.max(maxValue, Math.abs(joint.torque)), current.peakTorque);
    const avgErrorNow = robotStatus.joints.reduce((sum, joint) => sum + Math.abs(joint.error), 0) / Math.max(robotStatus.joints.length, 1);
    const sampleCount = current.sampleCount + 1;
    const averageError = ((current.averageError * current.sampleCount) + avgErrorNow) / sampleCount;

    servoTuningMetricsRef.current = {
      peakError,
      averageError,
      peakVelocity,
      peakTorque,
      sampleCount,
      motionDetected: current.motionDetected || peakVelocity > 0.03,
      collisions: Math.max(current.collisions, robotStatus.collisionActiveCount),
    };
  }, [robotStatus, servoTuningSession.active]);

  React.useEffect(() => {
    if (!servoTuningSession.active || servoTuningSession.evaluating) return;
    if (robotStatus.phase !== 'tune-complete') return;
    const metrics = servoTuningMetricsRef.current;
    if (metrics.sampleCount < 6) return;
    const stable =
      metrics.motionDetected &&
      metrics.peakError <= SERVO_ACCEPTANCE.peak_error &&
      metrics.averageError <= SERVO_ACCEPTANCE.average_error &&
      metrics.peakVelocity <= SERVO_ACCEPTANCE.peak_velocity &&
      metrics.collisions === 0;

    setServoTuningSession((current) => ({ ...current, evaluating: true }));

    if (stable) {
      setServoTuning((current) => ({
        ...current,
        status: `已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 第 ${servoTuningSession.round} 轮通过`,
        summary: `自动整定完成。机器人已能稳定跟踪辨识轨迹，峰值误差 ${metrics.peakError.toFixed(4)} rad，平均误差 ${metrics.averageError.toFixed(4)} rad，峰值速度 ${metrics.peakVelocity.toFixed(3)} rad/s。`,
        tuningTime: `${servoTuningSession.round} 轮辨识 / ${metrics.sampleCount} 个采样窗口`,
        dominantGoal: '稳定跟踪已建立',
      }));
      setGenerationStatus(`已整定 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 关节伺服稳定跟踪已建立`);
      setGeneratedSummary(`03 控制器已完成自动整定。当前辨识结果显示机器人能够稳定跟踪运动指令，可继续进入任务轨迹验证。`);
      setServoTuningSession((current) => ({ ...current, active: false, evaluating: false, plan: null }));
      void appendDebugLog({
        level: 'INFO',
        code: 'SERVO_TUNING_STABLE',
        joint: 'controller',
        observed: metrics.peakError,
        limit: SERVO_ACCEPTANCE.peak_error,
        message: `第 ${servoTuningSession.round} 轮整定通过，已建立稳定跟踪。avgErr=${metrics.averageError.toFixed(4)} peakVel=${metrics.peakVelocity.toFixed(4)}`,
      });
      return;
    }

    if (servoTuningSession.round >= servoTuningSession.maxRounds) {
      setServoTuning((current) => ({
        ...current,
        status: `已完成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 达到最大整定轮次`,
        summary: `自动整定已执行到第 ${servoTuningSession.round} 轮，但稳定性仍未完全满足目标。当前峰值误差 ${metrics.peakError.toFixed(4)} rad，平均误差 ${metrics.averageError.toFixed(4)} rad。`,
        tuningTime: `${servoTuningSession.round} 轮辨识 / ${metrics.sampleCount} 个采样窗口`,
        dominantGoal: metrics.motionDetected ? '仍需进一步收敛' : '驱动链仍需排查',
      }));
      setServoTuningSession((current) => ({ ...current, active: false, evaluating: false, plan: null }));
      void appendDebugLog({
        level: 'ERROR',
        code: 'SERVO_TUNING_MAX_ROUNDS',
        joint: 'controller',
        observed: metrics.peakError,
        limit: SERVO_ACCEPTANCE.peak_error,
        message: `达到最大整定轮次仍未稳定。avgErr=${metrics.averageError.toFixed(4)} moved=${metrics.motionDetected}`,
      });
      return;
    }

    const nextRound = servoTuningSession.round + 1;
    const nextResult = refineServoFromMetrics(servoTuning, metrics, servoTuningSession.round);
    const nextPlan = buildServoTuningPlan(nextRound);
    const spec = buildSceneSpec(scenePrompt, taskPrompt);

    setServoTuning(nextResult);
    setGeneratedSceneXml(buildGeneratedSceneXml(spec, nextResult.joints));
    setGenerationStatus(`已转入 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 第 ${nextRound} 轮关节伺服复测`);
    setGeneratedSummary(`${spec.summary}。第 ${servoTuningSession.round} 轮未满足稳定判据，系统已根据日志自动修正参数并启动第 ${nextRound} 轮复测。`);
    setServoTuningSession({
      active: true,
      round: nextRound,
      maxRounds: servoTuningSession.maxRounds,
      evaluating: false,
      metrics: emptyTuningMetrics(),
      plan: nextPlan,
    });
    servoTuningMetricsRef.current = emptyTuningMetrics();
    void appendDebugLog({
      level: 'WARN',
      code: 'SERVO_TUNING_RETRY',
      joint: 'controller',
      observed: metrics.peakError,
      limit: SERVO_ACCEPTANCE.peak_error,
      message: `第 ${servoTuningSession.round} 轮未通过，已自动进入第 ${nextRound} 轮整定。avgErr=${metrics.averageError.toFixed(4)} peakVel=${metrics.peakVelocity.toFixed(4)} moved=${metrics.motionDetected}`,
    });
  }, [robotStatus.phase, servoTuningSession.active, servoTuningSession.evaluating, servoTuningSession.round, servoTuningSession.maxRounds, servoTuning, scenePrompt, taskPrompt]);

  return (
    <EditorChrome
      title="算法正向设计工作台"
      description="固定工作区、固定状态栏、固定底部面板。编辑区只展示当前步骤。"
      actions={
        <>
          <StatusPill label={stepMeta.label} />
          <StatusPill label="MJCF 就绪" tone="text-emerald-400" />
        </>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_280px] xl:grid-rows-[auto_minmax(0,1fr)]">
        <div className="col-span-full border-b border-[var(--card-border)] bg-[#121a2a] px-4 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">流程标签</div>
          <div className="flex items-end gap-2 overflow-x-auto">
          {STUDIO_STEPS.map((item) => (
            <StepButton key={item.id} active={step === item.id} label={item.label} onClick={() => setStep(item.id)} />
          ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto border-r border-[var(--card-border)] px-4 py-4">
          <SectionTitle icon={FolderTree} label="操作面板" tone="text-blue-400" />
          <div className="mb-4 text-sm font-semibold text-main">{stepMeta.title}</div>
          <div className="mb-6 text-sm leading-relaxed text-muted">{stepMeta.hint}</div>
          {step === 'scene' ? (
            <StudioSceneGeneratorPanel
              scenePrompt={scenePrompt}
              taskPrompt={taskPrompt}
              generationStatus={generationStatus}
              generatedSummary={generatedSummary}
              onScenePromptChange={setScenePrompt}
              onTaskPromptChange={setTaskPrompt}
              onGenerateScene={handleGenerateScene}
            />
          ) : (
          <StudioOperationPanel
              step={step}
              objectivePrompt={objectivePrompt}
              objectiveWeights={objectiveWeights}
              onObjectivePromptChange={setObjectivePrompt}
              trajectoryPlan={trajectoryPlan}
              trajectoryStatus={trajectoryStatus}
              onPlanTrajectory={handlePlanTrajectory}
              servoTuning={servoTuning}
              servoOptimizeJob={servoOptimizeJob}
              controlMode={servoControlMode}
              onControlModeChange={setServoControlMode}
              onAutoTuneServo={handleAutoTuneServo}
            />
          )}
        </div>

        <div className="relative min-h-0 overflow-hidden border-r border-[var(--card-border)]">
          <MujocoViewer
            key={viewerInstanceKey}
            sceneFile={generatedSceneXml ? 'generated-scene.mjcf.xml' : undefined}
            sceneXmlOverride={generatedSceneXml}
            trajectoryPlan={viewerPlan}
            servoConfig={servoTuning.joints}
            replay={viewerReplay}
            onStatusUpdate={handleViewerStatusUpdate}
          />
          <div className="pointer-events-none absolute left-5 top-5">
            <div className="bg-[var(--nav-bg)]/90 px-4 py-3 backdrop-blur-md">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted">工作区</div>
              <div className="mt-2 text-sm font-semibold text-main">ER15-1400 后端回放视图</div>
              <div className="mt-1 max-w-[240px] text-sm leading-relaxed text-muted">前端当前只负责回放后端权威任务结果，正式物理、控制与优化均由后端执行。</div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-t border-[var(--card-border)] xl:border-t-0">
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Bot} label="机器人状态" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="阶段" value={displayedRobotStatus.phase} tone="text-blue-400" />
              <DataRow label="碰撞数" value={`${displayedRobotStatus.collisionActiveCount}`} tone={displayedRobotStatus.collisionActiveCount > 0 ? 'text-rose-300' : 'text-emerald-400'} />
              <DataRow label="最近碰撞" value={displayedRobotStatus.lastCollisionPair} tone="text-amber-300" />
              <DataRow label="控制" value={trajectoryPlan?.controller ?? '关节位置伺服'} tone="text-blue-400" />
              <DataRow label="整定" value={servoTuning.dominantGoal} tone="text-violet-300" />
              <DataRow label="末端" value={trajectoryPlan?.gripperMode ?? '吸盘待机'} tone="text-cyan-300" />
              <DataRow
                label="约束状态"
                value={activeConstraintSummary.length > 0 ? activeConstraintSummary.join(' / ') : '未触发'}
                tone={activeConstraintSummary.length > 0 ? 'text-rose-300' : 'text-emerald-400'}
              />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Gauge} label="关节监控" tone="text-blue-400" />
            <div className="space-y-3">
              {displayedRobotStatus.joints.length > 0 ? displayedRobotStatus.joints.map((joint) => {
                const constraint = jointConstraintState.find((item) => item.name === joint.name);
                return (
                  <div key={joint.name} className="bg-white/[0.03] px-3 py-3 text-sm">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-semibold text-main">{joint.name}</span>
                      <span className={Math.abs(joint.error) > SERVO_ACCEPTANCE.tracking_error_warn ? 'font-mono text-xs text-rose-300' : 'font-mono text-xs text-emerald-300'}>
                        err {joint.error >= 0 ? '+' : ''}{joint.error.toFixed(4)}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      <DataRow label="位置 q" value={`${joint.position >= 0 ? '+' : ''}${joint.position.toFixed(3)} rad`} tone="text-main" />
                      <DataRow label="速度 dq" value={`${joint.velocity >= 0 ? '+' : ''}${joint.velocity.toFixed(3)} rad/s`} tone="text-cyan-300" />
                      <DataRow label="力矩 tau" value={`${joint.torque >= 0 ? '+' : ''}${joint.torque.toFixed(2)} Nm`} tone="text-amber-300" />
                      <DataRow label="跟踪误差" value={`${joint.error >= 0 ? '+' : ''}${joint.error.toFixed(4)} rad`} tone={Math.abs(joint.error) > SERVO_ACCEPTANCE.tracking_error_warn ? 'text-rose-300' : 'text-emerald-300'} />
                      <DataRow
                        label="位置限制"
                        value={constraint ? `${constraint.positionRange[0].toFixed(3)} .. ${constraint.positionRange[1].toFixed(3)} rad` : '-'}
                        tone={constraint?.positionLimited ? 'text-rose-300' : constraint?.nearPositionLimit ? 'text-amber-300' : 'text-muted'}
                      />
                      <DataRow
                        label="速度阈值"
                        value={constraint ? `±${constraint.velocityLimit.toFixed(2)} rad/s` : '-'}
                        tone={constraint?.velocityLimited ? 'text-rose-300' : constraint?.nearVelocityLimit ? 'text-amber-300' : 'text-muted'}
                      />
                      <DataRow
                        label="力矩限制"
                        value={constraint ? `${constraint.torqueRange[0].toFixed(0)} .. ${constraint.torqueRange[1].toFixed(0)} Nm` : '-'}
                        tone={constraint?.torqueLimited ? 'text-rose-300' : constraint?.nearTorqueLimit ? 'text-amber-300' : 'text-muted'}
                      />
                    </div>
                  </div>
                );
              }) : (
                <div className="bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-muted">
                  后端回放启动后，这里会常驻显示机器人关节位置、速度、力矩和跟踪误差。
                </div>
              )}
            </div>
          </div>

          <div className="px-4 py-4">
            <SectionTitle icon={Activity} label="运行概览" tone="text-amber-400" />
            <div className="space-y-3 text-sm text-muted">
              {trajectoryPlan ? (
                <>
                  <p>{trajectoryPlan.profile}</p>
                  <p>{trajectoryPlan.planner}</p>
                  <p>{trajectoryPlan.parameterization}</p>
                  <p>伺服整定: {servoTuning.method}</p>
                  <p>目标权重: 精度 {objectiveWeights.precision}% / 稳定性 {objectiveWeights.stability}% / 节拍 {objectiveWeights.cycle}% / 能耗 {objectiveWeights.energy}%</p>
                </>
              ) : (
                <>
                  <p>右侧面板现在固定用于机器人状态常驻显示。</p>
                  <p>03 控制器现在会把整定、复验与日志统一交给后端权威链路，再把结果回放到这里。</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </EditorChrome>
  );
}

function TwinWorkbench() {
  return (
    <EditorChrome
      title="数字孪生运行台"
      description="主区看模型，右侧看状态，底部面板看日志。"
      actions={
        <>
          <StatusPill label="运行中" tone="text-emerald-400" />
          <button className="flex items-center gap-2 bg-emerald-500 px-3 py-2 text-sm font-semibold text-white">
            <Play size={14} /> 开始仿真
          </button>
        </>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 overflow-hidden border-r border-[var(--card-border)]">
          <MujocoViewer />
        </div>
        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Activity} label="孪生状态" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="同步状态" value="已连接" tone="text-emerald-400" />
              <DataRow label="延迟" value="1.2 ms" tone="text-blue-400" />
              <DataRow label="模型漂移" value="0.02%" tone="text-amber-400" />
            </div>
          </div>
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={BoxIcon} label="模型库" tone="text-blue-400" />
            <div className="space-y-2">
              <DataRow label="模型" value="ER15-1400" />
              <DataRow label="类型" value="MJCF" tone="text-blue-400" />
              <DataRow label="自由度" value="6 轴" />
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <SectionTitle icon={Server} label="仿真日志" tone="text-muted" />
            <div className="space-y-3 font-mono text-[12px] text-muted">
              {RECENT_LOGS.map((log) => (
                <div key={log}>{log}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </EditorChrome>
  );
}

function PlaceholderWorkbench(props: { module: ModuleMeta }) {
  const Icon = props.module.icon;

  return (
    <EditorChrome
      title={props.module.title}
      description={props.module.description}
      actions={<StatusPill label={`${props.module.label} 工作区`} tone={props.module.color} />}
    >
      <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 border-r border-[var(--card-border)] p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center bg-white/5">
              <Icon size={24} className={props.module.color} />
            </div>
            <div>
              <div className="text-xl font-semibold text-main">{props.module.title}</div>
              <div className="text-sm text-muted">{props.module.description}</div>
            </div>
          </div>
          <div className="max-w-[560px] text-sm leading-relaxed text-muted">
            杩欎釜妯″潡鍏堟帴鍏ョ粺涓€宸ヤ綔鍙伴鏋躲€傚悗缁€傚悎缁х画鎸夆€滀富鐢诲竷銆佸彸渚х姸鎬併€佸簳閮ㄥ伐鍏烽潰鏉库€濈殑鍚屼竴瑙勫垯鎵╁睍锛岃€屼笉鏄洖鍒板叏灞忓爢鍙犲紡椤甸潰銆?          </div>
        </div>
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Gauge} label="Status" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="Scope" value={props.module.label} tone={props.module.color} />
              <DataRow label="Telemetry" value="Nominal" tone="text-emerald-400" />
            </div>
          </div>
          <div className="px-4 py-4 text-sm text-muted">
            褰撳墠淇濇寔鍗犱綅锛屼笉鍐嶅埗閫犻澶栧崱鐗囧拰澶氬眰宓屽锛岀瓑浣犵‘璁よ繖涓鏋舵弧鎰忓悗鍐嶈ˉ鍏蜂綋鑳藉姏銆?          </div>
        </div>
      </div>
    </EditorChrome>
  );
}

function renderWorkbench(module: ModuleId) {
  if (module === 'studio') return <StudioWorkbench />;
  if (module === 'twin') return <TwinWorkbench />;
  return <PlaceholderWorkbench module={getModuleMeta(module)} />;
}

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('studio');
  const [activePanel, setActivePanel] = useState<PanelId>('guide');
  const [navCollapsed, setNavCollapsed] = useState(false);
  const activeMeta = getModuleMeta(activeModule);
  const navWidth = useMemo(() => (navCollapsed ? 72 : 248), [navCollapsed]);

  return (
    <div className="h-screen overflow-hidden bg-[var(--bg-main)] text-[var(--text-main)]">
      <div
        className="grid h-full"
        style={{
          gridTemplateColumns: `${navWidth}px minmax(0,1fr)`,
          gridTemplateRows: 'minmax(0,1fr) 180px 24px',
        }}
      >
        <aside className="row-span-2 flex min-h-0 flex-col border-r border-[var(--card-border)] bg-[#151c2b]">
          <div className={`flex h-14 items-center border-b border-[var(--card-border)] px-3 ${navCollapsed ? 'justify-center' : 'justify-between'}`}>
            <Logo size="sm" showText={false} />
            {!navCollapsed && (
              <button
                onClick={() => setNavCollapsed(true)}
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted transition-colors hover:bg-white/5 hover:text-main"
                title="Collapse Navigation"
              >
                <ChevronLeft size={18} />
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            <div className={`mb-3 ${navCollapsed ? 'flex justify-center' : 'px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted'}`}>
              {navCollapsed ? (
                <button
                  onClick={() => setNavCollapsed(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-sm text-muted hover:bg-white/5 hover:text-main"
                  title="Expand Navigation"
                >
                  <ChevronDown size={18} className="-rotate-90" />
                </button>
              ) : (
                <span>Modules</span>
              )}
            </div>

            {MODULES.map((module) => (
              <button
                key={module.id}
                onClick={() => setActiveModule(module.id)}
                className={`mb-2 flex w-full items-center rounded-sm transition-colors ${
                  navCollapsed
                    ? activeModule === module.id
                      ? 'justify-center bg-white/8 py-3 text-white'
                      : 'justify-center py-3 text-muted hover:bg-white/5 hover:text-main'
                    : activeModule === module.id
                      ? 'gap-3 bg-white/8 px-4 py-3 text-white'
                      : 'gap-3 px-4 py-3 text-muted hover:bg-white/5 hover:text-main'
                }`}
                title={module.label}
              >
                <module.icon size={22} className={activeModule === module.id ? module.color : ''} />
                {!navCollapsed && (
                  <div className="min-w-0 text-left">
                    <div className="text-sm font-semibold">{module.label}</div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!navCollapsed && (
            <div className="border-t border-[var(--card-border)]">
              <SideBarSection title="项目" footer={<span className={activeMeta.color}>{activeMeta.label}</span>}>
                <div className="space-y-2 text-sm">
                  <DataRow label="项目编号" value="LE-2026-0321" />
                  <DataRow label="目标设备" value="LOONG_BOX_V2" />
                  <DataRow label="仿真引擎" value="MuJoCo" tone="text-blue-400" />
                </div>
              </SideBarSection>
            </div>
          )}

          <div className="border-t border-[var(--card-border)] py-2">
            <button
              className={`flex h-11 w-full items-center text-muted hover:bg-white/5 hover:text-main ${navCollapsed ? 'justify-center' : 'gap-3 px-4'}`}
              title="设置"
            >
              <Settings size={20} />
              {!navCollapsed && <span className="text-sm">设置</span>}
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="min-h-0 flex-1"
            >
              {renderWorkbench(activeModule)}
            </motion.div>
          </AnimatePresence>
        </section>

        <section className="col-start-2 min-h-0 border-t border-[var(--card-border)] bg-[#161d2e]">
          <div className="flex h-9 items-center gap-1 border-b border-[var(--card-border)] px-2">
            {[
              { id: 'guide' as PanelId, icon: Bot, label: '指引' },
              { id: 'output' as PanelId, icon: Server, label: '输出' },
              { id: 'terminal' as PanelId, icon: Terminal, label: '终端' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm ${
                  activePanel === item.id ? 'bg-white/5 text-main' : 'text-muted hover:bg-white/5 hover:text-main'
                }`}
              >
                <item.icon size={14} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="h-[calc(100%-36px)] overflow-y-auto px-4 py-3 font-mono text-[12px] text-muted">
            {activePanel === 'guide' && (
              <div className="space-y-2">
                <div>[guide] 左侧导航固定，模块切换位置固定。</div>
                <div>[guide] 右侧只保留状态与说明，不再重复展示参数。</div>
                <div>[guide] 当前步骤的详细输入统一进入操作面板。</div>
              </div>
            )}
            {activePanel === 'output' && (
              <div className="space-y-2">
                {RECENT_LOGS.map((log) => (
                  <div key={log}>{log}</div>
                ))}
              </div>
            )}
            {activePanel === 'terminal' && (
              <div className="space-y-2">
                <div>PS D:\AI\loongenv&gt; npm run build</div>
                <div>vite build 执行完成</div>
                <div>工作区终端已激活</div>
              </div>
            )}
          </div>
        </section>

        <footer className="col-span-2 flex items-center justify-between border-t border-[#0b1220] bg-[#007acc] px-3 text-[12px] text-white">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <GitBranch size={12} />
              <span>codex/vscode-shell</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={12} />
              <span>工作区就绪</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Brain size={12} />
              <span>{activeMeta.label} 已激活</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span>UTF-8</span>
            <span>TypeScript React</span>
            <span>MuJoCo 已连接</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

