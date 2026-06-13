import { useState, useEffect, useRef, type FC } from 'react';
import {
  Terminal, Shield, Zap, Activity, Bug, Send, X, Maximize2, Minimize2,
  Plus, Trash2, Cpu, CheckCircle2, AlertTriangle, CircleDot,
} from 'lucide-react';
import { cn } from './utils/cn';
import { hydra, AgentResponse } from './lib/hydraEngine';
import { DevOpsAgent, DevOpsDiagnosis } from './lib/devOpsAgent';
import { fetchPrice } from './lib/binance';
import { logger, LogEntry, LogEvent } from './lib/logger';
import { daemon, PersistedSignal } from './lib/daemon';
import { getEmbedding, searchKnowledge } from './lib/knowledgeEngine'; // ✅ RAG – সঠিক পাথ

// ─── Groq API ──────────────────────────────────────────
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

async function askGroq(question: string, context: string = ''): Promise<string> {
  const systemPrompt = `You are TradeJarvis Hydra, an autonomous trading AI assistant.
RULES:
1. Answer trading questions with clear analysis.
2. When you detect a clear trading opportunity, output ONLY a JSON action block:
   {"action":"buy","symbol":"BTCUSDT","entry":67000,"sl":66500,"tp1":68000,"tp2":69000,"tp3":70000,"confidence":85,"reasoning":"RSI divergence + MACD crossover"}
   For sell: {"action":"sell",...}
   For alerts: {"action":"alert","message":"BTC breaking resistance"}
3. Only output JSON when confident (>60%).
4. Otherwise respond conversationally with analysis.`;

  const userMessage = context ? `Context: ${context}\n\nUser: ${question}` : question;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.7,
    }),
  });
  if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

type ChatMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
  type?: 'trade' | 'devops' | 'system';
  diagnosis?: DevOpsDiagnosis;
};

