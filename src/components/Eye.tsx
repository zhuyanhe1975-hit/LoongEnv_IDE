import React, { useState, useEffect } from 'react';
import { 
  Eye as EyeIcon, 
  ArrowLeft, 
  Video, 
  ShieldAlert, 
  History, 
  BarChart3, 
  Camera, 
  Circle, 
  AlertCircle,
  Clock,
  Zap,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface EyeProps {
  onBack: () => void;
}

export const Eye: React.FC<EyeProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'monitor' | 'analytics' | 'history'>('monitor');
  const [isRecording, setIsRecording] = useState(false);
  const [alerts, setAlerts] = useState([
    { id: 1, type: 'warning', msg: 'Joint 3 torque approaching limit', time: '14:20:05' },
    { id: 2, type: 'info', msg: 'Recording started', time: '14:15:22' },
  ]);

  const performanceData = [
    { name: 'Cycle 1', time: 4.2 },
    { name: 'Cycle 2', time: 4.1 },
    { name: 'Cycle 3', time: 4.5 },
    { name: 'Cycle 4', time: 4.0 },
    { name: 'Cycle 5', time: 4.3 },
    { name: 'Cycle 6', time: 4.1 },
  ];

  const statusDistribution = [
    { name: 'Success', value: 92, color: '#10b981' },
    { name: 'Warning', value: 5, color: '#f59e0b' },
    { name: 'Error', value: 3, color: '#ef4444' },
  ];

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
              <div className="w-8 h-8 bg-rose-400/20 text-rose-400 rounded flex items-center justify-center">
                <EyeIcon size={18} />
              </div>
              <h1 className="font-display font-bold text-lg sm:text-xl">LoongEnv-Eye</h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-rose-400/10 text-rose-400 text-[10px] font-bold uppercase tracking-wider">
                Safety & Analytics
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsRecording(!isRecording)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${
                isRecording 
                  ? 'bg-rose-500 text-white animate-pulse' 
                  : 'bg-[var(--muted)] border border-[var(--line)] text-[var(--text-main)] opacity-70 hover:opacity-100'
              }`}
            >
              <Circle size={12} fill={isRecording ? 'white' : 'transparent'} />
              {isRecording ? 'REC' : 'START REC'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
          {/* Main Content Area */}
          <div className="lg:col-span-8 space-y-6 sm:space-y-8">
            <AnimatePresence mode="wait">
              {activeTab === 'monitor' && (
                <motion.div 
                  key="monitor"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 sm:space-y-8"
                >
                  {/* Live Feed Placeholder */}
                  <div className="aspect-video glass-card relative overflow-hidden bg-black/60 group border-[var(--line)]">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <Camera size={48} className="text-slate-700 mx-auto mb-4" />
                        <div className="text-xs font-mono text-slate-600">LIVE_FEED_OFFLINE</div>
                      </div>
                    </div>
                    
                    {/* HUD Overlay */}
                    <div className="absolute top-4 sm:top-6 left-4 sm:left-6 flex flex-col gap-2">
                      <div className="px-3 py-1 rounded bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono flex items-center gap-2 text-white">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        CAM_01: ACTIVE
                      </div>
                      <div className="px-3 py-1 rounded bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono text-white">
                        FPS: 60 | LATENCY: 12ms
                      </div>
                    </div>

                    <div className="absolute bottom-4 sm:bottom-6 right-4 sm:right-6">
                      <div className="px-4 py-2 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-xs font-mono text-white">
                        2026-03-21 15:05:22
                      </div>
                    </div>

                    {/* Scanning Line Effect */}
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="w-full h-[1px] bg-emerald-500/20 absolute top-0 animate-scan" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
                    {[
                      { label: '平均节拍', value: '4.2s', icon: Clock, color: 'text-blue-400' },
                      { label: '能耗 (kWh)', value: '1.24', icon: Zap, color: 'text-amber-400' },
                      { label: '成功率', value: '98.5%', icon: CheckCircle2, color: 'text-emerald-400' },
                    ].map((stat) => (
                      <div key={stat.label} className="glass-card p-6 bg-[var(--card-bg)] border-[var(--line)]">
                        <stat.icon size={16} className={`${stat.color} mb-4`} />
                        <div className="text-xs opacity-50 mb-1">{stat.label}</div>
                        <div className="text-xl sm:text-2xl font-display font-bold">{stat.value}</div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {activeTab === 'analytics' && (
                <motion.div 
                  key="analytics"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 sm:space-y-8"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
                    <div className="glass-card p-6 sm:p-8 bg-[var(--card-bg)] border-[var(--line)]">
                      <h3 className="text-lg font-bold mb-6">节拍时间分析</h3>
                      <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={performanceData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.05} vertical={false} />
                            <XAxis dataKey="name" stroke="currentColor" opacity={0.2} fontSize={10} />
                            <YAxis stroke="currentColor" opacity={0.2} fontSize={10} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-main)' }}
                            />
                            <Bar dataKey="time" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="glass-card p-6 sm:p-8 bg-[var(--card-bg)] border-[var(--line)]">
                      <h3 className="text-lg font-bold mb-6">运行状态分布</h3>
                      <div className="h-[300px] flex flex-col sm:flex-row items-center gap-6">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={statusDistribution}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {statusDistribution.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--line)', borderRadius: '8px', color: 'var(--text-main)' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2 w-full sm:w-auto">
                          {statusDistribution.map(s => (
                            <div key={s.name} className="flex items-center gap-2 text-xs">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                              <span className="opacity-60">{s.name}</span>
                              <span className="font-bold">{s.value}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Sidebar - Alerts & Logs */}
          <div className="lg:col-span-4 space-y-6">
            <div className="glass-card p-2 flex bg-[var(--card-bg)] border-[var(--line)]">
              <button 
                onClick={() => setActiveTab('monitor')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${activeTab === 'monitor' ? 'bg-rose-500 text-white font-bold' : 'text-[var(--text-main)] opacity-60 hover:bg-[var(--muted)]'}`}
              >
                <Video size={16} />
                <span className="text-sm">监控</span>
              </button>
              <button 
                onClick={() => setActiveTab('analytics')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg transition-all ${activeTab === 'analytics' ? 'bg-rose-500 text-white font-bold' : 'text-[var(--text-main)] opacity-60 hover:bg-[var(--muted)]'}`}
              >
                <BarChart3 size={16} />
                <span className="text-sm">分析</span>
              </button>
            </div>

            <div className="glass-card flex flex-col h-[500px] sm:h-[600px] bg-[var(--card-bg)] border-[var(--line)]">
              <div className="p-6 border-b border-[var(--line)] flex items-center justify-between">
                <h3 className="font-bold flex items-center gap-2">
                  <ShieldAlert size={18} className="text-rose-400" />
                  安全警报
                </h3>
                <span className="px-2 py-0.5 rounded bg-rose-400/10 text-rose-400 text-[10px] font-bold">
                  {alerts.length} NEW
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {alerts.map(alert => (
                  <div key={alert.id} className={`p-4 rounded-xl border ${alert.type === 'warning' ? 'bg-amber-400/5 border-amber-400/20' : 'bg-blue-400/5 border-blue-400/20'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        {alert.type === 'warning' ? <AlertCircle size={14} className="text-amber-400" /> : <AlertCircle size={14} className="text-blue-400" />}
                        <span className={`text-[10px] font-bold uppercase ${alert.type === 'warning' ? 'text-amber-400' : 'text-blue-400'}`}>
                          {alert.type}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono opacity-40">{alert.time}</span>
                    </div>
                    <p className="text-xs opacity-70">{alert.msg}</p>
                  </div>
                ))}
              </div>

              <div className="p-4 border-t border-[var(--line)]">
                <button className="w-full py-2 rounded-lg bg-[var(--muted)] text-xs font-bold hover:bg-[var(--line)] transition-colors border border-[var(--line)]">
                  查看所有历史记录
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
