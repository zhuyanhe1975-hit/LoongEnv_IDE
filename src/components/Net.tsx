import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  ArrowLeft, 
  Brain, 
  Cpu, 
  Activity, 
  Settings2, 
  Play, 
  Pause, 
  RotateCcw,
  BarChart3,
  Network,
  ShieldAlert,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

interface NetProps {
  onBack: () => void;
}

export const Net: React.FC<NetProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'compensation' | 'training' | 'inference'>('compensation');
  const [isTraining, setIsTraining] = useState(false);
  const [rewardHistory, setRewardHistory] = useState<{ step: number; reward: number }[]>([]);
  const [inferenceStats, setInferenceStats] = useState({
    latency: 1.2,
    frequency: 1000,
    cpuUsage: 15,
    memory: 256
  });

  // Mock training data generation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTraining) {
      interval = setInterval(() => {
        setRewardHistory(prev => {
          const nextStep = prev.length;
          const noise = (Math.random() - 0.5) * 2;
          const trend = Math.log(nextStep + 1) * 10;
          const newReward = trend + noise;
          return [...prev.slice(-49), { step: nextStep, reward: newReward }];
        });

        setInferenceStats(prev => ({
          ...prev,
          latency: 1.1 + Math.random() * 0.2,
          cpuUsage: 20 + Math.random() * 10
        }));
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isTraining]);

  return (
    <div className="min-h-screen bg-loong-dark text-main font-sans transition-colors duration-300">
      {/* Header */}
      <header className="border-b border-white/10 bg-[var(--nav-bg)] backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-muted hover:text-loong-accent"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center font-bold text-white">
                <Zap size={18} />
              </div>
              <h1 className="font-display font-bold text-xl tracking-tight">LoongEnv-Net</h1>
              <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20">
                Control Engine
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <div className={`w-2 h-2 rounded-full ${isTraining ? 'bg-amber-500 animate-pulse' : 'bg-muted'}`} />
              <span className="text-xs font-mono text-muted">
                {isTraining ? 'TRAINING_ACTIVE' : 'ENGINE_IDLE'}
              </span>
            </div>
            <button 
              onClick={() => setIsTraining(!isTraining)}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl font-bold text-sm transition-all shadow-lg ${
                isTraining 
                  ? 'bg-rose-500 text-white shadow-rose-500/20' 
                  : 'bg-amber-500 text-white shadow-amber-500/20 hover:bg-amber-600'
              }`}
            >
              {isTraining ? <Pause size={16} /> : <Play size={16} />}
              {isTraining ? '停止训练' : '开始训练'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-12">
        <div className="grid grid-cols-12 gap-10">
          {/* Left Sidebar - Navigation */}
          <div className="col-span-12 lg:col-span-3 space-y-6">
            <div className="glass-card p-2">
              {[
                { id: 'compensation', label: '模型补偿', icon: Brain },
                { id: 'training', label: '强化学习', icon: Network },
                { id: 'inference', label: '推理引擎', icon: Cpu },
              ].map((tab) => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl transition-all ${
                    activeTab === tab.id 
                      ? 'bg-amber-500 text-white font-bold shadow-lg shadow-amber-500/20' 
                      : 'hover:bg-white/5 text-muted hover:text-main'
                  }`}
                >
                  <tab.icon size={20} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            <div className="glass-card p-8">
              <h3 className="text-sm font-bold mb-6 flex items-center gap-2 text-muted uppercase tracking-wider">
                <Settings2 size={16} className="text-amber-500" />
                全局参数
              </h3>
              <div className="space-y-8">
                <div>
                  <div className="flex justify-between text-xs mb-3">
                    <span className="text-muted">AI 混合权重</span>
                    <span className="text-amber-500 font-bold">0.65</span>
                  </div>
                  <input type="range" className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500" defaultValue="65" />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-3">
                    <span className="text-muted">学习率</span>
                    <span className="text-amber-500 font-bold">3e-4</span>
                  </div>
                  <input type="range" className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500" defaultValue="30" />
                </div>
                <div className="pt-6 border-t border-white/10">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="w-10 h-5 bg-white/10 rounded-full relative transition-colors group-hover:bg-white/20">
                      <div className="absolute top-1 left-1 w-3 h-3 bg-amber-500 rounded-full" />
                    </div>
                    <span className="text-xs font-medium text-muted group-hover:text-main transition-colors">启用安全边界</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="col-span-12 lg:col-span-9 space-y-10">
            <AnimatePresence mode="wait">
              {activeTab === 'compensation' && (
                <motion.div 
                  key="compensation"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-10"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                      { label: '重力补偿', value: '98.2%', status: 'Active' },
                      { label: '摩擦力补偿', value: '85.4%', status: 'Active' },
                      { label: '科氏力补偿', value: '92.1%', status: 'Active' },
                    ].map((item) => (
                      <div key={item.label} className="glass-card p-8 border-l-4 border-amber-500">
                        <div className="text-xs font-mono text-muted mb-2 uppercase tracking-wider">{item.label}</div>
                        <div className="text-3xl font-display font-bold text-main">{item.value}</div>
                        <div className="mt-3 text-[10px] text-emerald-500 flex items-center gap-2 font-bold">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {item.status}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="glass-card p-10">
                    <h3 className="text-2xl font-display font-bold mb-8">补偿网络实时输出</h3>
                    <div className="h-[350px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={rewardHistory.length > 0 ? rewardHistory : Array.from({length: 20}, (_, i) => ({step: i, reward: Math.sin(i/2) * 5 + 10}))}>
                          <defs>
                            <linearGradient id="colorComp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#fbbf24" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="step" hide />
                          <YAxis hide domain={['auto', 'auto']} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'var(--nav-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(10px)' }}
                            itemStyle={{ color: '#fbbf24' }}
                          />
                          <Area type="monotone" dataKey="reward" stroke="#fbbf24" strokeWidth={3} fillOpacity={1} fill="url(#colorComp)" isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'training' && (
                <motion.div 
                  key="training"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-10"
                >
                  <div className="glass-card p-10">
                    <div className="flex items-center justify-between mb-10">
                      <div>
                        <h3 className="text-3xl font-display font-bold mb-2">强化学习训练曲线</h3>
                        <p className="text-muted text-base">PPO 算法收敛情况监控与实时反馈</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">当前奖励值</div>
                        <div className="text-4xl font-mono font-bold text-amber-500">
                          {rewardHistory.length > 0 ? rewardHistory[rewardHistory.length - 1].reward.toFixed(2) : '0.00'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="h-[450px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={rewardHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="step" stroke="rgba(255,255,255,0.2)" fontSize={12} />
                          <YAxis stroke="rgba(255,255,255,0.2)" fontSize={12} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: 'var(--nav-bg)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(10px)' }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="reward" 
                            stroke="#fbbf24" 
                            strokeWidth={3} 
                            dot={false}
                            animationDuration={300}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="glass-card p-8">
                      <h4 className="text-lg font-bold mb-6 flex items-center gap-2">
                        <Settings2 size={20} className="text-amber-500" /> 训练超参数
                      </h4>
                      <div className="space-y-4">
                        {[
                          { label: 'Batch Size', value: '256' },
                          { label: 'Gamma', value: '0.99' },
                          { label: 'Clip Range', value: '0.2' },
                          { label: 'Entropy Coeff', value: '0.01' },
                        ].map(p => (
                          <div key={p.label} className="flex justify-between items-center py-3 border-b border-white/5">
                            <span className="text-sm text-muted">{p.label}</span>
                            <span className="text-base font-mono font-bold text-main">{p.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="glass-card p-8">
                      <h4 className="text-lg font-bold mb-6 flex items-center gap-2">
                        <Activity size={20} className="text-emerald-500" /> 环境状态
                      </h4>
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted">Episode Count</span>
                          <span className="text-base font-mono font-bold text-main">1,242</span>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted">Success Rate</span>
                            <span className="text-sm font-mono font-bold text-emerald-500">78%</span>
                          </div>
                          <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500" style={{ width: '78%' }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'inference' && (
                <motion.div 
                  key="inference"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-10"
                >
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[
                      { label: '推理延迟', value: `${inferenceStats.latency.toFixed(2)} ms`, icon: Activity, color: 'text-amber-500' },
                      { label: '控制频率', value: `${inferenceStats.frequency} Hz`, icon: Zap, color: 'text-emerald-500' },
                      { label: 'CPU 占用', value: `${inferenceStats.cpuUsage.toFixed(1)}%`, icon: Cpu, color: 'text-blue-500' },
                      { label: '内存占用', value: `${inferenceStats.memory} MB`, icon: Database, color: 'text-purple-500' },
                    ].map((stat) => (
                      <div key={stat.label} className="glass-card p-8 flex flex-col items-center text-center">
                        <div className={`w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-6 ${stat.color}`}>
                          <stat.icon size={24} />
                        </div>
                        <div className="text-xs text-muted font-bold uppercase tracking-wider mb-2">{stat.label}</div>
                        <div className="text-2xl font-mono font-bold text-main">{stat.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="glass-card p-10">
                    <div className="flex items-center gap-4 mb-10">
                      <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                        <ShieldAlert className="text-rose-500" size={28} />
                      </div>
                      <h3 className="text-2xl font-display font-bold">安全监控与回退机制</h3>
                    </div>
                    <div className="space-y-10">
                      <div className="p-8 bg-rose-500/5 border border-rose-500/20 rounded-2xl">
                        <div className="flex justify-between items-start mb-4">
                          <div className="font-bold text-lg text-rose-500">异常检测状态</div>
                          <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-bold border border-emerald-500/20">NORMAL</span>
                        </div>
                        <p className="text-base text-muted leading-relaxed">
                          当前神经网络输出在安全包络线内。如果输出偏离超过 15%，系统将自动切换到传统 PID 模式，确保硬件安全。
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        <div>
                          <h4 className="text-lg font-bold mb-6 flex items-center gap-2">
                            <Settings2 size={20} className="text-amber-500" /> 回退触发条件
                          </h4>
                          <div className="space-y-4">
                            {['延迟 > 5ms', '输出突变 > 20%', '模型不确定性 > 0.8', '硬件看门狗超时'].map(cond => (
                              <div key={cond} className="flex items-center gap-4 text-base text-muted">
                                <div className="w-2 h-2 rounded-full bg-amber-500" />
                                {cond}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-center p-12 border border-white/5 rounded-2xl bg-white/2 relative overflow-hidden">
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(16,185,129,0.05),transparent_70%)]"></div>
                          <div className="text-center relative z-10">
                            <div className="w-20 h-20 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin mx-auto mb-6" />
                            <div className="text-sm font-bold text-emerald-500 uppercase tracking-widest">实时安全验证中...</div>
                          </div>
                        </div>
                      </div>
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