const CommandCenter: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [tab, setTab] = useState<'chat' | 'signals' | 'logs'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      type: 'system',
      content:
        'Hydra System Online. Ask me anything about trading, or use commands: "Analyze SOLUSDT" • "Diagnose last crash" • "Show heal report"',
    },
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>(logger.getHistory(80));
  const [signals, setSignals] = useState<PersistedSignal[]>(daemon.getSignals());
  const [watchlist, setWatchlist] = useState<string[]>(daemon.getWatchlist());
  const [healEvents, setHealEvents] = useState<
    Array<{ errorId: string; diagnosis: string; code?: string }>
  >([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  /** Subscribe to all daemon/logger events. */
  useEffect(() => {
    const unsub = logger.subscribe((event: LogEvent) => {
      if (event.type === 'log') {
        setLiveLogs((prev) => [...prev.slice(-199), event.entry]);
      } else if (event.type === 'signal') {
        setSignals(daemon.getSignals());
      } else if (event.type === 'watchlist') {
        setWatchlist(event.symbols);
      } else if (event.type === 'heal') {
        setHealEvents((prev) => [
          ...prev.slice(-9),
          {
            errorId: event.errorId,
            diagnosis: event.diagnosis,
            code: event.correctedCode,
          },
        ]);
      }
    });
    return unsub;
  }, []);

  const pushMsg = (msg: Omit<ChatMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...msg, id: `m_${Date.now()}_${Math.random()}` }]);
  };

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;
    const userMsg = input.trim();
    setInput('');
    pushMsg({ role: 'user', content: userMsg });
    setIsProcessing(true);

    try {
      const lower = userMsg.toLowerCase();

      if (lower.startsWith('analyze')) {
        const symbol = userMsg.split(' ').pop()?.toUpperCase() ?? 'BTCUSDT';
        pushMsg({
          role: 'agent',
          type: 'system',
          content: `Routing ${symbol} through Quant Analyst → CRO → Vector Memory…`,
        });
        const price = await fetchPrice(symbol).catch(() => null);
        const decision: AgentResponse = await hydra.runAnalysis(symbol);
        const entry = decision.entry ?? price ?? 0;
        const sl = decision.sl ?? (decision.action === 'BUY' ? entry * 0.99 : entry * 1.01);
        const tp = decision.tp ?? (decision.action === 'BUY' ? entry * 1.03 : entry * 0.97);

        pushMsg({
          role: 'agent',
          type: 'trade',
          content: [
            `🎯 ${symbol} — ${decision.action}`,
            `Entry: ${entry.toFixed(2)}   SL: ${sl.toFixed(2)}   TP: ${tp.toFixed(2)}`,
            `R/R: ${decision.riskReward.toFixed(2)}`,
            ``,
            decision.reasoning,
          ].join('\n'),
        });
      } else if (lower.startsWith('diagnose')) {
        pushMsg({
          role: 'agent',
          type: 'system',
          content: 'DevOps Agent scanning recent errors…',
        });
        const diagnoses = await DevOpsAgent.diagnoseRecent(3);
        const d = diagnoses[0];
        pushMsg({
          role: 'agent',
          type: 'devops',
          content: [
            `🩹 Diagnosis`,
            `Root Cause: ${d.rootCause}`,
            `Severity: ${d.severity.toUpperCase()}  ·  Confidence: ${(d.confidence * 100).toFixed(0)}%`,
            ``,
            'Action Plan:',
            ...d.actionPlan.map((s, i) => `  ${i + 1}. ${s}`),
            d.correctedCode ? `\nCorrected Code:\n\`\`\`\n${d.correctedCode}\n\`\`\`` : '',
          ].join('\n'),
          diagnosis: d,
        });
      } else if (lower.includes('heal')) {
        if (healEvents.length === 0) {
          pushMsg({ role: 'agent', type: 'system', content: 'No self-healing events recorded yet.' });
        } else {
          pushMsg({
            role: 'agent',
            type: 'devops',
            content: healEvents
              .map(
                (h, i) =>
                  `${i + 1}. ${h.errorId}\n   → ${h.diagnosis}${h.code ? `\n   CODE: ${h.code.slice(0, 120)}…` : ''}`
              )
              .join('\n\n'),
          });
        }
      } else {
        // ⭐ General chat → Groq API with RAG & live prices
        const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        const prices: Record<string, number> = {};
        for (const sym of symbols) {
          try { prices[sym] = await fetchPrice(sym); } catch {}
        }
        const priceContext = Object.entries(prices)
          .map(([s, p]) => `${s.replace('USDT','')}: $${p?.toFixed(2)}`)
          .join(', ');

        // RAG: জ্ঞানভাণ্ডার থেকে প্রাসঙ্গিক তথ্য আনা
        let knowledgeContext = '';
        try {
          const emb = await getEmbedding(userMsg);
          const docs = await searchKnowledge(emb, 3);
          knowledgeContext = docs.map((d: any) => d.content).join('\n---\n');
        } catch (err) {
          console.warn('RAG failed, continuing without knowledge:', err);
        }

        const fullContext = `Current prices: ${priceContext || 'N/A'}\nRelevant knowledge:\n${knowledgeContext || 'None'}`;
        const answer = await askGroq(userMsg, fullContext);
        pushMsg({ role: 'agent', type: 'system', content: answer });
      }
    } catch (err) {
      pushMsg({
        role: 'agent',
        type: 'system',
        content: `⚠️ Error: ${(err as Error).message}. Is the API key correct?`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const addWatchlist = () => {
    const symbol = prompt('Add pair to watchlist (e.g. XRPUSDT):')?.trim();
    if (symbol) daemon.addToWatchlist(symbol);
  };

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 transition-all duration-300 ease-in-out flex flex-col',
        isOpen
          ? isExpanded
            ? 'w-[900px] h-[640px]'
            : 'w-[420px] h-[560px]'
          : 'w-16 h-16'
      )}
    >
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full h-full bg-slate-900 border-2 border-emerald-500 rounded-full flex items-center justify-center text-emerald-500 hover:scale-110 transition-transform shadow-[0_0_20px_rgba(16,185,129,0.4)]"
        >
          <Activity className="w-8 h-8" />
        </button>
      ) : (
        <div className="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-widest">
                Hydra Command Center
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-slate-500 hover:text-white transition-colors"
              >
                {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-500 hover:text-rose-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-800 bg-slate-950">
            {(['chat', 'signals', 'logs'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors',
                  tab === t
                    ? 'text-emerald-400 border-b-2 border-emerald-500'
                    : 'text-slate-600 hover:text-slate-400'
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
            {tab === 'chat' && (
              <div ref={scrollRef} className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex flex-col max-w-[90%]',
                      msg.role === 'user' ? 'ml-auto items-end' : 'items-start'
                    )}
                  >
                    <div
                      className={cn(
                        'px-3 py-2 rounded-lg text-xs font-mono whitespace-pre-wrap',
                        msg.role === 'user'
                          ? 'bg-emerald-600/20 border border-emerald-500/50 text-emerald-100'
                          : 'bg-slate-900 border border-slate-800 text-slate-300',
                        msg.type === 'trade' && 'border-amber-500/50 bg-amber-500/10',
                        msg.type === 'devops' && 'border-cyan-500/50 bg-cyan-500/10'
                      )}
                    >
                      {msg.content}
                    </div>
                    <span className="text-[10px] mt-1 text-slate-600 uppercase">
                      {msg.role === 'user'
                        ? 'Architect'
                        : msg.type === 'trade'
                          ? 'Quant + CRO'
                          : msg.type === 'devops'
                            ? 'DevOps Agent'
                            : 'System'}
                    </span>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex items-center gap-2 text-slate-500 text-xs font-mono animate-pulse">
                    <Zap className="w-3 h-3 fill-current" />
                    Hydra is thinking...
                  </div>
                )}
              </div>
            )}

            {tab === 'signals' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-slate-500 uppercase font-mono tracking-widest">
                    Watchlist ({watchlist.length})
                  </span>
                  <button
                    onClick={addWatchlist}
                    className="text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {watchlist.map((s) => (
                    <div
                      key={s}
                      className="flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded text-[10px] font-mono text-slate-300"
                    >
                      {s}
                      <button
                        onClick={() => daemon.removeFromWatchlist(s)}
                        className="text-slate-600 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-3 border-t border-slate-800 mt-3">
                  <span className="text-[10px] text-slate-500 uppercase font-mono tracking-widest">
                    Approved Signals ({signals.length})
                  </span>
                  {signals.length === 0 ? (
                    <div className="text-xs text-slate-600 font-mono mt-2">No approved signals yet.</div>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {signals.slice(0, 10).map((s) => (
                        <div
                          key={s.id}
                          className="p-2 bg-slate-900/50 border border-slate-800 rounded"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CircleDot
                                className={cn(
                                  'w-3 h-3',
                                  s.action === 'BUY' ? 'text-emerald-500' : 'text-rose-500'
                                )}
                              />
                              <span className="font-mono text-xs text-slate-300">{s.symbol}</span>
                            </div>
                            <span
                              className={cn(
                                'text-[10px] font-mono font-bold',
                                s.action === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                              )}
                            >
                              {s.action}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono mt-1">
                            {s.entry.toFixed(2)} → TP {s.tp.toFixed(2)} / SL {s.sl.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'logs' && (
              <div className="font-mono text-[10px] space-y-1">
                {liveLogs.length === 0 ? (
                  <div className="text-slate-600">No logs yet.</div>
                ) : (
                  liveLogs
                    .slice()
                    .reverse()
                    .map((l) => (
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
                        <span className="text-slate-600 shrink-0">
                          {new Date(l.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-slate-600 shrink-0 w-12">[{l.source}]</span>
                        <span className="break-all">{l.message}</span>
                      </div>
                    ))
                )}
              </div>
            )}
          </div>

          {/* Input (chat tab only) */}
          {tab === 'chat' && (
            <div className="p-3 border-t border-slate-800 bg-slate-900/50">
              <div className="relative">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Ask Jarvis anything..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-3 pr-10 text-sm font-mono text-emerald-500 focus:outline-none focus:border-emerald-500/50 placeholder:text-slate-700"
                />
                <button
                  onClick={handleSend}
                  disabled={isProcessing}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-emerald-500 transition-colors disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-600 uppercase font-mono tracking-tighter">
                <div className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-emerald-500" /> CRO Active
                </div>
                <div className="flex items-center gap-1">
                  <Terminal className="w-3 h-3 text-cyan-500" /> Vector DB Ready
                </div>
                <div className="flex items-center gap-1">
                  <Bug className="w-3 h-3 text-rose-500" /> DevOps: ON
                </div>
                <div className="flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-amber-500" /> Groq 70B
                </div>
                {healEvents.length > 0 && (
                  <div className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="w-3 h-3" /> {healEvents.length} healed
                  </div>
                )}
                {signals.length > 0 && (
                  <div className="flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 className="w-3 h-3" /> {signals.length} signals
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CommandCenter;
