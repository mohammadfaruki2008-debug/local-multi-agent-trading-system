import { Ollama } from 'ollama/browser';

const client = new Ollama({ host: 'http://localhost:11434' });
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Utility for local embeddings via Ollama.
 * Uses 'nomic-embed-text' for fast, offline vectorization.
 */
export async function getLocalEmbedding(text: string): Promise<number[]> {
  try {
    const response = await client.embeddings({
      model: 'nomic-embed-text',
      prompt: text,
    });
    return response.embedding;
  } catch (error) {
    console.error('Failed to generate local embedding:', error);
    // Zero-vector fallback keeps the UI alive when Ollama is not running.
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * In-memory fallback for similarity search.
 * In production, replace with Drizzle + pgvector:
 * db.select().from(tradeMemories).orderBy(cosineDistance(tradeMemories.embedding, embedding)).limit(limit)
 */
export async function findSimilarSetups(embedding: number[], limit: number = 3, memories: Array<{ embedding: number[]; summary: string; outcome: string }> = []) {
  return memories
    .map((m) => ({ ...m, score: cosineSimilarity(embedding, m.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
