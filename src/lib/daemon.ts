import { hydra, AgentResponse } from './hydraEngine';
import { fetchOHLCV } from './binance';
import { logger } from './logger';
import { DevOpsAgent } from './devOpsAgent';

/**
 * A signal that has been approved by the CRO and persisted locally.
 * In a production Node backend this would write to `alertLogsTable`.
 */
export type PersistedSignal = {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'BUY' | 'SELL';
  entry: number;
  sl: number;
  tp: number;
  reasoning: string;
  healed?: boolean;
};

/** Anti-spam cooldown in milliseconds. Default: 4 hours. */
const COOLDOWN_MS = 4 * 60 * 60 * 1000;
/** Heartbeat interval in milliseconds. Default: 15 minutes. */
const TICK_INTERVAL_MS = 15 * 60 * 1000;
/** For demo purposes, also expose a fast 30s mode the UI can toggle. */
const FAST_TICK_INTERVAL_MS = 30 * 1000;

const LS_WATCHLIST = 'hydra.watchlist';
const LS_COOLDOWNS = 'hydra.cooldowns';
const LS_SIGNALS = 'hydra.signals';
const LS_FAST_MODE = 'hydra.fastMode';

/**
 * Minimal localStorage wrapper that degrades gracefully in SSR/privacy modes.
 */
const storage = {
  read<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota errors */
    }
  },
};

/**
 * The Autonomous Daemon Heartbeat.
 *
 * Responsibilities:
 *  - Iterates a dynamic watchlist on a 15-minute interval (or 30s in fast mode).
 *  - Enforces a per-coin cooldown (anti-spam).
 *  - Fetches live Binance OHLCV data and routes it through the Hydra pipeline.
 *  - Persists approved signals to local storage (simulating alertLogsTable).
 *  - Self-heals: on error, captures the stack and invokes DevOpsAgent.
 *  - Broadcasts all events to the UI via the central logger.
 */
class HydraDaemon {
  private watchlist: string[] = storage.read<string[]>(LS_WATCHLIST, [
    'BTCUSDT',
    'ETHUSDT',
    'SOLUSDT',
  ]);
  private cooldowns: Record<string, number> = storage.read<Record<string, number>>(LS_COOLDOWNS, {});
  private signals: PersistedSignal[] = storage.read<PersistedSignal[]>(LS_SIGNALS, []);
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isHealing = false;
  private fastMode = storage.read<boolean>(LS_FAST_MODE, false);

  public stats = {
    startedAt: 0,
    tickCount: 0,
    lastTickAt: 0,
    approvedSignals: 0,
    rejectedSignals: 0,
    healedErrors: 0,
  };

  constructor() {
    this.ensureDefaults();
  }

  private ensureDefaults() {
    if (this.watchlist.length === 0) {
      this.watchlist = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
      storage.write(LS_WATCHLIST, this.watchlist);
    }
    logger.emitWatchlist(this.watchlist);
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stats.startedAt = Date.now();
    const interval = this.fastMode ? FAST_TICK_INTERVAL_MS : TICK_INTERVAL_MS;
    this.timer = setInterval(() => this.tick(), interval);
    logger.success(
      'daemon',
      `Daemon started. ${this.fastMode ? 'FAST MODE (30s)' : 'NORMAL MODE (15m)'} interval. Watchlist: ${this.watchlist.join(', ')}`
    );
    // Immediate first tick so the user doesn't have to wait.
    void this.tick();
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    logger.warn('daemon', 'Daemon stopped.');
  }

  public setFastMode(enabled: boolean) {
    this.fastMode = enabled;
    storage.write(LS_FAST_MODE, enabled);
    if (this.isRunning) {
      this.stop();
      this.start();
    }
    logger.info('daemon', `Fast mode ${enabled ? 'ENABLED' : 'DISABLED'}.`);
  }

  public addToWatchlist(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return;
    if (this.watchlist.includes(normalized)) {
      logger.warn('daemon', `${normalized} is already in the watchlist.`);
      return;
    }
    this.watchlist.push(normalized);
    storage.write(LS_WATCHLIST, this.watchlist);
    logger.emitWatchlist(this.watchlist);
    logger.success('daemon', `Added ${normalized} to watchlist.`);
  }

  public removeFromWatchlist(symbol: string) {
    const normalized = symbol.trim().toUpperCase();
    this.watchlist = this.watchlist.filter((s) => s !== normalized);
    storage.write(LS_WATCHLIST, this.watchlist);
    logger.emitWatchlist(this.watchlist);
    logger.warn('daemon', `Removed ${normalized} from watchlist.`);
  }

