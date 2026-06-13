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

def scrape_investopedia():
    articles = []
    try:
        resp = requests.get("https://www.investopedia.com/technical-analysis-4427717", timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        for card in soup.find_all('div', class_='card__content'):
            link = card.find('a', href=True)
            if link:
                title = link.get_text(strip=True)
                url = link['href'] if link['href'].startswith('http') else f"https://www.investopedia.com{link['href']}"
                articles.append(f"TITLE: {title}\nURL: {url}")
    except Exception as e:
        print(f"Investopedia error: {e}")
    return articles

if __name__ == "__main__":
    all_articles = []
    print("Scraping BabyPips...")
    all_articles.extend(scrape_babypips())
    time.sleep(2)
    print("Scraping Investopedia...")
    all_articles.extend(scrape_investopedia())
    
    with open("trading_articles.txt", "w", encoding="utf-8") as f:
        for art in all_articles:
            f.write(art + "\n\n")
    print(f"Saved {len(all_articles)} articles.")
