import { fetchOHLCV } from './binance';
// Removed: import { getLocalEmbedding, findSimilarSetups } from './embeddings';

const SPACE_API_URL = 'https://m02006-hydra-brain.hf.space/ask';

export type AgentResponse = {
  action: 'BUY' | 'SELL' | 'WAIT';
  symbol: string;
  reasoning: string;
  riskReward: number;
  entry?: number;
  sl?: number;
  tp?: number;
  approved?: boolean;
};

export type PastMemory = {
  embedding: number[];
  summary: string;
  outcome: string;
};

/**
 * Space API-তে প্রশ্ন পাঠানোর হেল্পার।
 */
async function askSpace(question: string, context: string = ''): Promise<string> {
  const url = `${SPACE_API_URL}?question=${encodeURIComponent(question)}&context=${encodeURIComponent(context)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Space API error: ${res.status}`);
  const data = await res.json();
  return data.answer || '';
}

/**
 * JSON ব্লক পরিষ্কার করে শুধু অবজেক্ট বের করে আনা।
 */
function sanitizeJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/```(json)?/gi, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

export class HydraEngine {
  // ─── Quant Analyst Agent ───────────────────────────────
  private async quantAnalyst(symbol: string): Promise<string> {
    const candles = await fetchOHLCV(symbol, '15m', 20);
    const recentCandles = candles.slice(-10); // context length control
    const context = `Latest 15m OHLCV for ${symbol.toUpperCase()}: ${JSON.stringify(recentCandles)}`;

    const question = `You are an Elite Quant Analyst. Analyze the provided market data for ${symbol.toUpperCase()}. 
    Describe Market Structure, Liquidity, Order Blocks, SMC. 
    Then propose a trade: action (BUY/SELL/WAIT), entry, stop-loss, take-profit, and reasoning. 
    If there's no high-probability setup, say WAIT.`;

    return askSpace(question, context);
  }

  // ─── CRO Agent ──────────────────────────────────────
  private async chiefRiskOfficer(
    proposal: string,
    symbol: string,
    history: string
  ): Promise<AgentResponse> {
    const question = `You are the Chief Risk Officer (CRO). 
    You MUST output ONLY a single JSON object matching this schema:
    {
      "action": "BUY" | "SELL" | "WAIT",
      "symbol": string,
      "reasoning": string,
      "riskReward": number,
      "entry"?: number,
      "sl"?: number,
      "tp"?: number,
      "approved": boolean
    }
    Do NOT include markdown or extra text.`;

    const context = `Trade Proposal:\n${proposal}\n\nPast similar setups:\n${history}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await askSpace(question, context);
        const cleaned = sanitizeJson(raw);
        const parsed = JSON.parse(cleaned);
        return {
          action: parsed.action || 'WAIT',
          symbol: (parsed.symbol || symbol).toUpperCase(),
          reasoning: parsed.reasoning || 'No reasoning provided.',
          riskReward: parsed.riskReward || 0,
          entry: parsed.entry,
          sl: parsed.sl,
          tp: parsed.tp,
          approved: parsed.approved ?? false,
        };
      } catch {
        // retry
      }
    }

    return {
      action: 'WAIT',
      symbol: symbol.toUpperCase(),
      reasoning: 'CRO JSON enforcement failed after 3 retries.',
      riskReward: 0,
      approved: false,
    };
  }

  // ─── DevOps Agent (self‑healing) ─────────────────
  /**
   * Reads recent error logs (simulated here) and asks Space for a code fix.
   * In production, you'd pipe real stderr/db errors.
   */
  public async selfHeal(logSnippet: string): Promise<string | null> {
    if (!logSnippet) return null;
    const question = `You are a Senior DevOps Engineer. The following error log was captured from the trading system:

\`\`\`
${logSnippet}
\`\`\`

Analyze the root cause and output the corrected TypeScript code in a single fenced code block. If no fix is possible, reply "NO_FIX".`;

    const answer = await askSpace(question);
    const codeMatch = answer.match(/```(?:typescript|ts|js)\s*([\s\S]*?)\s*```/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1].trim();
    }
    return answer.includes('NO_FIX') ? null : null; // Could also return the raw answer
  }

  // ─── Vision Verification ──────────────────────────
  /**
   * Verify that the textual market data (OHLCV, indicators) matches a visual chart.
   * Since our current Space model (Mistral‑7B) is text‑only, we use a heuristic:
   * we ask the model to confirm if the data is internally consistent.
   * A real multimodal model (LLaVA) can be added later by changing this method.
   */
  public async verifyChart(base64Image: string, dataPoints: string): Promise<boolean> {
    // We ignore the image for now – Mistral can't process it.
    // We ask a textual consistency question.
    const question = `Given the following market data summary:\n${dataPoints}\n\nIs this data internally consistent and indicative of a genuine Order Block or Fair Value Gap? Reply only with "YES" or "NO".`;
    const answer = await askSpace(question);
    return answer.toUpperCase().includes('YES');
  }

  // ─── Full Pipeline ────────────────────────────────
  public async runAnalysis(
    symbol: string,
    memories: PastMemory[] = []
  ): Promise<AgentResponse> {
    const upperSymbol = symbol.toUpperCase();
    const proposal = await this.quantAnalyst(upperSymbol);

    // Memory (placeholder – embeddings disabled for now)
    const history = memories.length
      ? memories.map((m, i) => `${i + 1}. ${m.summary} -> OUTCOME: ${m.outcome}`).join('\n')
      : 'No comparable past setups found in memory.';

    return this.chiefRiskOfficer(proposal, upperSymbol, history);
  }
}

export const hydra = new HydraEngine();
