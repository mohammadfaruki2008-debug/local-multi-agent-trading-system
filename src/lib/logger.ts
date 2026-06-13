/**
 * Centralized Logger + EventEmitter for the Hydra system.
 *
 * Since the system runs in the browser, we simulate "stderr/stdout" by
 * capturing logs into an in-memory ring buffer and broadcasting them
 * to any UI subscribers. Errors are also persisted so the DevOps agent
 * can replay them during a self-healing pass.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

export type LogEntry = {
  id: string;
  timestamp: number;
  level: LogLevel;
  source: 'daemon' | 'engine' | 'devops' | 'ui' | 'network';
  message: string;
  stackTrace?: string;
  meta?: Record<string, unknown>;
};

export type LogEvent =
  | { type: 'log'; entry: LogEntry }
  | { type: 'signal'; symbol: string; action: 'BUY' | 'SELL'; entry: number; sl: number; tp: number; reasoning: string }
  | { type: 'tick'; symbol: string; status: 'scanning' | 'approved' | 'rejected' | 'cooldown' | 'error'; reason?: string }
  | { type: 'watchlist'; symbols: string[] }
  | { type: 'heal'; errorId: string; diagnosis: string; correctedCode?: string };

type Listener = (event: LogEvent) => void;

const RING_CAPACITY = 500;

class HydraLogger {
  private buffer: LogEntry[] = [];
  private listeners = new Set<Listener>();
  private idCounter = 0;

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: LogEvent) {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* swallow subscriber errors */
      }
    }
  }

  private nextId(): string {
    this.idCounter += 1;
    return `log_${this.idCounter}_${Date.now()}`;
  }

  public push(entry: Omit<LogEntry, 'id' | 'timestamp'>): LogEntry {
    const full: LogEntry = { ...entry, id: this.nextId(), timestamp: Date.now() };
    this.buffer.push(full);
    if (this.buffer.length > RING_CAPACITY) {
      this.buffer.shift();
    }
    this.emit({ type: 'log', entry: full });

    // Mirror to native console for dev ergonomics.
    const native =
      full.level === 'error'
        ? console.error
        : full.level === 'warn'
          ? console.warn
          : full.level === 'success'
            ? console.log
            : full.level === 'debug'
              ? console.debug
              : console.log;
    native(`[HYDRA/${full.source.toUpperCase()}] ${full.message}`);

    return full;
  }

  public info(source: LogEntry['source'], message: string, meta?: Record<string, unknown>) {
    return this.push({ level: 'info', source, message, meta });
  }

  public warn(source: LogEntry['source'], message: string, meta?: Record<string, unknown>) {
    return this.push({ level: 'warn', source, message, meta });
  }

  public error(source: LogEntry['source'], err: unknown, meta?: Record<string, unknown>): LogEntry {
    const e = err instanceof Error ? err : new Error(String(err));
    return this.push({
      level: 'error',
      source,
      message: e.message,
      stackTrace: e.stack,
      meta,
    });
  }

  public success(source: LogEntry['source'], message: string, meta?: Record<string, unknown>) {
    return this.push({ level: 'success', source, message, meta });
  }

  public debug(source: LogEntry['source'], message: string, meta?: Record<string, unknown>) {
    return this.push({ level: 'debug', source, message, meta });
  }

  public getHistory(limit = 100): LogEntry[] {
    return this.buffer.slice(-limit);
  }

  public getErrors(): LogEntry[] {
    return this.buffer.filter((e) => e.level === 'error');
  }

  public emitSignal(symbol: string, action: 'BUY' | 'SELL', entry: number, sl: number, tp: number, reasoning: string) {
    this.emit({ type: 'signal', symbol, action, entry, sl, tp, reasoning });
  }

  public emitTick(
    symbol: string,
    status: 'scanning' | 'approved' | 'rejected' | 'cooldown' | 'error',
    reason?: string
  ) {
    this.emit({ type: 'tick', symbol, status, reason });
  }

  public emitWatchlist(symbols: string[]) {
    this.emit({ type: 'watchlist', symbols });
  }

  public emitHeal(errorId: string, diagnosis: string, correctedCode?: string) {
    this.emit({ type: 'heal', errorId, diagnosis, correctedCode });
  }

  public clear() {
    this.buffer = [];
  }
}

export const logger = new HydraLogger();
