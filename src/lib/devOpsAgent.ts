import { Ollama } from 'ollama/browser';
import { logger, LogEntry } from './logger';

export type DevOpsDiagnosis = {
  rootCause: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  correctedCode?: string;
  actionPlan: string[];
  relatedErrorPattern?: string;
};

type Client = InstanceType<typeof Ollama>;

/**
 * Pre-compiled heuristics so the DevOps agent can immediately tag
 * known Drizzle / Ollama / Binance error families before invoking
 * the (slow) LLM.
 */
const KNOWN_PATTERNS: Array<{
  pattern: RegExp;
  label: string;
  fix: string;
}> = [
  {
    pattern: /relation ".*" does not exist/i,
    label: 'Drizzle schema not migrated',
    fix: 'Run `pnpm drizzle-kit push` or apply the migration that creates the missing table.',
  },
  {
    pattern: /duplicate key value violates unique constraint/i,
    label: 'Unique constraint violation',
    fix: 'Guard the insert with an upsert: .onConflictDoUpdate() or wrap in a try/catch that logs and skips.',
  },
  {
    pattern: /connect ECONNREFUSED 127\.0\.0\.1:11434/i,
    label: 'Ollama daemon not running',
    fix: 'Start Ollama locally with `ollama serve` and ensure the model is pulled via `ollama pull llama3`.',
  },
  {
    pattern: /model ".*" not found/i,
    label: 'Model missing from Ollama',
    fix: 'Run `ollama pull <model>` to fetch the required model weights locally.',
  },
  {
    pattern: /Unexpected token.*JSON/i,
    label: 'Malformed JSON from LLM',
    fix: 'Wrap the response in the sanitizeJson helper and retry with format: "json" enforced on the model.',
  },
  {
    pattern: /rate.?limit|429/i,
    label: 'Binance rate limit',
    fix: 'Back off exponentially; add a 500ms delay between consecutive pair scans in the daemon tick.',
  },
];

const client: Client = new Ollama({ host: 'http://localhost:11434' });

/**
 * DevOps Agent. Reads a bundle of error entries, matches known
 * patterns, and falls back to the local LLaMA-3 for novel issues.
 */
export class DevOpsAgent {
  /**
   * Heuristic fast-path. Returns a diagnosis without LLM call if a pattern matches.
   */
  private static matchKnownPatterns(text: string): DevOpsDiagnosis | null {
    for (const { pattern, label, fix } of KNOWN_PATTERNS) {
      if (pattern.test(text)) {
        return {
          rootCause: label,
          severity: 'high',
          confidence: 0.92,
          correctedCode: fix,
          actionPlan: [fix],
          relatedErrorPattern: pattern.source,
        };
      }
    }
    return null;
  }

  /**
   * Build a compact log bundle so the LLM doesn't blow its context.
   */
  private static bundleErrors(errors: LogEntry[]): string {
    return errors
      .slice(-5)
      .map(
        (e) =>
          `[${new Date(e.timestamp).toISOString()}][${e.source}][${e.level}] ${e.message}\n${
            e.stackTrace ? e.stackTrace.slice(0, 800) : ''
          }`
      )
      .join('\n---\n');
  }

  /**
   * Extract fenced code blocks from the LLM response.
   */
  private static extractCode(raw: string): string | undefined {
    const match = raw.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Diagnose a single error entry. Returns a structured DevOpsDiagnosis.
   */
  public static async diagnose(error: LogEntry): Promise<DevOpsDiagnosis> {
    const text = `${error.message}\n${error.stackTrace ?? ''}`;

    // Fast path: known pattern.
    const quick = this.matchKnownPatterns(text);
    if (quick) {
      logger.info('devops', `Pattern-matched: ${quick.rootCause} (confidence ${quick.confidence})`);
      return quick;
    }

    // Slow path: LLaMA-3 JSON-enforced analysis.
    const prompt = `You are an elite Node.js / TypeScript / Drizzle ORM DevOps engineer.
A local trading daemon crashed with the following log bundle:

"""
${this.bundleErrors([error])}
"""

Diagnose the root cause and produce corrected TypeScript code.
You MUST respond with a SINGLE JSON object matching this schema exactly:
{
  "rootCause": "string",
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": number,
  "correctedCode": "string (optional TypeScript snippet)",
  "actionPlan": ["string"]
}
Do NOT wrap the JSON in markdown.`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await client.generate({
          model: 'llama3',
          prompt,
          format: 'json',
          system: 'You are a hyper-precise SRE. Output only JSON.',
        });
        const cleaned = res.response.trim().replace(/```(json)?/gi, '');
        const parsed = JSON.parse(cleaned) as DevOpsDiagnosis;
        parsed.confidence = Number(parsed.confidence ?? 0.5);
        parsed.actionPlan = Array.isArray(parsed.actionPlan) ? parsed.actionPlan : [];
        if (!parsed.correctedCode) parsed.correctedCode = this.extractCode(res.response);
        logger.success('devops', `Diagnosis ready: ${parsed.rootCause} (confidence ${parsed.confidence})`);
        return parsed;
      } catch (err) {
        logger.warn(
          'devops',
          `DevOps JSON parse failed (attempt ${attempt + 1}): ${(err as Error).message}`
        );
      }
    }

    return {
      rootCause: 'LLM could not produce a structured diagnosis after 3 retries.',
      severity: 'high',
      confidence: 0.1,
      actionPlan: ['Manually inspect the stack trace.', 'Verify Ollama is running.', 'Check recent schema migrations.'],
    };
  }

  /**
   * Convenience: diagnose the most recent N errors in one batch.
   */
  public static async diagnoseRecent(limit = 3): Promise<DevOpsDiagnosis[]> {
    const errors = logger.getErrors().slice(-limit);
    if (errors.length === 0) {
      return [{
        rootCause: 'No errors in the ring buffer. System appears healthy.',
        severity: 'low',
        confidence: 1,
        actionPlan: [],
      }];
    }
    return Promise.all(errors.map((e) => this.diagnose(e)));
  }
}
