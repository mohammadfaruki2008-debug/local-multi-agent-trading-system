import requests
from bs4 import BeautifulSoup
import time

def scrape_babypips():
    articles = []
    try:
        resp = requests.get("https://www.babypips.com/learn/forex", timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        for link in soup.find_all('a', href=True):
            href = link['href']
            if '/learn/forex/' in href and href.endswith('.html'):
                full_url = f"https://www.babypips.com{href}" if href.startswith('/') else href
                articles.append(f"TITLE: {link.get_text(strip=True)}\nURL: {full_url}")
    except Exception as e:
        print(f"BabyPips error: {e}")
    return articles

if __name__ == "__main__":
    all_articles = scrape_babypips()
    with open("trading_articles.txt", "w", encoding="utf-8") as f:
        for art in all_articles:
            f.write(art + "\n\n")
    print(f"Saved {len(all_articles)} articles.")
