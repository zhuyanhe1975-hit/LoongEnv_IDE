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
  ListTree,
  Play,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { MujocoViewer } from './components/MujocoViewer';
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
  { label: 'Vibration', value: 25 },
  { label: 'Cycle Time', value: 20 },
  { label: 'Energy', value: 15 },
];

const JOINT_SNAPSHOT = [
  { name: 'joint_1', kp: 4200, kd: 140 },
  { name: 'joint_2', kp: 4020, kd: 134 },
  { name: 'joint_3', kp: 3840, kd: 128 },
  { name: 'joint_4', kp: 3660, kd: 122 },
  { name: 'joint_5', kp: 3480, kd: 116 },
  { name: 'joint_6', kp: 3300, kd: 110 },
];

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

type PathPlanWaypoint = {
  name: string;
  pose: string;
  note: string;
};

type PathPlan = {
  summary: string;
  profile: string;
  clearance: string;
  transferMode: string;
  waypoints: PathPlanWaypoint[];
};

type TrajectoryPlan = {
  summary: string;
  profile: string;
  cycleTime: string;
  smoothness: string;
  accuracy: string;
  phases: TrajectoryPlanPhase[];
};

function inferObjectiveWeights(objectiveText: string) {
  const text = objectiveText.toLowerCase();
  let precision = 25;
  let vibration = 20;
  let cycle = 35;
  let energy = 20;

  if (/安全|safe|stability|稳定/.test(text)) {
    vibration += 10;
    precision += 5;
    cycle -= 5;
  }
  if (/速度|高速|提速|节拍|效率|faster|speed/.test(text)) {
    cycle += 15;
    energy -= 5;
  }
  if (/精度|准确|precision/.test(text)) {
    precision += 15;
    cycle -= 5;
  }
  if (/能耗|energy|节能/.test(text)) {
    energy += 10;
    cycle -= 5;
  }

  const total = precision + vibration + cycle + energy;
  return {
    precision: Math.round((precision / total) * 100),
    vibration: Math.round((vibration / total) * 100),
    cycle: Math.round((cycle / total) * 100),
    energy: Math.max(0, 100 - Math.round((precision / total) * 100) - Math.round((vibration / total) * 100) - Math.round((cycle / total) * 100)),
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
        rgba: [0.84, 0.58, 0.22, 1],
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

function buildGeneratedSceneXml(spec: SceneSpec) {
  const objectBlock = spec.objects
    .map((item) => {
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

  return `<mujoco model="ER15-1400-generated">
  <compiler angle="radian"/>

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
              </body>
            </body>
          </body>
        </body>
      </body>
    </body>
  </worldbody>
</mujoco>`;
}

function buildPathPlan(sceneText: string, taskText: string, objectiveText: string) {
  const merged = `${sceneText} ${taskText}`.toLowerCase();
  const inferred = inferObjectiveWeights(objectiveText);
  const vibrationWeight = inferred.vibration;
  const isPalletizing = /码垛|托盘|pallet/.test(merged);
  const sourceSide = /左边托盘|左侧托盘|左托盘|from left|从左/.test(merged) ? '左托盘' : '上料区';
  const targetSide = /右边托盘|右侧托盘|右托盘|to right|到右/.test(merged) ? '右托盘' : '堆放区';
  const liftHeight = vibrationWeight >= 25 ? '180 mm' : '130 mm';
  const blendRadius = vibrationWeight >= 25 ? '60 mm' : '35 mm';

  const waypoints: PathPlanWaypoint[] = [
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

  return {
    summary: isPalletizing
      ? '已完成任务路径规划，得到抓取、抬升、转运、放置的五个关键路点。'
      : '已完成当前任务的关键路点规划。',
    profile: isPalletizing ? '码垛多阶段路径' : '通用任务路径',
    clearance: `${liftHeight} 安全越障高度`,
    transferMode: `上方转运 / 圆角半径 ${blendRadius}`,
    waypoints,
  } satisfies PathPlan;
}

function buildTrajectoryPlan(pathPlan: PathPlan, objectiveText: string) {
  const inferred = inferObjectiveWeights(objectiveText);
  const precisionWeight = inferred.precision;
  const vibrationWeight = inferred.vibration;
  const cycleWeight = inferred.cycle;
  const energyWeight = inferred.energy;
  const transferStyle = cycleWeight >= precisionWeight ? '直接转运' : '分段转运';
  const approachSpeed = precisionWeight >= 35 ? '0.22 m/s' : '0.32 m/s';
  const transferSpeed = cycleWeight >= 20 ? '0.55 m/s' : '0.42 m/s';
  const settleWindow = precisionWeight >= 35 ? '120 ms' : '60 ms';
  const energyMode = energyWeight >= 20 ? '限扭巡航' : '标准巡航';

  const phases: TrajectoryPlanPhase[] = [
    {
      name: '接近',
      focus: pathPlan.waypoints[0]?.pose ?? '预抓取位',
      speed: approachSpeed,
      note: `低速下降并保留 ${settleWindow} 稳定窗口，保证抓取可靠性`,
    },
    {
      name: 'Pick',
      focus: pathPlan.waypoints[1]?.pose ?? '抓取位',
      speed: '0.12 m/s',
      note: '短暂停姿并确认负载，随后再执行离托抬升',
    },
    {
      name: '抬升',
      focus: pathPlan.waypoints[2]?.pose ?? '抬升位',
      speed: '0.18 m/s',
      note: `离开托盘时保持 ${pathPlan.clearance}`,
    },
    {
      name: '转运',
      focus: pathPlan.waypoints[3]?.pose ?? '转运段',
      speed: transferSpeed,
      note: `${transferStyle}，并采用 ${pathPlan.transferMode}`,
    },
    {
      name: '放置',
      focus: pathPlan.waypoints[4]?.pose ?? '放置位',
      speed: '0.16 m/s',
      note: '最终放置阶段采用精度优先与柔和接触落点策略',
    },
  ];

  return {
    summary: '已在既定路径上完成轨迹优化，形成可执行的速度、平滑和落点控制策略。',
    profile: `${pathPlan.profile} / ${transferStyle} / ${energyMode}`,
    cycleTime: cycleWeight >= 20 ? '优先提高转运节拍' : '保持节拍均衡',
    smoothness: vibrationWeight >= 25 ? '高平滑度 / 更大圆角半径' : '标准平滑度',
    accuracy: precisionWeight >= 35 ? '已启用高精度接近与落点控制' : '采用标准接近窗口',
    phases,
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
  pathPlan: PathPlan | null;
  pathStatus: string;
  trajectoryPlan: TrajectoryPlan | null;
  trajectoryStatus: string;
  onPlanPath: () => void;
  onPlanTrajectory: () => void;
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
          <SectionTitle icon={GitBranch} label="路径规划" tone="text-amber-400" />
          <div className="space-y-3 bg-white/[0.03] px-4 py-4 text-sm">
            <div className="leading-relaxed text-muted">
              第一步先根据任务对象和工位关系生成关键路径，明确抓取点、抬升点、转运通道和放置点。
            </div>
            <div className="font-mono text-xs text-blue-400">{props.pathStatus}</div>
            <button
              onClick={props.onPlanPath}
              className="flex items-center gap-2 bg-amber-500 px-4 py-3 text-sm font-semibold text-white"
            >
              <GitBranch size={14} /> 规划任务路径
            </button>
          </div>
        </div>
        {props.pathPlan ? (
          <div>
            <SectionTitle icon={ListTree} label="规划路径" tone="text-blue-400" />
            <div className="space-y-3">
              <div className="bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-main">{props.pathPlan.summary}</div>
              {props.pathPlan.waypoints.map((waypoint) => (
                <div key={waypoint.name} className="bg-white/[0.03] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-main">{waypoint.name}</span>
                    <span className="font-mono text-xs text-amber-300">{waypoint.pose}</span>
                  </div>
                  <div className="mt-2 text-xs leading-relaxed text-blue-300">{waypoint.note}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <SectionTitle icon={Zap} label="轨迹优化" tone="text-emerald-400" />
          <div className="space-y-3 bg-white/[0.03] px-4 py-4 text-sm">
            <div className="leading-relaxed text-muted">
              第二步在既定路径上优化速度、平滑度和能耗，形成可执行轨迹。
            </div>
            <div className="font-mono text-xs text-blue-400">{props.trajectoryStatus}</div>
            <button
              onClick={props.onPlanTrajectory}
              disabled={!props.pathPlan}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold text-white ${
                props.pathPlan ? 'bg-emerald-500' : 'cursor-not-allowed bg-white/10 text-white/40'
              }`}
            >
              <Zap size={14} /> 优化任务轨迹
            </button>
          </div>
        </div>
        {props.trajectoryPlan ? (
          <div>
            <SectionTitle icon={Activity} label="优化轨迹" tone="text-emerald-400" />
            <div className="space-y-3">
              <div className="bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-main">{props.trajectoryPlan.summary}</div>
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
          <div className="space-y-4">
            {[
              { label: 'kp', value: 4200, width: 74 },
              { label: 'ki', value: 18, width: 28 },
              { label: 'kd', value: 140, width: 46 },
            ].map((item) => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-mono uppercase text-muted">{item.label}</span>
                  <span className="font-mono text-main">{item.value}</span>
                </div>
                <div className="h-1.5 bg-white/10">
                  <div className="h-1.5 bg-violet-500" style={{ width: `${item.width}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle icon={Server} label="计算预算" tone="text-emerald-400" />
          <div className="space-y-3">
            <MetricCard label="并行工作线程" value="8" tone="text-emerald-400" />
            <MetricCard label="优化轮数" value="5" />
            <MetricCard label="每轮试验数" value="24" />
            <MetricCard label="单次仿真时长" value="5.0 s" />
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
  const [step, setStep] = useState<StudioStep>('scene');
  const [scenePrompt, setScenePrompt] = useState('车间环境，包含ER15-1400 机器人工作单元和左右2个托盘区。其中，左侧托盘中摆放了10个箱体。');
  const [taskPrompt, setTaskPrompt] = useState('机器人执行包装码垛，将左边托盘中的箱体抓取后放到右边托盘。');
  const [objectivePrompt, setObjectivePrompt] = useState('在保证机器人和操作安全的前提下，尽量提高速度');
  const [generationStatus, setGenerationStatus] = useState('当前使用 ER15-1400 基线场景。');
  const [generatedSummary, setGeneratedSummary] = useState('输入场景和任务描述后，可以一键生成包含机器人、输送线、托盘和箱体的完整 MuJoCo 环境。');
  const [generatedSceneXml, setGeneratedSceneXml] = useState<string | null>(null);
  const [pathStatus, setPathStatus] = useState('等待执行任务路径规划。');
  const [pathPlan, setPathPlan] = useState<PathPlan | null>(null);
  const [trajectoryStatus, setTrajectoryStatus] = useState('等待执行目标驱动的轨迹优化。');
  const [trajectoryPlan, setTrajectoryPlan] = useState<TrajectoryPlan | null>(null);
  const stepMeta = STUDIO_STEPS.find((item) => item.id === step) ?? STUDIO_STEPS[0];
  const objectiveWeights = inferObjectiveWeights(objectivePrompt);

  const handleGenerateScene = () => {
    const spec = buildSceneSpec(scenePrompt, taskPrompt);
    const xml = buildGeneratedSceneXml(spec);
    setGeneratedSceneXml(xml);
    setGenerationStatus(`已生成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / 场景可用于预览`);
    setGeneratedSummary(`${spec.summary}。已根据“${scenePrompt} / ${taskPrompt}”生成完整 MJCF 环境，并注入到中间 MuJoCo 工作区。`);
  };

  const handlePlanPath = () => {
    const plan = buildPathPlan(scenePrompt, taskPrompt, objectivePrompt);
    setPathPlan(plan);
    setTrajectoryPlan(null);
    setPathStatus(`已规划 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${plan.profile}`);
    setTrajectoryStatus('路径已就绪，请继续执行轨迹优化。');
  };

  const handlePlanTrajectory = () => {
    const currentPathPlan = pathPlan ?? buildPathPlan(scenePrompt, taskPrompt, objectivePrompt);
    if (!pathPlan) {
      setPathPlan(currentPathPlan);
      setPathStatus(`已规划 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${currentPathPlan.profile}`);
    }
    const plan = buildTrajectoryPlan(currentPathPlan, objectivePrompt);
    setTrajectoryPlan(plan);
    setTrajectoryStatus(`已优化 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} / ${plan.profile}`);
  };

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
              pathPlan={pathPlan}
              pathStatus={pathStatus}
              trajectoryPlan={trajectoryPlan}
              trajectoryStatus={trajectoryStatus}
              onPlanPath={handlePlanPath}
              onPlanTrajectory={handlePlanTrajectory}
            />
          )}
        </div>

        <div className="relative min-h-0 overflow-hidden border-r border-[var(--card-border)]">
          <MujocoViewer
            sceneFile={generatedSceneXml ? 'generated-scene.mjcf.xml' : undefined}
            sceneXmlOverride={generatedSceneXml}
          />
          <div className="pointer-events-none absolute left-5 top-5">
            <div className="bg-[var(--nav-bg)]/90 px-4 py-3 backdrop-blur-md">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted">工作区</div>
              <div className="mt-2 text-sm font-semibold text-main">ER15-1400 仿真视图</div>
              <div className="mt-1 max-w-[240px] text-sm leading-relaxed text-muted">MuJoCo 主视图区固定显示机器人、对象和当前工位环境。</div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border-t border-[var(--card-border)] xl:border-t-0">
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={FolderTree} label="当前步骤" tone="text-blue-400" />
            <div className="text-sm font-semibold text-main">{stepMeta.title}</div>
            <div className="mt-2 text-sm leading-relaxed text-muted">{stepMeta.hint}</div>
          </div>

          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Gauge} label="状态" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="精度" value={`${objectiveWeights.precision}%`} tone="text-blue-400" />
              <DataRow label="节拍" value={`${objectiveWeights.cycle}%`} tone="text-blue-400" />
              <DataRow label="能耗" value={`${objectiveWeights.energy}%`} tone="text-emerald-400" />
              {pathPlan ? <DataRow label="路径" value={pathPlan.profile} tone="text-amber-300" /> : null}
              {trajectoryPlan ? <DataRow label="轨迹" value={trajectoryPlan.profile} tone="text-amber-300" /> : null}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <SectionTitle icon={Bot} label="决策说明" tone="text-amber-400" />
            <div className="space-y-3 text-sm text-muted">
              {trajectoryPlan ? (
                <>
                  <p>{trajectoryPlan.summary}</p>
                  <p>{trajectoryPlan.accuracy}</p>
                  <p>{trajectoryPlan.smoothness}</p>
                </>
              ) : pathPlan ? (
                <>
                  <p>{pathPlan.summary}</p>
                  <p>{pathPlan.clearance}</p>
                  <p>{pathPlan.transferMode}</p>
                </>
              ) : (
                <>
                  <p>主区始终保留模型视图，不再把参数和状态分散到多个角落。</p>
                  <p>当前步骤之外的细节统一收纳到侧栏与日志区，避免页面一次铺满。</p>
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

