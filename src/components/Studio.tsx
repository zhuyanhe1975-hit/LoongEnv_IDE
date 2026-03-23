import React, { useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Box,
  ChevronRight,
  Code,
  Cpu,
  Download,
  Gauge,
  Save,
  Sliders,
  Target,
  Terminal,
  Workflow,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MujocoViewer } from './MujocoViewer';

interface AlgorithmConfig {
  type: 'PID' | 'MPC' | 'LQR';
  params: {
    kp: number;
    ki: number;
    kd: number;
  };
}

interface WeightConfig {
  energy: number;
  precision: number;
  vibration: number;
  cycleTime: number;
}

const PRESETS: Array<{ id: string; name: string; weights: WeightConfig }> = [
  { id: 'tempo', name: '节拍优先', weights: { energy: 10, precision: 20, vibration: 10, cycleTime: 60 } },
  { id: 'precision', name: '精度优先', weights: { energy: 10, precision: 70, vibration: 10, cycleTime: 10 } },
  { id: 'stable', name: '稳定优先', weights: { energy: 10, precision: 20, vibration: 60, cycleTime: 10 } },
];

const JOINT_NAMES = ['joint_1', 'joint_2', 'joint_3', 'joint_4', 'joint_5', 'joint_6'];

export const Studio: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'tasks' | 'algorithms' | 'export'>('tasks');
  const [scene, setScene] = useState('车间环境 + 6轴工业机器人');
  const [taskType, setTaskType] = useState('包装袋码垛');
  const [goal, setGoal] = useState('安全、高速、低振动');
  const [algo, setAlgo] = useState<AlgorithmConfig>({
    type: 'PID',
    params: { kp: 4200, ki: 18, kd: 140 },
  });
  const [weights, setWeights] = useState<WeightConfig>({
    energy: 20,
    precision: 40,
    vibration: 25,
    cycleTime: 15,
  });
  const [activePresetId, setActivePresetId] = useState<string | null>('precision');
  const [useAIStrategy, setUseAIStrategy] = useState(true);
  const [parallelWorkers, setParallelWorkers] = useState(8);
  const [maxRounds, setMaxRounds] = useState(5);
  const [trialsPerRound, setTrialsPerRound] = useState(24);
  const [simDuration, setSimDuration] = useState(5);
  const [resumeOptimization, setResumeOptimization] = useState(true);

  const derivedMetrics = useMemo(() => {
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
    const normalized = {
      energy: weights.energy / totalWeight,
      precision: weights.precision / totalWeight,
      vibration: weights.vibration / totalWeight,
      cycleTime: weights.cycleTime / totalWeight,
    };
    const precisionMm = Math.max(0.8, 7.8 - algo.params.kp / 850 - algo.params.kd / 260);
    const vibrationScore = Math.max(0.06, 1.35 - algo.params.kd / 220 + algo.params.ki / 90);
    const cycleTimeS = Math.max(1.6, 5.8 - algo.params.kp / 1800 - parallelWorkers * 0.06);
    const energyKwh = Math.max(0.45, 2.9 - algo.params.kd / 180 + simDuration * 0.12);
    const totalScore =
      normalized.precision * precisionMm +
      normalized.vibration * vibrationScore +
      normalized.cycleTime * cycleTimeS +
      normalized.energy * energyKwh;

    return { precisionMm, vibrationScore, cycleTimeS, energyKwh, totalScore };
  }, [algo.params, parallelWorkers, simDuration, weights]);

  const jointParams = useMemo(
    () =>
      JOINT_NAMES.map((name, index) => ({
        name,
        kp: algo.params.kp - index * 180,
        kd: Math.max(20, algo.params.kd - index * 6),
      })),
    [algo.params.kd, algo.params.kp],
  );

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setActivePresetId(presetId);
    setWeights(preset.weights);
  };

  const handleWeightChange = (key: keyof WeightConfig, value: number) => {
    setActivePresetId(null);
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-loong-dark font-sans text-main transition-colors duration-300">
      <header className="h-16 border-b border-[var(--line)] bg-[var(--nav-bg)] px-6 backdrop-blur-md">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="rounded-lg p-2 text-muted transition-colors hover:bg-white/5 hover:text-loong-accent">
              <ChevronRight className="rotate-180" size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-500 font-bold text-white">S</div>
              <h1 className="font-display text-lg font-bold tracking-tight">LoongEnv-Studio</h1>
              <span className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-500">
                DESIGN MODE
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10">
              <Save size={16} /> 保存
            </button>
            <button className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-600">
              <Download size={16} /> 导出工程配置
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-64 flex-col border-r border-[var(--line)] bg-black/5">
          <nav className="space-y-2 p-4">
            {[
              { id: 'tasks', label: '任务流定义', icon: Workflow },
              { id: 'algorithms', label: '算法正向设计', icon: Cpu },
              { id: 'export', label: '工程预览', icon: Terminal },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as 'tasks' | 'algorithms' | 'export')}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
                  activeTab === item.id
                    ? 'border-blue-500/20 bg-blue-500/10 text-blue-500'
                    : 'border-transparent text-muted hover:bg-white/5 hover:text-main'
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto border-t border-[var(--line)] p-6">
            <div className="space-y-2 font-mono text-[10px] text-muted">
              <div className="flex justify-between">
                <span>PROJECT_ID</span>
                <span className="text-main">LE-2026-0321</span>
              </div>
              <div className="flex justify-between">
                <span>TARGET_HW</span>
                <span className="text-main">LOONG_BOX_V2</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="tech-grid flex-1 overflow-y-auto bg-loong-dark">
          <div className={activeTab === 'algorithms' ? 'w-full' : 'mx-auto w-full max-w-[1500px]'}>
            <AnimatePresence mode="wait">
              {activeTab === 'tasks' && (
                <motion.div key="tasks" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-8">
                  <div className="mb-8">
                    <h2 className="mb-2 text-3xl font-bold">任务流定义</h2>
                    <p className="text-base text-muted">定义机器人运行场景、具体任务与优化目标。</p>
                  </div>

                  <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                    <div className="space-y-6">
                      <div className="glass-card border-l-4 border-blue-500 p-8">
                        <h3 className="mb-4 text-xl font-bold">定义场景</h3>
                        <input value={scene} onChange={(e) => setScene(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-lg focus:border-blue-500/50 focus:outline-none" />
                      </div>
                      <div className="glass-card border-l-4 border-emerald-500 p-8">
                        <h3 className="mb-4 text-xl font-bold">定义任务</h3>
                        <input value={taskType} onChange={(e) => setTaskType(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-lg focus:border-emerald-500/50 focus:outline-none" />
                      </div>
                      <div className="glass-card border-l-4 border-purple-500 p-8">
                        <h3 className="mb-4 text-xl font-bold">定义目标</h3>
                        <input value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-lg focus:border-purple-500/50 focus:outline-none" />
                      </div>
                    </div>

                    <div className="glass-card flex h-[600px] flex-col p-4 lg:h-auto">
                      <div className="mb-4 flex items-center justify-between px-2">
                        <h3 className="flex items-center gap-2 text-lg font-bold">
                          <Box size={20} className="text-emerald-500" />
                          仿真实例 (D:\AI\PerOpt)
                        </h3>
                        <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 font-mono text-[10px] text-emerald-500">
                          WASM ACTIVE
                        </span>
                      </div>
                      <div className="relative flex-1 overflow-hidden rounded-xl">
                        <MujocoViewer />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'algorithms' && (
                <motion.div
                  key="algorithms"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex min-h-[calc(100vh-64px)] flex-col"
                >
                  <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
                    <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--line)] xl:border-b-0 xl:border-r">
                      <div className="relative min-h-[520px] flex-1 overflow-hidden">
                        <MujocoViewer />

                        <div className="pointer-events-none absolute left-5 top-5 space-y-4">
                          <div className="glass-card w-44 border-[var(--line)] bg-[var(--bg-main)]/80 p-4 backdrop-blur-md">
                            <div className="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted">Optimization Profile</div>
                            <div className="space-y-2 text-xs">
                              <div className="flex justify-between"><span className="opacity-70">Controller</span><span className="font-mono font-bold text-emerald-400">{algo.type}</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Workers</span><span className="font-mono font-bold text-emerald-400">{parallelWorkers}</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Rounds</span><span className="font-mono font-bold text-emerald-400">{maxRounds}</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Trials</span><span className="font-mono font-bold text-emerald-400">{trialsPerRound}</span></div>
                            </div>
                          </div>

                          <div className="glass-card w-44 border-[var(--line)] bg-[var(--bg-main)]/80 p-4 backdrop-blur-md">
                            <div className="mb-2 text-[10px] font-mono uppercase tracking-wider text-muted">Objective Mix</div>
                            <div className="space-y-1 text-xs font-mono">
                              <div className="flex justify-between"><span className="opacity-70">Precision</span><span className="text-blue-400">{weights.precision}%</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Vibration</span><span className="text-blue-400">{weights.vibration}%</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Cycle</span><span className="text-blue-400">{weights.cycleTime}%</span></div>
                              <div className="flex justify-between"><span className="opacity-70">Energy</span><span className="text-blue-400">{weights.energy}%</span></div>
                            </div>
                          </div>
                        </div>

                        <div className="pointer-events-none absolute bottom-5 left-5">
                          <div className="glass-card border-[var(--line)] bg-[var(--bg-main)]/80 p-4 backdrop-blur-md">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-muted">Workspace State</div>
                            <div className="mt-1 text-xs font-mono text-emerald-400">MuJoCo active + optimization workspace ready</div>
                            <div className="mt-1 text-xs font-mono text-main">Model: er15-1400.mjcf.xml</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex min-h-[290px] border-t border-[var(--line)]">
                        <div className="w-56 shrink-0 border-r border-[var(--line)] p-5">
                          <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
                            <Target size={14} /> Optimization Targets
                          </h3>
                          <div className="space-y-2">
                            {PRESETS.map((preset) => (
                              <button
                                key={preset.id}
                                onClick={() => applyPreset(preset.id)}
                                className={`w-full px-3 py-2 text-left text-xs font-medium transition-all ${
                                  activePresetId === preset.id ? 'bg-emerald-500/10 text-emerald-400' : 'text-muted hover:bg-[var(--muted)]'
                                }`}
                              >
                                {preset.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex-1 p-5">
                          <div className="mb-4 flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                              <Sliders size={14} /> Controller Parameters
                            </h3>
                            <div className="flex gap-2">
                              {(['PID', 'MPC', 'LQR'] as const).map((type) => (
                                <button
                                  key={type}
                                  onClick={() => setAlgo((prev) => ({ ...prev, type }))}
                                  className={`px-4 py-2 text-sm font-bold transition-all ${
                                    algo.type === type ? 'bg-emerald-500/10 text-emerald-300' : 'text-muted hover:bg-[var(--muted)]'
                                  }`}
                                >
                                  {type}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            <div className="space-y-5">
                              {Object.entries(algo.params).map(([key, value]) => (
                                <div key={key}>
                                  <div className="mb-2 flex items-center justify-between text-sm">
                                    <span className="font-mono uppercase text-muted">{key}</span>
                                    <span className="font-bold text-purple-300">{value}</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={key === 'ki' ? 0 : 0.1}
                                    max={key === 'kp' ? 10000 : key === 'kd' ? 500 : 30}
                                    step={key === 'kp' ? 50 : 0.5}
                                    value={value}
                                    onChange={(e) => setAlgo((prev) => ({ ...prev, params: { ...prev.params, [key]: Number(e.target.value) } }))}
                                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-purple-500"
                                  />
                                </div>
                              ))}
                            </div>

                            <div className="space-y-4">
                              <div className="mb-1 flex items-center justify-between text-sm">
                                <span className="font-medium text-muted">AI 闭环优化</span>
                                <button
                                  onClick={() => setUseAIStrategy((prev) => !prev)}
                                  className={`relative h-6 w-11 rounded-full transition-colors ${useAIStrategy ? 'bg-amber-500' : 'bg-white/15'}`}
                                >
                                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${useAIStrategy ? 'left-6' : 'left-1'}`} />
                                </button>
                              </div>
                              <div className="mb-4 flex items-center justify-between text-sm">
                                <span className="font-medium text-muted">继续优化</span>
                                <button
                                  onClick={() => setResumeOptimization((prev) => !prev)}
                                  className={`relative h-6 w-11 rounded-full transition-colors ${resumeOptimization ? 'bg-emerald-500' : 'bg-white/15'}`}
                                >
                                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${resumeOptimization ? 'left-6' : 'left-1'}`} />
                                </button>
                              </div>

                              {[
                                { label: '并行进程数', value: parallelWorkers, setter: setParallelWorkers, min: 1, max: 8, step: 1 },
                                { label: '优化轮数', value: maxRounds, setter: setMaxRounds, min: 1, max: 20, step: 1 },
                                { label: '每轮试验数', value: trialsPerRound, setter: setTrialsPerRound, min: 4, max: 80, step: 1 },
                                { label: '仿真时长 (s)', value: simDuration, setter: setSimDuration, min: 1, max: 15, step: 0.5 },
                              ].map((item) => (
                                <div key={item.label}>
                                  <div className="mb-2 flex items-center justify-between text-sm">
                                    <span className="text-muted">{item.label}</span>
                                    <span className="font-mono text-emerald-400">{item.value}</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={item.min}
                                    max={item.max}
                                    step={item.step}
                                    value={item.value}
                                    onChange={(e) => item.setter(Number(e.target.value))}
                                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-white/10 accent-emerald-500"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <aside className="flex w-full shrink-0 flex-col xl:w-[320px]">
                      <div className="border-b border-[var(--line)] p-5">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                          <Box size={14} /> Model Library
                        </h3>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-muted">Model</span><span className="font-mono text-main">ER15-1400</span></div>
                          <div className="flex justify-between"><span className="text-muted">Type</span><span className="font-mono text-blue-400">MJCF</span></div>
                          <div className="flex justify-between"><span className="text-muted">Scene</span><span className="font-mono text-main">ER15</span></div>
                          <div className="flex justify-between"><span className="text-muted">Source</span><span className="font-mono text-main">PerOpt</span></div>
                        </div>
                      </div>

                      <div className="border-b border-[var(--line)] p-5">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
                          <Gauge size={14} /> Optimization Status
                        </h3>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between"><span className="text-muted">Total Score</span><span className="font-mono text-main">{derivedMetrics.totalScore.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-muted">Precision</span><span className="font-mono text-blue-400">{derivedMetrics.precisionMm.toFixed(2)} mm</span></div>
                          <div className="flex justify-between"><span className="text-muted">Cycle</span><span className="font-mono text-blue-400">{derivedMetrics.cycleTimeS.toFixed(2)} s</span></div>
                          <div className="flex justify-between"><span className="text-muted">Vibration</span><span className="font-mono text-amber-400">{derivedMetrics.vibrationScore.toFixed(3)}</span></div>
                          <div className="flex justify-between"><span className="text-muted">Energy</span><span className="font-mono text-emerald-400">{derivedMetrics.energyKwh.toFixed(2)} kWh</span></div>
                        </div>
                      </div>

                      <div className="border-b border-[var(--line)] p-5">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400">
                          <Bot size={14} /> Strategy Notes
                        </h3>
                        <div className="space-y-3 text-sm leading-relaxed text-muted">
                          <div>当前默认以统一 PID 为基线，围绕节拍、精度、振动和能耗做折中优化。</div>
                          <div>如果误差异常大，优先排查碰撞、自碰和执行器映射，再回到 PID 或前馈参数。</div>
                          <div>想提高产线节拍，优先提高 cycleTime 权重；想更稳，优先提高 vibration 权重并提升 kd。</div>
                        </div>
                      </div>

                      <div className="flex-1 p-5">
                        <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-400">
                          <Activity size={14} /> PD Snapshot
                        </h3>
                        <div className="space-y-3">
                          {jointParams.map((joint) => (
                            <div key={joint.name} className="bg-[var(--bg-main)]/25 p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="font-mono text-sm font-bold">{joint.name}</span>
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <div className="mb-1 flex justify-between text-muted">
                                    <span>Kp</span>
                                    <span className="font-mono text-main">{joint.kp.toFixed(0)}</span>
                                  </div>
                                  <div className="h-1 rounded-full bg-white/10">
                                    <div className="h-1 rounded-full bg-emerald-500" style={{ width: `${Math.min(100, joint.kp / 100)}%` }} />
                                  </div>
                                </div>
                                <div>
                                  <div className="mb-1 flex justify-between text-muted">
                                    <span>Kd</span>
                                    <span className="font-mono text-main">{joint.kd.toFixed(1)}</span>
                                  </div>
                                  <div className="h-1 rounded-full bg-white/10">
                                    <div className="h-1 rounded-full bg-amber-500" style={{ width: `${Math.min(100, joint.kd / 5)}%` }} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </aside>
                  </div>
                </motion.div>
              )}

              {activeTab === 'export' && (
                <motion.div key="export" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-8">
                  <div className="mb-8 flex items-center justify-between">
                    <h2 className="text-3xl font-bold">工程预览 (JSON)</h2>
                    <button className="rounded-xl p-3 text-muted transition-colors hover:bg-white/5 hover:text-main">
                      <Code size={24} />
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-3xl border border-white/5 bg-black/60 p-10 font-mono text-sm text-blue-400/80 shadow-2xl">
                    <pre className="leading-relaxed">
                      {JSON.stringify(
                        {
                          project: 'LE-2026-0321',
                          version: '1.0.0',
                          definition: { scene, task: taskType, goal },
                          algorithm: {
                            ...algo,
                            orchestration: { useAIStrategy, parallelWorkers, maxRounds, trialsPerRound, simDuration, resumeOptimization },
                            weights,
                          },
                          hardware: 'LOONG_BOX_V2',
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
};
