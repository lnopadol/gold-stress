#!/usr/bin/env node
// Standalone data refresher — runs in GitHub Actions every 6h.
// Fetches Yahoo Finance + FRED, computes verdict + regimes, writes data/snapshot.json.
// Pure ESM, no deps beyond Node 20 stdlib.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ── Yahoo Finance ────────────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];
const ENDPOINTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
let aIdx = 0, eIdx = 0;
const nextUA = () => USER_AGENTS[(aIdx++) % USER_AGENTS.length];
const nextEP = () => ENDPOINTS[(eIdx++) % ENDPOINTS.length];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function yahooJson(path, retries = 3) {
  for (let i = 1; i <= retries; i++) {
    try {
      const url = `https://${nextEP()}${path}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": nextUA(),
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://finance.yahoo.com/",
          "Origin": "https://finance.yahoo.com",
        },
      });
      if (res.status === 429) {
        console.warn(`429 attempt ${i} ${path}`);
        await sleep(2500);
        continue;
      }
      if (!res.ok) {
        console.warn(`HTTP ${res.status} ${path}`);
        if (i < retries) { await sleep(1500); continue; }
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn(`Fetch err ${i} ${path}: ${err.message}`);
      if (i < retries) { await sleep(1500); continue; }
      return null;
    }
  }
  return null;
}

async function fetchHistory(symbol, range = "3mo") {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const data = await yahooJson(path);
  const c = data?.chart?.result?.[0];
  if (!c) return { meta: null, bars: [] };
  const ts = c.timestamp || [];
  const closes = c.indicators?.quote?.[0]?.close || [];
  const volumes = c.indicators?.quote?.[0]?.volume || [];
  const bars = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    close: closes[i] ?? 0,
    volume: volumes[i] ?? 0,
  })).filter(b => b.close > 0);
  return { meta: c.meta || null, bars };
}

async function fetchAll(symbols) {
  const out = {};
  for (const s of symbols) {
    process.stdout.write(`  ${s} … `);
    const r = await fetchHistory(s, "3mo");
    out[s] = r;
    console.log(r.bars.length ? `${r.bars.length} bars, last $${r.meta?.regularMarketPrice ?? "?"}` : "FAILED");
    await sleep(1500);
  }
  return out;
}

// ── FRED DFII10 ─────────────────────────────────────────────────────────
async function fetchRealYield() {
  try {
    const res = await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10", {
      headers: { "User-Agent": nextUA() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    const lines = csv.trim().split("\n").slice(1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const v = parseFloat(lines[i].split(",")[1]);
      if (Number.isFinite(v)) return v;
    }
  } catch (err) {
    console.warn(`FRED failed: ${err.message}`);
  }
  return 1.85;
}

// ── Math helpers ────────────────────────────────────────────────────────
const pct = (c, p) => (p ? ((c - p) / p) * 100 : 0);
const pctChange = (bars, n) => {
  if (bars.length < n + 1) return 0;
  return pct(bars[bars.length - 1].close, bars[bars.length - 1 - n].close);
};
const avg = (a) => {
  const v = a.filter(n => Number.isFinite(n) && n > 0);
  return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
};
const pctile = (arr, v) => {
  const s = arr.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!s.length) return 0;
  return (s.filter(n => n <= v).length / s.length) * 100;
};
const goldFairFromRealYield = (y) => Math.round(Math.exp(7.95 - 0.30 * y));
const liquidityRegime = (move, vix) => {
  if (vix >= 25 && move >= 110) return "crisis";
  if (move >= 110 && vix < 20) return "elevated";
  return "normal";
};

// ── Series builder (90d) ────────────────────────────────────────────────
function buildSeries(hist) {
  const scaffold = (hist["GLD"]?.bars || []).slice(-90);
  const dates = scaffold.map(b => b.date);
  const at = (sym, date) => {
    const b = hist[sym]?.bars || [];
    const m = b.find(x => x.date === date);
    return m ? m.close : NaN;
  };
  const sf = (sym) => dates.map(d => at(sym, d));
  const ffill = (a) => { let l = NaN; return a.map(v => Number.isFinite(v) ? (l = v, v) : (Number.isFinite(l) ? l : 0)); };

  const gold = sf("GC=F"), gdx = sf("GDX"), gdxj = sf("GDXJ");
  const bz = sf("BZ=F"), cl = sf("CL=F"), ho = sf("HO=F");
  const move = sf("^MOVE"), vix = sf("^VIX"), dxy = sf("DX-Y.NYB");

  return {
    dates,
    gold: ffill(gold), gdx: ffill(gdx), gdxj: ffill(gdxj),
    juniorRatio: ffill(gdxj.map((v, i) => (v && gdx[i] ? v / gdx[i] : NaN))),
    brentDubai: ffill(bz.map((v, i) => (v && cl[i] ? v - cl[i] : NaN))),
    gasoilCrack: ffill(ho.map((v, i) => (v && bz[i] ? v * 42 - bz[i] : NaN))),
    move: ffill(move), vix: ffill(vix), dxy: ffill(dxy),
    goldOilRatio: ffill(gold.map((v, i) => (v && bz[i] ? v / bz[i] : NaN))),
  };
}

// ── Main collect ─────────────────────────────────────────────────────────
async function collect() {
  console.log("→ Fetching Yahoo histories …");
  const symbols = ["GC=F", "GLD", "GDX", "GDXJ", "HO=F", "BZ=F", "CL=F", "DX-Y.NYB", "^MOVE", "^VIX"];
  const hist = await fetchAll(symbols);

  console.log("→ Fetching FRED DFII10 …");
  const realYield10y = await fetchRealYield();
  console.log(`   real yield = ${realYield10y}%`);

  const meta = (s) => hist[s]?.meta;
  const last = (s) => hist[s]?.bars?.[hist[s].bars.length - 1]?.close || meta(s)?.regularMarketPrice || 0;
  const prev = (s) => {
    const b = hist[s]?.bars || [];
    return b[b.length - 2]?.close || meta(s)?.chartPreviousClose || last(s);
  };
  const change1d = (s) => pct(last(s), prev(s));

  // ── Gold ────────────────────────────────────────────────────────────
  const goldPrice = last("GC=F");
  const goldBars = hist["GC=F"]?.bars || [];
  const fairValue = goldFairFromRealYield(realYield10y);
  const gold = {
    price: goldPrice,
    change1d: change1d("GC=F"),
    change7d: pctChange(goldBars, 5),
    change30d: pctChange(goldBars, 22),
    pctFromRef4000: pct(goldPrice, 4000),
    fairValue,
    fairValueGapPct: fairValue ? pct(goldPrice, fairValue) : 0,
  };

  // ── Miners ──────────────────────────────────────────────────────────
  const gdxPrice = last("GDX"), gdxjPrice = last("GDXJ");
  const gdxBars = hist["GDX"]?.bars || [], gdxjBars = hist["GDXJ"]?.bars || [];
  const juniorRatio = gdxPrice ? gdxjPrice / gdxPrice : 0;
  const ratioSeries = [];
  for (let i = 0; i < Math.min(gdxBars.length, gdxjBars.length); i++) {
    const a = gdxjBars[i]?.close, b = gdxBars[i]?.close;
    if (a && b) ratioSeries.push(a / b);
  }
  const juniorRatioMa20 = avg(ratioSeries.slice(-20));
  const ratio20Ago = ratioSeries[ratioSeries.length - 21];
  const juniorMomentum = ratio20Ago ? pct(juniorRatio, ratio20Ago) : 0;
  const gdxC1 = change1d("GDX"), gdxjC1 = change1d("GDXJ"), goldC1 = gold.change1d;
  const leading = goldC1 < 0 && gdxjC1 > gdxC1 && gdxjC1 > goldC1;
  const miners = {
    gdx: gdxPrice, gdxChange7d: pctChange(gdxBars, 5), gdxChange30d: pctChange(gdxBars, 22),
    gdxj: gdxjPrice, gdxjChange7d: pctChange(gdxjBars, 5), gdxjChange30d: pctChange(gdxjBars, 22),
    juniorRatio, juniorRatioMa20, juniorMomentum, leading,
  };

  // ── Crude ───────────────────────────────────────────────────────────
  const bzPrice = last("BZ=F"), clPrice = last("CL=F");
  const bzBars = hist["BZ=F"]?.bars || [], clBars = hist["CL=F"]?.bars || [];
  const brentDubaiSpread = bzPrice && clPrice ? bzPrice - clPrice : 0;
  const bz7 = bzBars[bzBars.length - 6]?.close || 0, cl7 = clBars[clBars.length - 6]?.close || 0;
  const spread7 = bz7 && cl7 ? bz7 - cl7 : brentDubaiSpread;
  const crude = { brent: bzPrice, wti: clPrice, brentDubaiSpread, spreadChange7d: pct(brentDubaiSpread, spread7) };

  // ── Product (gasoil crack) ──────────────────────────────────────────
  const hoPrice = last("HO=F");
  const hoBars = hist["HO=F"]?.bars || [];
  const gasoilCrack = hoPrice && bzPrice ? hoPrice * 42 - bzPrice : 0;
  const ho7 = hoBars[hoBars.length - 6]?.close || 0;
  const crack7 = ho7 && bz7 ? ho7 * 42 - bz7 : gasoilCrack;
  const ho30 = hoBars[hoBars.length - 23]?.close || 0;
  const bz30 = bzBars[bzBars.length - 23]?.close || 0;
  const crack30 = ho30 && bz30 ? ho30 * 42 - bz30 : gasoilCrack;
  const crackHistSeries = [];
  for (let i = 0; i < Math.min(hoBars.length, bzBars.length); i++) {
    const a = hoBars[i]?.close, b = bzBars[i]?.close;
    if (a && b) crackHistSeries.push(a * 42 - b);
  }
  const crack20MA = avg(crackHistSeries.slice(-20));
  const product = {
    gasoilCrack,
    crackChange7d: pct(gasoilCrack, crack7),
    crackChange30d: pct(gasoilCrack, crack30),
    backwardation: gasoilCrack > crack20MA && gasoilCrack > 25,
  };

  // ── Vol ─────────────────────────────────────────────────────────────
  const moveVal = last("^MOVE"), vixVal = last("^VIX");
  const vol = {
    move: moveVal, vix: vixVal,
    moveVixRatio: vixVal ? moveVal / vixVal : 0,
    movePercentile: moveVal > 130 ? "95th+" : moveVal > 110 ? "85th" : moveVal > 90 ? "70th" : "50th",
  };

  // ── Liquidity / FX ──────────────────────────────────────────────────
  const dxyPrice = last("DX-Y.NYB");
  const dxyBars = hist["DX-Y.NYB"]?.bars || [];
  const goldOilRatio = bzPrice ? goldPrice / bzPrice : 0;
  const gold30 = goldBars[goldBars.length - 23]?.close || 0;
  const goldOil30 = bz30 ? gold30 / bz30 : goldOilRatio;
  const liquidity = {
    dxy: dxyPrice,
    dxyChange7d: pctChange(dxyBars, 5),
    goldOilRatio,
    goldOilChange30d: pct(goldOilRatio, goldOil30),
  };

  // ── ETF flows ───────────────────────────────────────────────────────
  const gldBars = hist["GLD"]?.bars || [];
  const gldPrice = last("GLD");
  const gldVolume = gldBars[gldBars.length - 1]?.volume || 0;
  const recentVols = gldBars.slice(-20).map(d => d.volume).filter(v => v > 0);
  const avgVol = recentVols.length ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : (gldVolume || 1);
  const etfFlows = {
    gldPrice, gldVolume,
    gldChange7d: pctChange(gldBars, 5),
    avgVolume20d: Math.round(avgVol),
    volumeRatio: avgVol > 0 ? Math.round((gldVolume / avgVol) * 100) / 100 : 0,
  };

  // ── Regimes ─────────────────────────────────────────────────────────
  const spreadHistSeries = [];
  for (let i = 0; i < Math.min(bzBars.length, clBars.length); i++) {
    const a = bzBars[i]?.close, b = clBars[i]?.close;
    if (a && b) spreadHistSeries.push(a - b);
  }
  const crudeP = pctile(spreadHistSeries.slice(-90), brentDubaiSpread);
  const productP = pctile(crackHistSeries.slice(-90), gasoilCrack);
  const crudeRegime = crudeP > 90 ? "crisis" : crudeP > 75 ? "elevated" : "normal";
  const productRegime = productP > 90 ? "crisis" : productP > 70 ? "elevated" : "normal";
  const liqRegime = liquidityRegime(moveVal, vixVal);
  const regimes = { crude: crudeRegime, product: productRegime, liquidity: liqRegime };

  // ── Verdict ─────────────────────────────────────────────────────────
  const minersBroken = miners.juniorMomentum < -5 && !miners.leading;
  const productStressed = productRegime !== "normal";
  const fairValueGap = Math.abs(gold.fairValueGapPct);
  let verdict, verdictReason;
  if (fairValueGap < 5) {
    verdict = "thesis_at_risk";
    verdictReason = "Gold has re-anchored to its real-yield model — the structural bid may be weakening.";
  } else if (liqRegime === "crisis") {
    verdict = "thesis_at_risk";
    verdictReason = "VIX and MOVE both elevated — funding stress is morphing into a deflationary regime.";
  } else if (productStressed && minersBroken) {
    verdict = "forced_selling";
    verdictReason = "Diesel squeeze persists and juniors keep underperforming — importer USD scramble likely ongoing.";
  } else if (productStressed && !minersBroken) {
    verdict = "bottoming";
    verdictReason = "Product stress still live, but juniors stopped leading the decline — early accumulation possible.";
  } else if (!productStressed && minersBroken) {
    verdict = "thesis_at_risk";
    verdictReason = "Crack spread normalized but miners still broken — risk of structural problem in mining equity.";
  } else {
    verdict = "bottoming";
    verdictReason = "Stress draining out of the plumbing; selling pressure looks largely spent.";
  }

  // ── Falsification ───────────────────────────────────────────────────
  const falsification = {
    crackNormalMinersBroken: {
      tripped: productRegime === "normal" && miners.gdxjChange30d < -15,
      detail: `Crack ${productRegime === "normal" ? "normal" : "elevated"} · GDXJ 30d ${miners.gdxjChange30d.toFixed(1)}%`,
    },
    vixHighCrackFalling: {
      tripped: vixVal >= 25 && product.crackChange30d < -10,
      detail: `VIX ${vixVal.toFixed(1)} · Crack 30d ${product.crackChange30d.toFixed(1)}%`,
    },
    goldTracksRealYield: {
      tripped: fairValueGap < 5,
      detail: `Gold $${Math.round(goldPrice)} vs fair $${fairValue} (gap ${gold.fairValueGapPct.toFixed(1)}%)`,
    },
  };

  // ── Composite ───────────────────────────────────────────────────────
  let compositeScore = verdict === "bottoming" ? 65 : verdict === "forced_selling" ? 35 : 15;
  compositeScore = Math.max(0, Math.min(100, compositeScore + Math.round(miners.juniorMomentum)));

  const series = buildSeries(hist);

  return {
    timestamp: new Date().toISOString(),
    gold, miners, crude, product, vol, liquidity,
    realYield10y, etfFlows, regimes,
    verdict, verdictReason, falsification, series, compositeScore,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
  const data = await collect();
  const out = "data/snapshot.json";
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(data, null, 2));
  console.log(`\n✓ Wrote ${out}`);
  console.log(`  verdict: ${data.verdict}`);
  console.log(`  gold: $${Math.round(data.gold.price)} (fair $${data.gold.fairValue}, gap ${data.gold.fairValueGapPct.toFixed(1)}%)`);
  console.log(`  crack: $${data.product.gasoilCrack.toFixed(1)}, junior ratio: ${data.miners.juniorRatio.toFixed(3)}`);
})().catch(err => { console.error(err); process.exit(1); });
