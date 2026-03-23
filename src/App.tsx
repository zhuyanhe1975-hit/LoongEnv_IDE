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
  { id: 'scene', label: '01 Scene', title: '定义场景', hint: '只确认场景、任务和目标对象。' },
  { id: 'objective', label: '02 Objective', title: '设置目标', hint: '先选优化倾向，再看核心权重。' },
  { id: 'controller', label: '03 Controller', title: '配置控制器', hint: '只调整当前控制器与优化预算。' },
  { id: 'review', label: '04 Review', title: '检查并启动', hint: '确认模型、指标和启动条件。' },
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
  '[planner] Scene synchronized with ER15 workspace',
  '[mujoco] er15-1400.mjcf.xml compiled successfully',
  '[optimizer] PID baseline loaded from current preset',
  '[twin] Collision probes ready, no blocking contacts',
  '[box] Runtime target: LOONG_BOX_V2',
];

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
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Editor</div>
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

function StudioOperationPanel(props: { step: StudioStep }) {
  if (props.step === 'scene') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={FolderTree} label="Scene" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">车间环境 + 6轴工业机器人</div>
        </div>
        <div>
          <SectionTitle icon={Activity} label="Task" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">包装码垛</div>
        </div>
        <div>
          <SectionTitle icon={Gauge} label="Goal" tone="text-blue-400" />
          <div className="bg-white/[0.03] px-4 py-3 text-sm text-main">安全 / 高速 / 低振动</div>
        </div>
      </div>
    );
  }

  if (props.step === 'objective') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={Gauge} label="Preset" tone="text-emerald-400" />
          <div className="space-y-2">
            {['精度优先', '节拍优先', '稳定优先'].map((preset, index) => (
              <div key={preset} className={`px-4 py-3 text-sm ${index === 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-white/[0.03] text-muted'}`}>
                {preset}
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle icon={Brain} label="Weights" tone="text-blue-400" />
          <div className="space-y-4">
            {OBJECTIVE_WEIGHTS.map((item) => (
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
      </div>
    );
  }

  if (props.step === 'controller') {
    return (
      <div className="space-y-6">
        <div>
          <SectionTitle icon={Bot} label="Controller" tone="text-violet-400" />
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
          <SectionTitle icon={Server} label="Budget" tone="text-emerald-400" />
          <div className="space-y-3">
            <MetricCard label="Workers" value="8" tone="text-emerald-400" />
            <MetricCard label="Rounds" value="5" />
            <MetricCard label="Trials / Round" value="24" />
            <MetricCard label="Simulation" value="5.0 s" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle icon={Shield} label="Readiness" tone="text-emerald-400" />
        <div className="space-y-2">
          <DataRow label="Model" value="Compiled" tone="text-emerald-400" />
          <DataRow label="Collision Probe" value="Ready" tone="text-emerald-400" />
          <DataRow label="Controller" value="PID baseline" tone="text-blue-400" />
          <DataRow label="Preset" value="precision" tone="text-blue-400" />
        </div>
      </div>
      <div>
        <button className="flex items-center gap-2 bg-emerald-500 px-4 py-3 text-sm font-semibold text-white">
          <Play size={14} /> 启动自动优化
        </button>
      </div>
    </div>
  );
}

function StudioWorkbench() {
  const [step, setStep] = useState<StudioStep>('scene');
  const stepMeta = STUDIO_STEPS.find((item) => item.id === step) ?? STUDIO_STEPS[0];

  return (
    <EditorChrome
      title="Forward Design Workspace"
      description="固定工作区、固定状态栏、固定底部面板。编辑区只展示当前步骤。"
      actions={
        <>
          <StatusPill label={stepMeta.label} />
          <StatusPill label="mjcf ready" tone="text-emerald-400" />
        </>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_280px] xl:grid-rows-[auto_minmax(0,1fr)]">
        <div className="col-span-full border-b border-[var(--card-border)] bg-[#121a2a] px-4 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Workflow Tabs</div>
          <div className="flex items-end gap-2 overflow-x-auto">
          {STUDIO_STEPS.map((item) => (
            <StepButton key={item.id} active={step === item.id} label={item.label} onClick={() => setStep(item.id)} />
          ))}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto border-r border-[var(--card-border)] px-4 py-4">
          <SectionTitle icon={FolderTree} label="Operation Panel" tone="text-blue-400" />
          <div className="mb-4 text-sm font-semibold text-main">{stepMeta.title}</div>
          <div className="mb-6 text-sm leading-relaxed text-muted">{stepMeta.hint}</div>
          <StudioOperationPanel step={step} />
        </div>

        <div className="relative min-h-0 overflow-hidden border-r border-[var(--card-border)]">
          <MujocoViewer />
          <div className="pointer-events-none absolute left-5 top-5">
            <div className="bg-[var(--nav-bg)]/90 px-4 py-3 backdrop-blur-md">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted">Workspace</div>
              <div className="mt-2 text-sm font-semibold text-main">ER15-1400 Simulation</div>
              <div className="mt-1 max-w-[240px] text-sm leading-relaxed text-muted">MuJoCo 主视图区固定显示模型和轨迹背景。</div>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border-t border-[var(--card-border)] xl:border-t-0">
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={FolderTree} label="Current Step" tone="text-blue-400" />
            <div className="text-sm font-semibold text-main">{stepMeta.title}</div>
            <div className="mt-2 text-sm leading-relaxed text-muted">{stepMeta.hint}</div>
          </div>

          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={Gauge} label="Status" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="Precision" value="2.32 mm" tone="text-blue-400" />
              <DataRow label="Cycle Time" value="2.99 s" tone="text-blue-400" />
              <DataRow label="Energy" value="2.72 kWh" tone="text-emerald-400" />
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <SectionTitle icon={Bot} label="Decision Notes" tone="text-amber-400" />
            <div className="space-y-3 text-sm text-muted">
              <p>主区始终保留模型视图，不再把参数和状态散落到多个角落。</p>
              <p>当前步骤之外的细节，统一收纳到底部面板，避免一页塞满。</p>
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
      title="Digital Twin Runtime"
      description="主区看模型，右侧看状态，底部面板看日志。"
      actions={
        <>
          <StatusPill label="runtime" tone="text-emerald-400" />
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
            <SectionTitle icon={Activity} label="Twin Status" tone="text-emerald-400" />
            <div className="space-y-2">
              <DataRow label="Sync Status" value="Connected" tone="text-emerald-400" />
              <DataRow label="Latency" value="1.2 ms" tone="text-blue-400" />
              <DataRow label="Model Drift" value="0.02%" tone="text-amber-400" />
            </div>
          </div>
          <div className="border-b border-[var(--card-border)] px-4 py-4">
            <SectionTitle icon={BoxIcon} label="Model Library" tone="text-blue-400" />
            <div className="space-y-2">
              <DataRow label="Model" value="ER15-1400" />
              <DataRow label="Type" value="MJCF" tone="text-blue-400" />
              <DataRow label="DOF" value="6 joints" />
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-4">
            <SectionTitle icon={Server} label="Simulation Logs" tone="text-muted" />
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
      actions={<StatusPill label={`${props.module.label.toLowerCase()}.workspace`} tone={props.module.color} />}
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
            这个模块先接入统一工作台骨架。后续适合继续按“主画布、右侧状态、底部工具面板”的同一规则扩展，而不是回到全屏堆叠式页面。
          </div>
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
            当前保持占位，不再制造额外卡片和多层嵌套，等你确认这个骨架满意后再补具体能力。
          </div>
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
                className={`mb-2 flex w-full items-center rounded-sm border transition-all duration-200 ${
                  navCollapsed
                    ? activeModule === module.id
                      ? 'justify-center border-white/10 bg-white/6 py-3 text-white'
                      : 'justify-center border-transparent py-3 text-muted hover:border-white/6 hover:bg-white/4 hover:text-main'
                    : activeModule === module.id
                      ? 'gap-3.5 border-white/10 bg-white/6 px-4 py-3.5 text-white'
                      : 'gap-3.5 border-transparent px-4 py-3.5 text-muted hover:border-white/6 hover:bg-white/4 hover:text-main'
                }`}
                title={module.label}
              >
                <div
                  className={`flex items-center justify-center rounded-sm border ${
                    navCollapsed ? 'h-11 w-11' : 'h-12 w-12'
                  } ${
                    activeModule === module.id
                      ? 'border-white/10 bg-white/8'
                      : 'border-white/6 bg-white/[0.025]'
                  }`}
                >
                  <module.icon size={navCollapsed ? 24 : 28} className={activeModule === module.id ? module.color : 'text-slate-200'} />
                </div>
                {!navCollapsed && (
                  <div className="min-w-0 text-left">
                    <div className="text-[15px] font-semibold tracking-[0.01em]">{module.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{module.title.replace('LoongEnv ', '')}</div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {!navCollapsed && (
            <div className="border-t border-[var(--card-border)]">
              <SideBarSection title="Project" footer={<span className={activeMeta.color}>{activeMeta.label}</span>}>
                <div className="space-y-2 text-sm">
                  <DataRow label="Project" value="LE-2026-0321" />
                  <DataRow label="Target" value="LOONG_BOX_V2" />
                  <DataRow label="Engine" value="MuJoCo" tone="text-blue-400" />
                </div>
              </SideBarSection>
            </div>
          )}

          <div className="border-t border-[var(--card-border)] py-2">
            <button
              className={`flex h-11 w-full items-center text-muted hover:bg-white/5 hover:text-main ${navCollapsed ? 'justify-center' : 'gap-3 px-4'}`}
              title="Settings"
            >
              <Settings size={20} />
              {!navCollapsed && <span className="text-sm">Settings</span>}
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
              { id: 'guide' as PanelId, icon: Bot, label: 'Guide' },
              { id: 'output' as PanelId, icon: Server, label: 'Output' },
              { id: 'terminal' as PanelId, icon: Terminal, label: 'Terminal' },
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
                <div>[guide] 左侧导航固定，模块切换位置固定</div>
                <div>[guide] 右侧只保留状态与说明，不再重复展示参数</div>
                <div>[guide] 当前步骤的详细输入统一进入底部面板</div>
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
                <div>vite build completed</div>
                <div>workspace shell active</div>
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
              <span>Workspace Ready</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Brain size={12} />
              <span>{activeMeta.label} active</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span>UTF-8</span>
            <span>TypeScript React</span>
            <span>MuJoCo Connected</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
