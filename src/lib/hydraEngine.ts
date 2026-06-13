import { ChatOllama } from '@langchain/ollama';
import { tool } from '@langchain/core/tools';
import { BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { Ollama } from 'ollama/browser';
import { fetchOHLCV } from './binance';
import { getLocalEmbedding, findSimilarSetups } from './embeddings';

const visionClient = new Ollama({ host: 'http://localhost:11434' });

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
 * Tool: fetch Binance OHLCV candles.
 * Local LLMs are not reliable with live data, so we expose a typed tool.
 */
const binanceOHLCVTool = tool(
  async ({ symbol, interval, limit }) => {
    try {
      const data = await fetchOHLCV(symbol, interval, limit);
      // Return only the last 10 candles to avoid blowing up the context window.
      return JSON.stringify(data.slice(-10));
    } catch (err) {
      return `Error fetching market data: ${(err as Error).message}`;
    }
  },
  {
    name: 'binance_ohlcv',
    description: 'Fetches the latest Binance OHLCV candles for a trading pair.',
    schema: z.object({
      symbol: z.string().describe('The Binance trading pair, e.g. BTCUSDT'),
      interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('15m'),
      limit: z.number().default(50).describe('Number of candles to fetch, max 1000'),
    }),
  }
);

/**
 * Strict JSON schema for the CRO agent.
 */
const croOutputSchema = z.object({
  action: z.enum(['BUY', 'SELL', 'WAIT']),
  symbol: z.string(),
  reasoning: z.string(),
  riskReward: z.number(),
  entry: z.number().optional(),
  sl: z.number().optional(),
  tp: z.number().optional(),
  approved: z.boolean(),
});

export class HydraEngine {
  private baseUrl = 'http://localhost:11434';
  private analystModel = 'llama3';
  private croModel = 'llama3';

  /**
   * Quant Analyst Agent.
   * Uses LangChain tool binding + a manual fallback for local models that do not natively tool-call.
   */
  private async quantAnalyst(symbol: string): Promise<string> {
    const model = new ChatOllama({
      model: this.analystModel,
      temperature: 0.2,
      baseUrl: this.baseUrl,
    });

    // LangChain ChatOllama exposes bindTools for tool-aware inference.
    const modelWithTools = (model as any).bindTools
      ? (model as any).bindTools([binanceOHLCVTool])
      : (model as any).bind({ tools: [binanceOHLCVTool] });

    const messages: BaseMessage[] = [
      new SystemMessage(
        `You are an Elite Quant Analyst. ` +
        `Use the binance_ohlcv tool to retrieve live market data. ` +
        `Analyze Market Structure, Liquidity, Order Blocks, and SMC. ` +
        `Return a concise trade proposal: action, entry, stop-loss, take-profit, and reasoning. ` +
        `If no high-probability setup exists, say WAIT.`
      ),
      new HumanMessage(`Analyze ${symbol.toUpperCase()} on the 15-minute timeframe.`),
    ];

    let response = await modelWithTools.invoke(messages);
    messages.push(response);

    // Manual tool-call loop for local models.
    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const result = await binanceOHLCVTool.invoke(call as any);
        messages.push(
          new ToolMessage({
            tool_call_id: call.id ?? 'unknown',
            content: String(result),
          })
        );
      }
      response = await model.invoke(messages);
    } else {
      // Fallback: force-feed live data if the model ignored the tool.
      const candles = await fetchOHLCV(symbol, '15m', 20);
      messages.push(
        new HumanMessage(
          `Live OHLCV for ${symbol.toUpperCase()}: ${JSON.stringify(candles.slice(-5))}. Analyze this data now.`
        )
      );
      response = await model.invoke(messages);
    }

    return String(response.content);
  }

  /**
   * Chief Risk Officer Agent.
   * Enforces strict JSON output via Zod validation with retries.
   */
  private async chiefRiskOfficer(
    proposal: string,
    symbol: string,
    history: string
  ): Promise<AgentResponse> {
    const model = new ChatOllama({
      model: this.croModel,
      temperature: 0,
      format: 'json',
      baseUrl: this.baseUrl,
    });

    const messages = [
      new SystemMessage(
        `You are the Chief Risk Officer (CRO). ` +
        `You are hyper-conservative. Reject low-probability setups and setups that match past failures. ` +
        `You MUST output ONLY a single JSON object matching this exact schema:\n` +
        `{ "action": "BUY" | "SELL" | "WAIT", "symbol": string, "reasoning": string, "riskReward": number, "entry"?: number, "sl"?: number, "tp"?: number, "approved": boolean }` +
        `\nDo NOT include markdown, commentary, or explanations outside the JSON.`
      ),
      new HumanMessage(
        `Trade Proposal:\n${proposal}\n\nPast similar setups:\n${history}\n\nRender final JSON verdict.`
      ),
    ];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await model.invoke(messages);
        const cleaned = this.sanitizeJson(String(res.content));
        const parsed = croOutputSchema.parse(JSON.parse(cleaned));
        return { ...parsed };
      } catch (err) {
        const errorMsg = (err as Error).message;
        messages.push(
          new HumanMessage(
            `Your previous response was invalid or did not match the schema: ${errorMsg}. Output ONLY valid JSON.`
          )
        );
      }
    }

    return {
      action: 'WAIT',
      symbol: symbol.toUpperCase(),
      reasoning: 'CRO JSON enforcement failed after maximum retries. Defaulting to WAIT.',
      riskReward: 0,
      approved: false,
    };
  }

  /**
   * Strip markdown fences and isolate the JSON object.
   */
  private sanitizeJson(raw: string): string {
    let s = raw.trim();
    s = s.replace(/```(json)?/gi, '');
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      s = s.slice(first, last + 1);
    }
    return s;
  }

  /**
   * Multimodal Vision verification via LLaVA.
   */
  public async verifyChart(base64Image: string, dataPoints: string): Promise<boolean> {
    const response = await visionClient.generate({
      model: 'llava',
      prompt: `Analyze this chart. Does it confirm the following data: ${dataPoints}? Look for Order Blocks and Fair Value Gaps. Reply with "YES" or "NO" and a brief reason.`,
      images: [base64Image],
    });
    return response.response.toUpperCase().includes('YES');
  }

  /**
   * Full pipeline: analyst -> memory recall -> CRO.
   */
  public async runAnalysis(
    symbol: string,
    memories: PastMemory[] = []
  ): Promise<AgentResponse> {
    const upperSymbol = symbol.toUpperCase();
    const proposal = await this.quantAnalyst(upperSymbol);

    // Long-term memory recall via local embeddings.
    const setupText = `${upperSymbol}: ${proposal}`;
    const embedding = await getLocalEmbedding(setupText);
    const similar = await findSimilarSetups(embedding, 3, memories);

    const history =
      similar.length > 0
        ? similar
            .map(
              (m, i) =>
                `${i + 1}. ${m.summary} -> OUTCOME: ${m.outcome} (similarity: ${m.score.toFixed(
                  2
                )})`
            )
            .join('\n')
        : 'No comparable past setups found in vector memory.';

    return this.chiefRiskOfficer(proposal, upperSymbol, history);
  }
}

export const hydra = new HydraEngine();
