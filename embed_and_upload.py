import os, requests, json
from supabase import create_client

SUPABASE_URL = "https://lcftyeoymplhmzrdfqfs.supabase.co"
SUPABASE_KEY = "sb_publishable_hhOCPPpl5SAqTxpZVdMweQ_tzWLoP_Q"
HF_TOKEN = os.environ.get("HF_TOKEN")  # GitHub Secrets থেকে আসবে

def get_embedding(text):
    response = requests.post(
        "https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2",
        headers={"Authorization": f"Bearer {HF_TOKEN}"},
        json={"inputs": text, "options": {"wait_for_model": True}}
    )
    return response.json()

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

with open("trading_articles.txt", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    line = line.strip()
    if not line:
        continue
    emb = get_embedding(line)
    supabase.table("knowledge_base").insert({
        "content": line,
        "embedding": emb
    }).execute()
    print(f"Uploaded chunk {i+1}")
