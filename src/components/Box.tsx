import React, { useState, useEffect } from 'react';
import { 
  Box as BoxIcon, 
  ArrowLeft, 
  Cpu, 
  Thermometer, 
  Wind, 
  Zap, 
  Wifi, 
  HardDrive, 
  ShieldCheck, 
  Terminal,
  Play,
  Download,
  Activity,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface BoxProps {
  onBack: () => void;
}

export const Box: React.FC<BoxProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'status' | 'io' | 'deploy'>('status');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(0);
  const [deployStatus, setDeployStatus] = useState('');
  const [logs, setLogs] = useState<string[]>(['[SYSTEM] LoongBox v2.1.0 initialized', '[INFO] Real-time kernel active (RT-PREEMPT)']);

  const [hwStats, setHwStats] = useState({
    temp: 42,
    cpu: 12,
    mem: 1.4,
    jitter: 12, // microseconds
    voltage: 24.1
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setHwStats(prev => ({
        ...prev,
        temp: 40 + Math.random() * 5,
        cpu: 10 + Math.random() * 15,
        jitter: 8 + Math.random() * 8
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleDeploy = () => {
    setIsDeploying(true);
    setDeployProgress(0);
    setDeployStatus('Compiling control logic...');
    setLogs(prev => [...prev, '[DEPLOY] Starting deployment sequence...', '[DEPLOY] Compiling control logic...']);
    
    const interval = setInterval(() => {
      setDeployProgress(prev => {
        const next = prev + 1;
        if (next >= 100) {
          clearInterval(interval);
          setIsDeploying(false);
          setDeployStatus('Deployment successful');
          setLogs(prevLogs => [...prevLogs, '[DEPLOY] Deployment successful!', '[SYSTEM] Controller restarted.']);
          return 100;
        }
        if (next === 30) {
          setDeployStatus('Uploading binary to LoongBox...');
          setLogs(prevLogs => [...prevLogs, '[DEPLOY] Uploading binary to LoongBox...']);
        }
        if (next === 70) {
          setDeployStatus('Verifying checksum...');
          setLogs(prevLogs => [...prevLogs, '[DEPLOY] Verifying checksum...']);
        }
        if (next === 90) {
          setDeployStatus('Restarting controller...');
          setLogs(prevLogs => [...prevLogs, '[DEPLOY] Restarting controller...']);
        }
        return next;
      });
    }, 40);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] font-sans transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-[var(--line)] bg-[var(--nav-bg)] backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 hover:bg-[var(--muted)] rounded-lg transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-400/20 text-purple-400 rounded flex items-center justify-center">
                <BoxIcon size={18} />
              </div>
              <h1 className="font-display font-bold text-lg sm:text-xl">LoongEnv-Box</h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 text-[10px] font-bold uppercase tracking-wider">
                Edge Computing
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--muted)] border border-[var(--line)]">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-mono opacity-60">CONNECTED: 192.168.1.100</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
          {/* Left Sidebar */}
          <div className="lg:col-span-3 space-y-4">
            <div className="glass-card p-2 bg-[var(--card-bg)] border-[var(--line)]">
              <button 
                onClick={() => setActiveTab('status')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'status' ? 'bg-purple-500 text-white font-bold' : 'hover:bg-[var(--muted)] text-[var(--text-main)] opacity-70'}`}
              >
                <Activity size={18} />
                <span>硬件状态</span>
              </button>
              <button 
                onClick={() => setActiveTab('io')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'io' ? 'bg-purple-500 text-white font-bold' : 'hover:bg-[var(--muted)] text-[var(--text-main)] opacity-70'}`}
              >
                <HardDrive size={18} />
                <span>I/O 配置</span>
              </button>
              <button 
                onClick={() => setActiveTab('deploy')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${activeTab === 'deploy' ? 'bg-purple-500 text-white font-bold' : 'hover:bg-[var(--muted)] text-[var(--text-main)] opacity-70'}`}
              >
                <Download size={18} />
                <span>部署任务</span>
              </button>
            </div>

            <div className="glass-card p-6 bg-[var(--card-bg)] border-[var(--line)]">
              <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                <ShieldCheck size={16} className="text-purple-400" />
                安全状态
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs opacity-60">硬件看门狗</span>
                  <span className="text-xs text-emerald-400 font-bold">ENABLED</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs opacity-60">急停回路</span>
                  <span className="text-xs text-emerald-400 font-bold">CLOSED</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs opacity-60">固件版本</span>
                  <span className="text-xs opacity-60 font-mono">v2.1.0-rt</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-9 space-y-6 sm:space-y-8">
            <AnimatePresence mode="wait">
              {activeTab === 'status' && (
                <motion.div 
                  key="status"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 sm:space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    <div className="glass-card p-6 bg-[var(--card-bg)] border-[var(--line)]">
                      <div className="flex items-center justify-between mb-4">
                        <Thermometer className="text-rose-400" size={20} />
                        <Wind className="text-blue-400 animate-spin-slow" size={20} />
                      </div>
                      <div className="text-xs opacity-50 mb-1">CPU 温度</div>
                      <div className="text-2xl sm:text-3xl font-display font-bold">{hwStats.temp.toFixed(1)}°C</div>
                      <div className="mt-4 h-1.5 bg-[var(--muted)] rounded-full overflow-hidden">
                        <div className="h-full bg-rose-400" style={{ width: `${(hwStats.temp / 80) * 100}%` }} />
                      </div>
                    </div>

                    <div className="glass-card p-6 bg-[var(--card-bg)] border-[var(--line)]">
                      <div className="flex items-center justify-between mb-4">
                        <Activity className="text-emerald-400" size={20} />
                        <Zap className="text-amber-400" size={20} />
                      </div>
                      <div className="text-xs opacity-50 mb-1">实时抖动 (Jitter)</div>
                      <div className="text-2xl sm:text-3xl font-display font-bold">{hwStats.jitter.toFixed(1)} μs</div>
                      <div className="mt-4 text-[10px] text-emerald-400 font-bold">RT-PREEMPT KERNEL ACTIVE</div>
                    </div>

                    <div className="glass-card p-6 bg-[var(--card-bg)] border-[var(--line)]">
                      <div className="flex items-center justify-between mb-4">
                        <HardDrive className="text-purple-400" size={20} />
                        <Wifi className="text-blue-400" size={20} />
                      </div>
                      <div className="text-xs opacity-50 mb-1">系统负载</div>
                      <div className="text-2xl sm:text-3xl font-display font-bold">{hwStats.cpu.toFixed(1)}%</div>
                      <div className="mt-4 text-[10px] opacity-60 font-mono">MEM: {hwStats.mem}GB / 4.0GB</div>
                    </div>
                  </div>

                  <div className="glass-card p-6 sm:p-8 bg-[var(--card-bg)] border-[var(--line)]">
                    <h3 className="text-lg sm:text-xl font-bold mb-6">实时任务调度</h3>
                    <div className="space-y-4">
                      {[
                        { name: 'ControlLoop_1kHz', priority: 99, cpu: 8.2, status: 'Running' },
                        { name: 'EtherCAT_Master', priority: 98, cpu: 4.5, status: 'Running' },
                        { name: 'SafetyMonitor', priority: 95, cpu: 1.2, status: 'Running' },
                        { name: 'TelemetrySync', priority: 50, cpu: 2.1, status: 'Running' },
                      ].map(task => (
                        <div key={task.name} className="flex items-center justify-between p-4 bg-[var(--muted)] border border-[var(--line)] rounded-xl">
                          <div className="flex items-center gap-4">
                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                            <div>
                              <div className="text-sm font-bold">{task.name}</div>
                              <div className="text-[10px] opacity-50">PRIORITY: {task.priority}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono">{task.cpu}% CPU</div>
                            <div className="text-[10px] text-emerald-400 font-bold uppercase">{task.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'io' && (
                <motion.div 
                  key="io"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 sm:space-y-8"
                >
                  <div className="glass-card p-6 sm:p-8 bg-[var(--card-bg)] border-[var(--line)]">
                    <div className="flex justify-between items-center mb-8">
                      <h3 className="text-lg sm:text-xl font-bold">总线配置 (EtherCAT)</h3>
                      <button className="text-xs font-bold text-purple-400 hover:underline">扫描总线</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                      {[
                        { id: 1, name: 'Joint_1_Drive', type: 'Servo', status: 'Online' },
                        { id: 2, name: 'Joint_2_Drive', type: 'Servo', status: 'Online' },
                        { id: 3, name: 'Joint_3_Drive', type: 'Servo', status: 'Online' },
                        { id: 4, name: 'End_Effector_IO', type: 'Digital I/O', status: 'Online' },
                      ].map(device => (
                        <div key={device.id} className="p-4 border border-[var(--line)] rounded-xl bg-[var(--muted)] flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-[var(--bg-main)] rounded-lg flex items-center justify-center text-purple-400">
                              <Cpu size={20} />
                            </div>
                            <div>
                              <div className="text-sm font-bold">{device.name}</div>
                              <div className="text-[10px] opacity-50">TYPE: {device.type} | ID: {device.id}</div>
                            </div>
                          </div>
                          <div className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                            {device.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'deploy' && (
                <motion.div 
                  key="deploy"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 sm:space-y-8"
                >
                  <div className="glass-card p-8 sm:p-12 text-center bg-[var(--card-bg)] border-[var(--line)]">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-purple-500/20 text-purple-400 rounded-3xl flex items-center justify-center mx-auto mb-6 sm:mb-8">
                      <Download size={32} />
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold mb-4">部署控制逻辑</h3>
                    <p className="opacity-60 max-w-md mx-auto mb-8 sm:mb-10 text-sm sm:text-base">
                      将当前 Studio 设计的工程配置与 Net 训练的模型部署到 LoongBox 硬件中。
                    </p>

                    {isDeploying ? (
                      <div className="max-w-md mx-auto">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="opacity-60">{deployStatus}</span>
                          <span className="font-bold">{deployProgress}%</span>
                        </div>
                        <div className="h-2 bg-[var(--muted)] rounded-full overflow-hidden mb-8">
                          <motion.div 
                            className="h-full bg-purple-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${deployProgress}%` }}
                            transition={{ duration: 0.1 }}
                          />
                        </div>
                        
                        {/* Granular steps visualization */}
                        <div className="grid grid-cols-4 gap-2 mt-4">
                          {[
                            { step: 1, label: 'Compile', threshold: 0 },
                            { step: 2, label: 'Upload', threshold: 30 },
                            { step: 3, label: 'Verify', threshold: 70 },
                            { step: 4, label: 'Restart', threshold: 90 }
                          ].map((s) => (
                            <div key={s.step} className="flex flex-col items-center gap-2">
                              <div className={`w-full h-1 rounded-full ${deployProgress >= s.threshold ? 'bg-purple-500' : 'bg-[var(--muted)]'}`} />
                              <span className={`text-[10px] font-bold uppercase ${deployProgress >= s.threshold ? 'text-purple-400' : 'opacity-40'}`}>
                                {s.label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : deployProgress === 100 ? (
                      <div className="max-w-md mx-auto flex flex-col items-center">
                        <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mb-4">
                          <CheckCircle2 size={32} />
                        </div>
                        <h4 className="text-xl font-bold text-emerald-400 mb-2">部署成功</h4>
                        <p className="text-sm opacity-60 mb-8">控制逻辑已成功部署并运行在 LoongBox 硬件上。</p>
                        <button 
                          onClick={handleDeploy}
                          className="bg-[var(--muted)] text-[var(--text-main)] px-8 py-3 rounded-xl font-bold hover:bg-[var(--line)] transition-all flex items-center gap-2 border border-[var(--line)]"
                        >
                          <Play size={16} />
                          重新部署
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={handleDeploy}
                        className="bg-purple-500 text-white px-8 sm:px-10 py-3 sm:py-4 rounded-2xl font-bold text-base sm:text-lg hover:bg-purple-400 transition-all hover:scale-105 flex items-center gap-3 mx-auto"
                      >
                        <Play size={20} />
                        立即部署到硬件
                      </button>
                    )}
                  </div>

                  <div className="glass-card overflow-hidden bg-[var(--card-bg)] border-[var(--line)]">
                    <div className="bg-[var(--muted)] px-6 py-3 border-b border-[var(--line)] flex items-center gap-2">
                      <Terminal size={14} className="opacity-60" />
                      <span className="text-xs font-mono opacity-60 uppercase tracking-widest">Deployment Console</span>
                    </div>
                    <div className="p-6 h-48 overflow-y-auto font-mono text-xs space-y-2 bg-[var(--bg-main)]/40">
                      {logs.map((log, i) => (
                        <div key={i} className={log.includes('[DEPLOY]') ? 'text-purple-400' : log.includes('[SYSTEM]') ? 'text-amber-400' : 'opacity-70'}>
                          {log}
                        </div>
                      ))}
                      {isDeploying && <div className="text-purple-400 animate-pulse">_</div>}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
};
