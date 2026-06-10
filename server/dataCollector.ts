import { fetchQuotes, fetchHistories } from "./yahoo";
import { fetchRealYield10y } from "./fred";
import type { SignalData, RegimeStatus, Verdict } from "@shared/schema";

type HistPt = { date: string; close: number; volume: number };

function pct(curr: number, past: number): number {
  if (!past) return 0;
  return ((curr - past) / past) * 100;
}

function pctChange(hist: HistPt[], daysBack: number): number {
  if (hist.length < daysBack + 1) return 0;
  const c = hist[hist.length - 1].close;
  const p = hist[hist.length - 1 - daysBack]?.close;
  return pct(c, p);
}

function avg(arr: number[]): number {
  const v = arr.filter(n => Number.isFinite(n) && n > 0);
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function pctile(arr: number[], v: number): number {
  const valid = arr.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const below = valid.filter(n => n <= v).length;
  return (below / valid.length) * 100;
}

// Real-yield-implied gold fair value.
// Heuristic log-linear: ln(gold) = a + b * realYield. Calibrated to recent regime:
// realYield 2.0% -> ~$2,000, realYield 0% -> ~$2,800, realYield -1% -> ~$3,500.
// Coefficients chosen so model implies ~$1,000-1,200 at realYield ~4% (the "naive model" the user references).
function goldFairValueFromRealYield(realYield: number): number {
  // ln(P) = 7.95 - 0.30 * y (where y in %)
  const lnP = 7.95 - 0.30 * realYield;
  return Math.round(Math.exp(lnP));
}

function regimeFromZ(v: number, mean: number, std: number, hi = 1.0, crisis = 2.0): RegimeStatus {
  if (!std || !Number.isFinite(v)) return "normal";
  const z = (v - mean) / std;
  if (z >= crisis) return "crisis";
  if (z >= hi) return "elevated";
  return "normal";
}

function liquidityRegime(move: number, vix: number): RegimeStatus {
  // MOVE high + VIX low = funding stress. VIX >25 sustained = deflation risk.
  if (vix >= 25 && move >= 110) return "crisis";        // both stressed = deflation overlay
  if (move >= 110 && vix < 20) return "elevated";       // classic funding stress
  return "normal";
}

function buildSeries(
  hist: Record<string, HistPt[]>,
  realYield: number,
): SignalData["series"] {
  // Use GLD as date scaffold (most reliable trading calendar) then map others onto it.
  const scaffold = (hist["GLD"] || []).slice(-90);
  const dates = scaffold.map(p => p.date);
  const closeOn = (sym: string, date: string): number => {
    const h = hist[sym] || [];
    const m = h.find(p => p.date === date);
    return m ? m.close : NaN;
  };
  const seriesFor = (sym: string) => dates.map(d => closeOn(sym, d));

  const gold = seriesFor("GC=F");
  const gdx = seriesFor("GDX");
  const gdxj = seriesFor("GDXJ");
  const bz = seriesFor("BZ=F");
  const cl = seriesFor("CL=F");
  const ho = seriesFor("HO=F");
  const move = seriesFor("^MOVE");
  const vix = seriesFor("^VIX");
  const dxy = seriesFor("DX-Y.NYB");

  const juniorRatio = gdxj.map((v, i) => (v && gdx[i] ? v / gdx[i] : NaN));
  const brentDubai = bz.map((v, i) => (v && cl[i] ? v - cl[i] : NaN));
  const gasoilCrack = ho.map((v, i) => (v && bz[i] ? v * 42 - bz[i] : NaN));
  const goldOilRatio = gold.map((v, i) => (v && bz[i] ? v / bz[i] : NaN));

  // Forward-fill NaNs for charting continuity
  const ffill = (arr: number[]) => {
    let last = NaN;
    return arr.map(v => {
      if (Number.isFinite(v)) { last = v; return v; }
      return Number.isFinite(last) ? last : 0;
    });
  };

  return {
    dates,
    gold: ffill(gold),
    gdx: ffill(gdx),
    gdxj: ffill(gdxj),
    juniorRatio: ffill(juniorRatio),
    brentDubai: ffill(brentDubai),
    gasoilCrack: ffill(gasoilCrack),
    move: ffill(move),
    vix: ffill(vix),
    dxy: ffill(dxy),
    goldOilRatio: ffill(goldOilRatio),
  };
}

export async function collectAllData(): Promise<SignalData> {
  const quoteSymbols = [
    "GC=F", "^MOVE", "^VIX", "HO=F", "BZ=F", "CL=F",
    "GLD", "GDX", "GDXJ", "DX-Y.NYB",
  ];
  const histSymbols = [
    "GC=F", "GLD", "GDX", "GDXJ", "HO=F", "BZ=F", "CL=F",
    "DX-Y.NYB", "^MOVE", "^VIX",
  ];

  console.log("Fetching quotes...");
  const quotes = await fetchQuotes(quoteSymbols);
  console.log("Fetching history (3mo)...");
  const histories = await fetchHistories(histSymbols, "3mo");
  console.log("Fetching FRED DFII10...");
  const realYield10y = await fetchRealYield10y();

  const goldHist = histories["GC=F"] || [];
  const gldHist = histories["GLD"] || [];
  const gdxHist = histories["GDX"] || [];
  const gdxjHist = histories["GDXJ"] || [];
  const hoHist = histories["HO=F"] || [];
  const bzHist = histories["BZ=F"] || [];
  const clHist = histories["CL=F"] || [];
  const dxyHist = histories["DX-Y.NYB"] || [];

  // ── Gold ───────────────────────────────────────────────────────────────
  const goldPrice = quotes["GC=F"]?.regularMarketPrice || 0;
  const fairValue = goldFairValueFromRealYield(realYield10y);
  const gold = {
    price: goldPrice,
    change1d: quotes["GC=F"]?.regularMarketChangePercent || 0,
    change7d: pctChange(goldHist, 5),
    change30d: pctChange(goldHist, 22),
    pctFromRef4000: pct(goldPrice, 4000),
    fairValue,
    fairValueGapPct: fairValue ? pct(goldPrice, fairValue) : 0,
  };

  // ── Miners ─────────────────────────────────────────────────────────────
  const gdxPrice = quotes["GDX"]?.regularMarketPrice || 0;
  const gdxjPrice = quotes["GDXJ"]?.regularMarketPrice || 0;
  const juniorRatio = gdxPrice ? gdxjPrice / gdxPrice : 0;
  // 20d MA of the ratio
  const ratioSeries: number[] = [];
  for (let i = 0; i < Math.min(gdxHist.length, gdxjHist.length); i++) {
    const a = gdxjHist[i]?.close, b = gdxHist[i]?.close;
    if (a && b) ratioSeries.push(a / b);
  }
  const last20 = ratioSeries.slice(-20);
  const juniorRatioMa20 = avg(last20);
  const ratio20Ago = ratioSeries[ratioSeries.length - 21];
  const juniorMomentum = ratio20Ago ? pct(juniorRatio, ratio20Ago) : 0;
  const gdxChange1d = quotes["GDX"]?.regularMarketChangePercent || 0;
  const gdxjChange1d = quotes["GDXJ"]?.regularMarketChangePercent || 0;
  const goldChange1d = quotes["GC=F"]?.regularMarketChangePercent || 0;
  // Leading = on a down-gold day, juniors fall less than seniors AND less than gold
  const leading = goldChange1d < 0 && gdxjChange1d > gdxChange1d && gdxjChange1d > goldChange1d;
  const miners = {
    gdx: gdxPrice,
    gdxChange7d: pctChange(gdxHist, 5),
    gdxChange30d: pctChange(gdxHist, 22),
    gdxj: gdxjPrice,
    gdxjChange7d: pctChange(gdxjHist, 5),
    gdxjChange30d: pctChange(gdxjHist, 22),
    juniorRatio,
    juniorRatioMa20,
    juniorMomentum,
    leading,
  };

  // ── Crude ──────────────────────────────────────────────────────────────
  const bzPrice = quotes["BZ=F"]?.regularMarketPrice || 0;
  const clPrice = quotes["CL=F"]?.regularMarketPrice || 0;
  const brentDubaiSpread = bzPrice && clPrice ? bzPrice - clPrice : 0;
  const bz7 = bzHist[bzHist.length - 6]?.close || 0;
  const cl7 = clHist[clHist.length - 6]?.close || 0;
  const spread7 = bz7 && cl7 ? bz7 - cl7 : brentDubaiSpread;
  const crude = {
    brent: bzPrice,
    wti: clPrice,
    brentDubaiSpread,
    spreadChange7d: pct(brentDubaiSpread, spread7),
  };

  // ── Refined product (gasoil crack) ─────────────────────────────────────
  const hoPrice = quotes["HO=F"]?.regularMarketPrice || 0;
  const gasoilCrack = hoPrice && bzPrice ? hoPrice * 42 - bzPrice : 0;
  const ho7 = hoHist[hoHist.length - 6]?.close || 0;
  const crack7 = ho7 && bz7 ? ho7 * 42 - bz7 : gasoilCrack;
  const ho30 = hoHist[hoHist.length - 23]?.close || 0;
  const bz30 = bzHist[bzHist.length - 23]?.close || 0;
  const crack30 = ho30 && bz30 ? ho30 * 42 - bz30 : gasoilCrack;
  // Build crack history for percentile + backwardation tell
  const crackHistSeries: number[] = [];
  for (let i = 0; i < Math.min(hoHist.length, bzHist.length); i++) {
    const a = hoHist[i]?.close, b = bzHist[i]?.close;
    if (a && b) crackHistSeries.push(a * 42 - b);
  }
  const crack20MA = avg(crackHistSeries.slice(-20));
  const product = {
    gasoilCrack,
    crackChange7d: pct(gasoilCrack, crack7),
    crackChange30d: pct(gasoilCrack, crack30),
    backwardation: gasoilCrack > crack20MA && gasoilCrack > 25,
  };

  // ── Vol regime ────────────────────────────────────────────────────────
  const moveVal = quotes["^MOVE"]?.regularMarketPrice || 0;
  const vixVal = quotes["^VIX"]?.regularMarketPrice || 0;
  const vol = {
    move: moveVal,
    vix: vixVal,
    moveVixRatio: vixVal ? moveVal / vixVal : 0,
    movePercentile: moveVal > 130 ? "95th+" : moveVal > 110 ? "85th" : moveVal > 90 ? "70th" : "50th",
  };

  // ── Liquidity / FX ────────────────────────────────────────────────────
  const dxyPrice = quotes["DX-Y.NYB"]?.regularMarketPrice || 0;
  const dxy30 = dxyHist[dxyHist.length - 23]?.close || 0;
  const goldOilRatio = bzPrice ? goldPrice / bzPrice : 0;
  const gold30 = goldHist[goldHist.length - 23]?.close || 0;
  const goldOil30 = bz30 ? gold30 / bz30 : goldOilRatio;
  const liquidity = {
    dxy: dxyPrice,
    dxyChange7d: pctChange(dxyHist, 5),
    goldOilRatio,
    goldOilChange30d: pct(goldOilRatio, goldOil30),
  };

  // ── ETF flows (kept) ──────────────────────────────────────────────────
  const gldQ = quotes["GLD"];
  const gldPrice = gldQ?.regularMarketPrice || 0;
  const gldVolume = gldQ?.regularMarketVolume || 0;
  const recentVols = gldHist.slice(-20).map(d => d.volume).filter(v => v > 0);
  const avgVol = recentVols.length ? recentVols.reduce((a, b) => a + b, 0) / recentVols.length : (gldVolume || 1);
  const etfFlows = {
    gldPrice,
    gldVolume,
    gldChange7d: pctChange(gldHist, 5),
    avgVolume20d: Math.round(avgVol),
    volumeRatio: avgVol > 0 ? Math.round((gldVolume / avgVol) * 100) / 100 : 0,
  };

  // ── Regime classification (percentile-based, 90d window) ──────────────
  const spreadHistSeries: number[] = [];
  for (let i = 0; i < Math.min(bzHist.length, clHist.length); i++) {
    const a = bzHist[i]?.close, b = clHist[i]?.close;
    if (a && b) spreadHistSeries.push(a - b);
  }
  const crudeP = pctile(spreadHistSeries.slice(-90), brentDubaiSpread);
  const productP = pctile(crackHistSeries.slice(-90), gasoilCrack);
  const crudeRegime: RegimeStatus = crudeP > 90 ? "crisis" : crudeP > 75 ? "elevated" : "normal";
  const productRegime: RegimeStatus = productP > 90 ? "crisis" : productP > 70 ? "elevated" : "normal";
  const liquidityRegimeVal = liquidityRegime(moveVal, vixVal);
  const regimes = { crude: crudeRegime, product: productRegime, liquidity: liquidityRegimeVal };

  // ── Synthesized verdict ───────────────────────────────────────────────
  let verdict: Verdict;
  let verdictReason: string;
  const minersBroken = miners.juniorMomentum < -5 && !miners.leading;
  const productStressed = productRegime !== "normal";
  const fairValueGap = Math.abs(gold.fairValueGapPct);

  if (fairValueGap < 5) {
    verdict = "thesis_at_risk";
    verdictReason = "Gold has re-anchored to its real-yield model — the structural bid may be weakening.";
  } else if (liquidityRegimeVal === "crisis") {
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

  // ── Falsification triggers ────────────────────────────────────────────
  const crackNormalized = productRegime === "normal";
  const minersBrokenDays = miners.gdxjChange30d < -15;
  const vixHigh = vixVal >= 25;
  const crackFalling = product.crackChange30d < -10;
  const realYieldTrack = fairValueGap < 5;

  const falsification = {
    crackNormalMinersBroken: {
      tripped: crackNormalized && minersBrokenDays,
      detail: `Crack ${crackNormalized ? "normal" : "elevated"} · GDXJ 30d ${miners.gdxjChange30d.toFixed(1)}%`,
    },
    vixHighCrackFalling: {
      tripped: vixHigh && crackFalling,
      detail: `VIX ${vixVal.toFixed(1)} · Crack 30d ${product.crackChange30d.toFixed(1)}%`,
    },
    goldTracksRealYield: {
      tripped: realYieldTrack,
      detail: `Gold $${Math.round(goldPrice)} vs fair $${fairValue} (gap ${gold.fairValueGapPct.toFixed(1)}%)`,
    },
  };

  // ── Series ────────────────────────────────────────────────────────────
  const series = buildSeries(histories, realYield10y);

  // ── Composite (back-compat) ──────────────────────────────────────────
  // 100 = strong "buy the flush", 50 = bottoming, 0 = thesis at risk
  let compositeScore: number;
  if (verdict === "bottoming") compositeScore = 65;
  else if (verdict === "forced_selling") compositeScore = 35;
  else compositeScore = 15;
  // adjust by junior momentum
  compositeScore = Math.max(0, Math.min(100, compositeScore + Math.round(miners.juniorMomentum)));

  console.log("Collected:", {
    gold: goldPrice, fair: fairValue, gap: gold.fairValueGapPct.toFixed(1),
    crackSpread: gasoilCrack.toFixed(1), juniorRatio: juniorRatio.toFixed(3),
    verdict,
  });

  return {
    timestamp: new Date().toISOString(),
    gold, miners, crude, product, vol, liquidity,
    realYield10y, etfFlows, regimes, verdict, verdictReason, falsification,
    series, compositeScore,
  };
}
