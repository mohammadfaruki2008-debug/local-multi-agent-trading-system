import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const supabase = createClient(supabaseUrl, supabaseKey);

const HF_TOKEN = import.meta.env.VITE_HF_TOKEN || ''; // Hugging Face Access Token

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
  return data; // এটি অ্যারেঃ [0.23, -0.11, ...]
}

export async function searchKnowledge(queryEmbedding: number[], topK = 3) {
  const { data, error } = await supabase.rpc('search_knowledge', {
    query_embedding: queryEmbedding,
    match_count: topK
  });
  if (error) console.error('Search error:', error);
  return data || [];
}
