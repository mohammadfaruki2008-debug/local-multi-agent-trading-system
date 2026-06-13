const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const HF_TOKEN = import.meta.env.VITE_HF_TOKEN || '';

/**
 * Hugging Face Inference API দিয়ে টেক্সট এম্বেডিং তৈরি
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(
    'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
    }
  );
  if (!response.ok) throw new Error(`Embedding API error: ${response.status}`);
  const data = await response.json();
  return data;
}

/**
 * Supabase REST API দিয়ে সরাসরি vector similarity search
 */
export async function searchKnowledge(queryEmbedding: number[], topK = 3) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/search_knowledge`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: topK,
    }),
  });
  if (!response.ok) {
    console.error('Search error:', response.status);
    return [];
  }
  const data = await response.json();
  return data || [];
}
