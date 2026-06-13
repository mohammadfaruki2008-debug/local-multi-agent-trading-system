export type OHLCV = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

const BASE_URL = 'https://api.binance.com/api/v3';

/**
 * Fetch OHLCV candles from Binance public spot API.
 * No API key required.
 */
export async function fetchOHLCV(
  symbol: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '15m',
  limit = 100
): Promise<OHLCV[]> {
  const url = `${BASE_URL}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance OHLCV request failed: ${res.statusText}`);

  const raw = (await res.json()) as Array<Array<number | string>>;
  return raw.map((c) => ({
    openTime: Number(c[0]),
    open: parseFloat(String(c[1])),
    high: parseFloat(String(c[2])),
    low: parseFloat(String(c[3])),
    close: parseFloat(String(c[4])),
    volume: parseFloat(String(c[5])),
    closeTime: Number(c[6]),
  }));
}

/**
 * Fetch the latest ticker price for a symbol.
 */
export async function fetchPrice(symbol: string): Promise<number> {
  const url = `${BASE_URL}/ticker/price?symbol=${symbol.toUpperCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance price request failed: ${res.statusText}`);
  const data = await res.json() as { price: string };
  return parseFloat(data.price);
}
