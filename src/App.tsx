import { useEffect, useState } from 'react';
import CommandCenter from './CommandCenter';
import { daemon } from './lib/daemon';
import { logger, LogEntry, LogEvent } from './lib/logger';
import {
  Shield,
  Cpu,
  TrendingUp,
  Zap,
  Play,
  Pause,
  RotateCw,
  CheckCircle2,
  XCircle,
  Bug,
  Gauge,
} from 'lucide-react';
import { cn } from './utils/cn';

type TickStatus = { symbol: string; status: string; reason?: string; at: number };

function App() {
  const [watchlist, setWatchlist] = useState<string[]>(daemon.getWatchlist());
  const [logs, setLogs] = useState<LogEntry[]>(logger.getHistory(200));
  const [ticks, setTicks] = useState<TickStatus[]>([]);
  const [signalCount, setSignalCount] = useState(daemon.getSignals().length);
  const [healCount, setHealCount] = useState(0);
  const [tickCount, setTickCount] = useState(daemon.stats.tickCount);
  const [, forceRender] = useState(0);

  useEffect(() => {
    daemon.start();
    const unsub = logger.subscribe((event: LogEvent) => {
      if (event.type === 'log') {
        setLogs((prev) => [...prev.slice(-199), event.entry]);
      } else if (event.type === 'watchlist') {
        setWatchlist(event.symbols);
      } else if (event.type === 'signal') {
        setSignalCount((n) => n + 1);
      } else if (event.type === 'heal') {
        setHealCount((n) => n + 1);
      } else if (event.type === 'tick') {
        setTicks((prev) => [
          ...prev.filter((t) => t.symbol !== event.symbol).slice(-20),
          { symbol: event.symbol, status: event.status, reason: event.reason, at: Date.now() },
        ]);
        setTickCount(daemon.stats.tickCount);
      }
    });

    // Refresh daemon stats every second for uptime + tick display.
    const interval = setInterval(() => forceRender((x) => x + 1), 1000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, []);

  const uptime = Math.max(0, Math.floor((Date.now() - daemon.stats.startedAt) / 1000));
  const uptimeStr = `${Math.floor(uptime / 60)}m ${uptime % 60}s`;

  const handleManualTick = () => {
    void daemon.tick();
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-sans selection:bg-emerald-500/30">
      {/* Background Grid Decoration */}
      <div className="fixed inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none" />
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* Main Dashboard UI */}
      <div className="relative max-w-7xl mx-auto px-6 py-12">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 border-b border-slate-900 pb-8">
          <div>
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-500 tracking-tight">
              HYDRA OS v1.0
            </h1>
            <p className="mt-2 text-slate-500 font-mono text-sm uppercase tracking-[0.2em]">
              Autonomous Local Quant · Self-Healing Firm
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Network</span>
              <span className="text-emerald-500 font-mono text-sm">LOCAL_OFF_GRID</span>
            </div>
            <div className="h-10 w-px bg-slate-800" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Uptime</span>
              <span className="text-cyan-400 font-mono text-sm">{uptimeStr}</span>
            </div>
            <div className="h-10 w-px bg-slate-800" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">Ticks</span>
              <span className="text-amber-400 font-mono text-sm">{tickCount}</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Watchlist + Tick Status */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" /> Watchlist
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleManualTick}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 hover:border-emerald-500/50 transition-colors"
                  title="Force tick"
                >
                  <RotateCw className="w-3.5 h-3.5 text-emerald-500" />
                </button>
                <div className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-500 font-bold">
                  LIVE
                </div>
              </div>
            </div>
            <div className="space-y-3">
              {watchlist.map((coin) => {
                const lastTick = ticks.find((t) => t.symbol === coin);
                return (
                  <div
                    key={coin}
                    className="flex items-center justify-between py-2 border-b border-slate-900/50 last:border-0"
                  >
                    <span className="font-mono text-sm text-slate-300">{coin}</span>
                    <div className="text-right">
                      {lastTick ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          {lastTick.status === 'approved' && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                          {lastTick.status === 'rejected' && (
                            <XCircle className="w-3.5 h-3.5 text-amber-500" />
                          )}
                          {lastTick.status === 'error' && (
                            <Bug className="w-3.5 h-3.5 text-rose-500" />
                          )}
                          {(lastTick.status === 'scanning' || lastTick.status === 'cooldown') && (
                            <Gauge className="w-3.5 h-3.5 text-slate-500" />
                          )}
                          <span
                            className={cn(
                              'font-mono text-xs uppercase',
                              lastTick.status === 'approved' && 'text-emerald-400',
                              lastTick.status === 'rejected' && 'text-amber-400',
                              lastTick.status === 'error' && 'text-rose-400',
                              lastTick.status === 'cooldown' && 'text-slate-500',
                              lastTick.status === 'scanning' && 'text-cyan-400'
                            )}
                          >
                            {lastTick.status}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-600 font-mono text-xs">IDLE</span>
                      )}
                      {lastTick?.reason && (
                        <div className="text-[9px] text-slate-600 max-w-[180px] truncate">
                          {lastTick.reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agent Heartbeat */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-500" /> Agent Heartbeat
            </h3>
            <div className="space-y-4">
              {[
                { name: 'Quant Analyst', status: 'Optimal', load: '12%', color: 'bg-emerald-500' },
                { name: 'Risk Officer (CRO)', status: 'Vigilant', load: '6%', color: 'bg-amber-500' },
                { name: 'DevOps Sentinel', status: 'Ready', load: '2%', color: 'bg-rose-500' },
              ].map((agent) => (
                <div
                  key={agent.name}
                  className="p-3 bg-slate-900/50 border border-slate-800/50 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400">{agent.name}</span>
                    <span className="text-[10px] text-emerald-500 font-mono">{agent.status}</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                    <div className={cn('h-full', agent.color)} style={{ width: agent.load }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase font-mono tracking-widest">
                Daemon Control
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => daemon.setFastMode(true)}
                  className="px-2 py-1 text-[10px] font-mono rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                  <Zap className="w-3 h-3 inline mr-1" />
                  30s
                </button>
                <button
                  onClick={() => daemon.setFastMode(false)}
                  className="px-2 py-1 text-[10px] font-mono rounded bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700 transition-colors"
                >
                  15m
                </button>
              </div>
            </div>
          </div>

          {/* Stats Card */}
          <div className="bg-slate-950/50 border border-slate-900 rounded-2xl p-6 backdrop-blur-sm shadow-[0_0_50px_rgba(0,0,0,0.5)]">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6 flex items-center gap-2">
              <Shield className="w-4 h-4 text-rose-500" /> Session Stats
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Approved" value={daemon.stats.approvedSignals} color="text-emerald-400" />
              <Stat label="Rejected" value={daemon.stats.rejectedSignals} color="text-amber-400" />
              <Stat label="Self-Healed" value={healCount} color="text-cyan-400" />
              <Stat label="Signals" value={signalCount} color="text-white" />
            </div>
            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                <Play className="w-3 h-3 text-emerald-500" /> Daemon Running
              </div>
              <button
                onClick={() => daemon.stop()}
                className="text-[10px] font-mono px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition-colors"
              >
                <Pause className="w-3 h-3 inline mr-1" />
                Stop
              </button>
            </div>
          </div>
        </div>

        {/* Live Console */}
        <div className="mt-12 bg-black border border-slate-900 rounded-xl overflow-hidden shadow-2xl">
          <div className="px-4 py-2 border-b border-slate-900 bg-slate-950 flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-rose-500/50" />
              <div className="w-2 h-2 rounded-full bg-amber-500/50" />
              <div className="w-2 h-2 rounded-full bg-emerald-500/50" />
            </div>
            <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest ml-2">
              System Console · {logs.length} entries
            </span>
            <button
              onClick={() => logger.clear()}
              className="ml-auto text-[10px] text-slate-600 hover:text-slate-400 font-mono uppercase"
            >
              Clear
            </button>
          </div>
          <div className="p-4 h-56 overflow-y-auto font-mono text-[11px] text-slate-500 space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-emerald-500/70 animate-pulse">Awaiting daemon events...</div>
            ) : (
              logs.slice(-80).map((l) => (
                <div
                  key={l.id}
                  className={cn(
                    'flex gap-2 items-start',
                    l.level === 'error' && 'text-rose-400',
                    l.level === 'warn' && 'text-amber-400',
                    l.level === 'success' && 'text-emerald-400',
                    l.level === 'info' && 'text-slate-400',
                    l.level === 'debug' && 'text-slate-600'
                  )}
                >
                  <span className="text-slate-700 shrink-0">
                    {new Date(l.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-slate-700 shrink-0 w-16">[{l.source}]</span>
                  <span className="break-all">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <footer className="mt-8 text-center text-[10px] text-slate-700 font-mono uppercase tracking-widest">
          100% LOCAL · Zero external APIs · Ollama + pgvector + Drizzle
        </footer>
      </div>

      <CommandCenter />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg">
      <div className="text-[10px] text-slate-600 uppercase tracking-widest font-mono">{label}</div>
      <div className={cn('text-2xl font-mono font-bold mt-1', color)}>{value}</div>
    </div>
  );
}

export default App;