  public getWatchlist(): string[] {
    return [...this.watchlist];
  }

  public getSignals(): PersistedSignal[] {
    return [...this.signals];
  }

  public clearSignals() {
    this.signals = [];
    storage.write(LS_SIGNALS, this.signals);
    logger.warn('daemon', 'Cleared persisted signals.');
  }

  /**
   * The actual heartbeat. Safe to call manually.
   */
  public async tick(): Promise<void> {
    this.stats.tickCount += 1;
    this.stats.lastTickAt = Date.now();
    logger.info('daemon', `Tick #${this.stats.tickCount} across ${this.watchlist.length} pairs.`);

    for (const symbol of this.watchlist) {
      await this.scanSymbol(symbol);
    }
  }

  private async scanSymbol(symbol: string) {
    // --- Anti-spam gate ----------------------------------------------
    const lastSignal = this.cooldowns[symbol] ?? 0;
    const remainingMs = COOLDOWN_MS - (Date.now() - lastSignal);
    if (remainingMs > 0) {
      const mins = Math.round(remainingMs / 60000);
      logger.emitTick(symbol, 'cooldown', `Next eligible in ${mins}m`);
      logger.debug('daemon', `[cooldown] ${symbol}: ${mins}m remaining` as any);
      return;
    }

    logger.emitTick(symbol, 'scanning');

    try {
      const candles = await fetchOHLCV(symbol, '15m', 50);
      logger.info('daemon', `Fetched ${candles.length} candles for ${symbol}.`);

      const decision: AgentResponse = await hydra.runAnalysis(symbol);
      const lastPrice = candles[candles.length - 1]?.close ?? decision.entry ?? 0;

      if (decision.action === 'WAIT') {
        this.stats.rejectedSignals += 1;
        logger.emitTick(symbol, 'rejected', decision.reasoning);
        logger.info('engine', `${symbol}: WAIT — ${decision.reasoning}`);
        return;
      }

      // Build a conservative SL/TP if the model didn't supply them.
      const entry = decision.entry ?? lastPrice;
      const sl = decision.sl ?? (decision.action === 'BUY' ? entry * 0.99 : entry * 1.01);
      const tp = decision.tp ?? (decision.action === 'BUY' ? entry * 1.03 : entry * 0.97);

      const signal: PersistedSignal = {
        id: `sig_${Date.now()}_${symbol}`,
        timestamp: Date.now(),
        symbol,
        action: decision.action,
        entry,
        sl,
        tp,
        reasoning: decision.reasoning,
      };

      this.persistSignal(signal);
      this.cooldowns[symbol] = Date.now();
      storage.write(LS_COOLDOWNS, this.cooldowns);

      this.stats.approvedSignals += 1;
      logger.emitTick(symbol, 'approved');
      logger.emitSignal(symbol, decision.action, entry, sl, tp, decision.reasoning);
      logger.success(
        'engine',
        `Signal approved for ${symbol}: ${decision.action} @ ${entry.toFixed(2)} | SL ${sl.toFixed(2)} | TP ${tp.toFixed(2)}`
      );
    } catch (err) {
      this.stats.rejectedSignals += 1;
      logger.emitTick(symbol, 'error', (err as Error).message);
      const entry = logger.error('daemon', err, { symbol });
      await this.selfHeal(entry);
    }
  }

  /**
   * Self-healing pipeline. Runs DevOpsAgent on the captured error.
   * Guarded so only one healing pass can run concurrently.
   */
  private async selfHeal(error: ReturnType<typeof logger.error>) {
    if (this.isHealing) return;
    this.isHealing = true;
    this.stats.healedErrors += 1;
    logger.warn('devops', `Initiating self-heal for ${error.id}...`);
    try {
      const diagnosis = await DevOpsAgent.diagnose(error);
      logger.emitHeal(error.id, diagnosis.rootCause, diagnosis.correctedCode);
      logger.info('devops', `Healed ${error.id}: ${diagnosis.rootCause} (conf ${diagnosis.confidence})`);
    } catch (err) {
      logger.error('devops', err, { duringHeal: error.id });
    } finally {
      this.isHealing = false;
    }
  }

  /**
   * Write a signal into the in-memory list + localStorage.
   * Mirrors `await db.insert(alertLogsTable).values(...)` in Node.
   */
  private persistSignal(signal: PersistedSignal) {
    this.signals.unshift(signal);
    if (this.signals.length > 200) this.signals = this.signals.slice(0, 200);
    storage.write(LS_SIGNALS, this.signals);
  }
}

export const daemon = new HydraDaemon();
