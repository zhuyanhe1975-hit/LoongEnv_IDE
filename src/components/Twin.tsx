import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Square, 
  RotateCcw, 
  ChevronRight, 
  Activity, 
  ShieldAlert, 
  Cpu, 
  Zap,
  Maximize2,
  Settings,
  Terminal,
  RefreshCw,
  Box as BoxIcon,
  Link as LinkIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { MujocoViewer } from './MujocoViewer';

interface TelemetryData {
  time: number;
  joint1: number;
  joint2: number;
  torque: number;
  error: number;
}

const MODELS = [
  {
    id: 'er15-1400',
    name: 'ER15-1400',
    file: 'er15-1400.mjcf.xml',
    source: 'https://github.com/zhuyanhe1975-hit/PerfOpt/blob/main/models/er15-1400.mjcf.xml',
    joints: 6,
    type: 'MJCF'
  }
];

export const Twin: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryData[]>([]);
  const [activeJoint, setActiveJoint] = useState(1);
  const [simSpeed, setSimSpeed] = useState(1);
  const [activeModelId, setActiveModelId] = useState(MODELS[0].id);
  const [logs, setLogs] = useState<{time: string, msg: string, type: 'info' | 'warn' | 'error'}[]>([
    { time: '08:00:01', msg: 'Physics engine initialized: MuJoCo', type: 'info' },
    { time: '08:00:02', msg: `Loading model from PerfOpt: ${MODELS[0].file}`, type: 'info' },
    { time: '08:00:03', msg: `Robot model loaded: ${MODELS[0].name} (${MODELS[0].joints} DOF)`, type: 'info' },
  ]);

  const activeModel = MODELS.find(m => m.id === activeModelId) || MODELS[0];
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isSimulating) {
      timerRef.current = setInterval(() => {
        const now = Date.now() * 0.001 * simSpeed;
        const newAngles = Array.from({ length: activeModel.joints }).map((_, i) => Math.sin(now * (0.5 + i * 0.2)) * (Math.PI / 4));

        setTelemetry(prev => {
          const nextTime = prev.length > 0 ? prev[prev.length - 1].time + 1 : 0;
          const newData = {
            time: nextTime,
            joint1: (newAngles[0] * 180) / Math.PI,
            joint2: (newAngles[1] * 180) / Math.PI,
            torque: 10 + Math.abs(Math.sin(now * 0.5)) * 50,
            error: Math.abs(Math.sin(now * 2)) * 0.5
          };
          const updated = [...prev, newData].slice(-30);
          return updated;
        });

        if (Math.random() > 0.98) {
          setLogs(prev => [
            { 
              time: new Date().toLocaleTimeString([], { hour12: false }), 
              msg: Math.random() > 0.5 ? `Approaching joint limit: J${Math.floor(Math.random() * activeModel.joints) + 1}` : 'Dynamic compensation active', 
              type: (Math.random() > 0.5 ? 'warn' : 'info') as 'warn' | 'info' | 'error'
            },
            ...prev
          ].slice(0, 50));
        }
      }, 50); // 50ms for smoother 3D animation
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isSimulating, simSpeed, activeModel.joints]);

  const resetSim = () => {
    setIsSimulating(false);
    setTelemetry([]);
    setLogs([{ time: new Date().toLocaleTimeString([], { hour12: false }), msg: 'Simulation reset', type: 'info' }]);
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelId = e.target.value;
    setActiveModelId(newModelId);
    const model = MODELS.find(m => m.id === newModelId);
    if (model) {
      setIsSimulating(false);
      setTelemetry([]);
      setLogs(prev => [
        { time: new Date().toLocaleTimeString([], { hour12: false }), msg: `Loading model: ${model.file}`, type: 'info' as const },
        { time: new Date().toLocaleTimeString([], { hour12: false }), msg: `Robot model loaded: ${model.name} (${model.joints} DOF)`, type: 'info' as const },
        ...prev
      ].slice(0, 50));
    }
  };

  return (
    <div className="fixed inset-0 bg-[var(--bg-main)] z-[100] flex flex-col font-sans text-[var(--text-main)] transition-colors duration-300 overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-[var(--line)] flex items-center justify-between px-4 sm:px-6 bg-[var(--nav-bg)] backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-[var(--muted)] rounded-lg transition-colors text-[var(--text-main)] opacity-70 hover:opacity-100"
          >
            <ChevronRight className="rotate-180" size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-bold text-white">T</div>
            <h1 className="font-display font-bold text-lg tracking-tight hidden sm:block">LoongEnv-Twin</h1>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-mono border border-emerald-500/20">SIMULATION MODE</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--line)]">
            <span className="text-[10px] font-mono opacity-60">SPEED</span>
            <select 
              value={simSpeed} 
              onChange={(e) => setSimSpeed(Number(e.target.value))}
              className="bg-transparent border-none text-xs font-bold focus:ring-0 cursor-pointer text-[var(--text-main)] outline-none"
            >
              <option value={0.5} className="bg-[var(--bg-main)]">0.5x</option>
              <option value={1} className="bg-[var(--bg-main)]">1.0x</option>
              <option value={2} className="bg-[var(--bg-main)]">2.0x</option>
              <option value={5} className="bg-[var(--bg-main)]">5.0x</option>
            </select>
          </div>
          <div className="hidden sm:block h-8 w-px bg-[var(--line)]" />
          <button 
            onClick={() => setIsSimulating(!isSimulating)}
            className={`flex items-center justify-center gap-2 px-4 sm:px-6 py-2 rounded-lg font-bold transition-all shadow-lg text-sm ${
              isSimulating 
                ? 'bg-rose-500 text-white shadow-rose-500/20' 
                : 'bg-emerald-500 text-white shadow-emerald-500/20'
            }`}
          >
            {isSimulating ? <><Square size={16} /> <span className="hidden sm:inline">停止仿真</span></> : <><Play size={16} /> <span className="hidden sm:inline">开始仿真</span></>}
          </button>
          <button 
            onClick={resetSim}
            className="p-2 hover:bg-[var(--muted)] rounded-lg opacity-70 hover:opacity-100 transition-colors"
            title="Reset Simulation"
          >
            <RotateCcw size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Panel: Visualizer & Controls */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* 3D Visualizer Placeholder */}
          <div className="flex-1 relative bg-[var(--card-bg)] tech-grid overflow-hidden">
            <div className="absolute inset-0">
              <MujocoViewer />
            </div>

            {/* HUD Overlays */}
            <div className="absolute top-4 sm:top-6 left-4 sm:left-6 space-y-4 pointer-events-none">
              <div className="glass-card p-4 w-48 bg-[var(--bg-main)]/80 backdrop-blur-md border-[var(--line)] pointer-events-auto">
                <div className="text-[10px] font-mono opacity-60 mb-2 uppercase tracking-wider">Joint States (deg)</div>
                <div className="space-y-2">
                  {Array.from({ length: activeModel.joints }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-xs opacity-70">J{i + 1}</span>
                      <span className="text-xs font-mono font-bold text-emerald-500">
                        {isSimulating ? (Math.sin(Date.now() * 0.001 * (i + 1)) * 45).toFixed(2) : '0.00'}°
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card p-4 w-48 bg-[var(--bg-main)]/80 backdrop-blur-md border-[var(--line)] pointer-events-auto">
                <div className="text-[10px] font-mono opacity-60 mb-2 uppercase tracking-wider">End Effector (mm)</div>
                <div className="space-y-1 text-xs font-mono">
                  <div className="flex justify-between"><span className="opacity-70">X:</span> <span className="text-blue-500">245.21</span></div>
                  <div className="flex justify-between"><span className="opacity-70">Y:</span> <span className="text-blue-500">-12.05</span></div>
                  <div className="flex justify-between"><span className="opacity-70">Z:</span> <span className="text-blue-500">512.88</span></div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-4 sm:bottom-6 right-4 sm:right-6 flex gap-2">
              <button className="p-3 glass-card bg-[var(--bg-main)]/80 backdrop-blur-md border-[var(--line)] hover:bg-[var(--muted)] transition-colors opacity-70 hover:opacity-100">
                <Maximize2 size={18} />
              </button>
              <button className="p-3 glass-card bg-[var(--bg-main)]/80 backdrop-blur-md border-[var(--line)] hover:bg-[var(--muted)] transition-colors opacity-70 hover:opacity-100">
                <Settings size={18} />
              </button>
            </div>
          </div>

          {/* Bottom Telemetry Panel */}
          <div className="h-48 sm:h-64 border-t border-[var(--line)] bg-[var(--bg-main)] flex flex-col sm:flex-row shrink-0">
            <div className="w-full sm:w-64 border-b sm:border-b-0 sm:border-r border-[var(--line)] p-4 sm:p-6 flex flex-row sm:flex-col gap-2 sm:gap-4 overflow-x-auto sm:overflow-x-visible">
              <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest flex items-center gap-2 shrink-0">
                <Activity size={14} className="text-emerald-500" /> Telemetry
              </h3>
              <div className="flex flex-row sm:flex-col gap-2">
                {['Joint Position', 'Torque Output', 'Tracking Error'].map((label, i) => (
                  <button 
                    key={label}
                    onClick={() => setActiveJoint(i + 1)}
                    className={`text-left px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      activeJoint === i + 1 ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'opacity-70 hover:bg-[var(--muted)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 p-4 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={telemetry}>
                  <defs>
                    <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.05} vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={['auto', 'auto']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-main)' }}
                    itemStyle={{ color: '#10b981' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={activeJoint === 1 ? 'joint1' : activeJoint === 2 ? 'torque' : 'error'} 
                    stroke="#10b981" 
                    fillOpacity={1} 
                    fill="url(#colorVal)" 
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Logs & Status */}
        <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-[var(--line)] bg-[var(--card-bg)] flex flex-col shrink-0 h-[400px] lg:h-auto">
          {/* Model Library Section */}
          <div className="p-4 sm:p-6 border-b border-[var(--line)]">
            <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest mb-4 flex items-center gap-2">
              <BoxIcon size={14} className="text-indigo-500" /> Model Library
            </h3>
            <div className="space-y-3">
              <select 
                value={activeModelId}
                onChange={handleModelChange}
                className="w-full bg-[var(--muted)] border border-[var(--line)] rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-main)] outline-none focus:border-emerald-500 transition-colors"
              >
                {MODELS.map(model => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
              </select>
              
              <div className="bg-[var(--muted)]/50 rounded-lg p-3 text-xs space-y-2 border border-[var(--line)]">
                <div className="flex justify-between">
                  <span className="opacity-60">Type</span>
                  <span className="font-mono font-bold">{activeModel.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="opacity-60">DOF</span>
                  <span className="font-mono font-bold">{activeModel.joints} Joints</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="opacity-60">Source</span>
                  {activeModel.source.startsWith('http') ? (
                    <a href={activeModel.source} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                      PerfOpt <LinkIcon size={10} />
                    </a>
                  ) : (
                    <span className="font-mono">{activeModel.source}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 border-b border-[var(--line)]">
            <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Cpu size={14} className="text-blue-500" /> Digital Twin Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="opacity-70">Sync Status</span>
                <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="opacity-70">Latency</span>
                <span className="font-mono text-blue-500 font-medium">1.2ms</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="opacity-70">Model Drift</span>
                <span className="font-mono text-amber-500 font-medium">0.02%</span>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between bg-[var(--card-bg)] shrink-0">
              <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest flex items-center gap-2">
                <Terminal size={14} /> Simulation Logs
              </h3>
              <button 
                onClick={() => setLogs([])}
                className="text-[10px] opacity-60 hover:opacity-100 transition-colors font-bold"
              >
                CLEAR
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-2">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3 leading-relaxed">
                  <span className="opacity-40 shrink-0">[{log.time}]</span>
                  <span className={
                    log.type === 'error' ? 'text-rose-500' : 
                    log.type === 'warn' ? 'text-amber-500' : 
                    'opacity-90'
                  }>
                    {log.msg}
                  </span>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="h-full flex items-center justify-center opacity-40 italic">
                  No logs recorded
                </div>
              )}
            </div>
          </div>

          <div className="p-4 sm:p-6 border-t border-[var(--line)] bg-[var(--card-bg)] shrink-0">
            <button className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[var(--muted)] border border-[var(--line)] text-sm font-bold hover:bg-[var(--line)] transition-all">
              <RefreshCw size={16} /> 同步至实机 (Box)
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
