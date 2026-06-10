// Yahoo Finance data fetcher — uses curl with retry logic and cookie/crumb
import { execSync } from "child_process";

interface QuoteData {
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  averageDailyVolume10Day: number;
  fiftyTwoWeekLow: number;
  fiftyTwoWeekHigh: number;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Rotate user agents to reduce 429 risk
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

let agentIdx = 0;
function nextAgent(): string {
  const ua = USER_AGENTS[agentIdx % USER_AGENTS.length];
  agentIdx++;
  return ua;
}

// Cycle endpoints — query1 vs query2 — to spread load and reduce 429 likelihood.
const ENDPOINTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
let endpointIdx = 0;
function nextEndpoint(): string {
  const e = ENDPOINTS[endpointIdx % ENDPOINTS.length];
  endpointIdx++;
  return e;
}

function curlJson(path: string, retries: number = 2): any {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ua = nextAgent();
      const host = nextEndpoint();
      const url = `https://${host}${path}`;
      const result = execSync(
        `curl -s --max-time 15 ` +
        `-H "User-Agent: ${ua}" ` +
        `-H "Accept: application/json" ` +
        `-H "Accept-Language: en-US,en;q=0.9" ` +
        `-H "Referer: https://finance.yahoo.com/" ` +
        `-H "Origin: https://finance.yahoo.com" ` +
        `"${url}"`,
        { timeout: 18000, encoding: "utf-8" }
      );

      if (result.length < 50 && result.includes("Too Many Requests")) {
        console.warn(`429 attempt ${attempt} ${path}`);
        if (attempt < retries) { execSync(`sleep 2`); continue; }
        return null;
      }
      return JSON.parse(result);
    } catch (err: any) {
      console.error(`Curl error ${attempt} ${path}:`, err.message?.substring(0, 100));
      if (attempt < retries) { execSync(`sleep 2`); continue; }
      return null;
    }
  }
  return null;
}

// Fetch quote data using the v8 chart endpoint
function fetchQuoteSingle(symbol: string): QuoteData {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d&includePrePost=false`;
  const data = curlJson(path);
  
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta) {
    console.error(`No meta for ${symbol}`);
    return { regularMarketPrice: 0, regularMarketChange: 0, regularMarketChangePercent: 0, regularMarketVolume: 0, averageDailyVolume10Day: 0, fiftyTwoWeekLow: 0, fiftyTwoWeekHigh: 0 };
  }
  
  const price = meta.regularMarketPrice ?? 0;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change = price - prevClose;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const volume = meta.regularMarketVolume ?? 0;
  
  return {
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePct,
    regularMarketVolume: volume,
    averageDailyVolume10Day: 0,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
  };
}

// Fetch multiple quotes sequentially with 1.2s delay to avoid throttling
export async function fetchQuotes(symbols: string[]): Promise<Record<string, QuoteData>> {
  const record: Record<string, QuoteData> = {};
  for (const sym of symbols) {
    record[sym] = fetchQuoteSingle(sym);
    await delay(1200);
  }
  return record;
}

// Fetch historical data for a symbol
function fetchHistorySingle(symbol: string, range: string = "3mo", interval: string = "1d"): Array<{ date: string; close: number; volume: number }> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const data = curlJson(path);
  
  const chart = data?.chart?.result?.[0];
  if (!chart) return [];
  
  const timestamps = chart.timestamp || [];
  const closes = chart.indicators?.quote?.[0]?.close || [];
  const volumes = chart.indicators?.quote?.[0]?.volume || [];
  
  return timestamps.map((ts: number, i: number) => ({
    date: new Date(ts * 1000).toISOString().split("T")[0],
    close: closes[i] ?? 0,
    volume: volumes[i] ?? 0,
  })).filter((d: any) => d.close > 0);
}

// Fetch multiple histories sequentially with 1.2s delay to avoid throttling
export async function fetchHistories(symbols: string[], range: string = "3mo"): Promise<Record<string, Array<{ date: string; close: number; volume: number }>>> {
  const record: Record<string, Array<{ date: string; close: number; volume: number }>> = {};
  for (const sym of symbols) {
    record[sym] = fetchHistorySingle(sym, range);
    await delay(1200);
  }
  return record;
}
