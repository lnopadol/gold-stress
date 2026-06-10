import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  data: text("data").notNull(),
});

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({ id: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;

export type RegimeStatus = "normal" | "elevated" | "crisis";
export type Verdict = "forced_selling" | "bottoming" | "thesis_at_risk";

export interface TimePoint { date: string; value: number; }

export interface SignalData {
  timestamp: string;

  // Gold complex
  gold: {
    price: number;
    change1d: number;
    change7d: number;
    change30d: number;
    pctFromRef4000: number;        // % vs $4,000 reference
    fairValue: number;             // real-yield-implied gold
    fairValueGapPct: number;       // (gold - fair) / fair * 100
  };

  // Miners
  miners: {
    gdx: number; gdxChange7d: number; gdxChange30d: number;
    gdxj: number; gdxjChange7d: number; gdxjChange30d: number;
    juniorRatio: number;           // GDXJ / GDX
    juniorRatioMa20: number;
    juniorMomentum: number;        // ratio change vs 20d ago (%)
    leading: boolean;              // juniors outperforming on down days
  };

  // Energy / crude logistics
  crude: {
    brent: number;
    wti: number;                   // Dubai proxy
    brentDubaiSpread: number;      // BZ - CL
    spreadChange7d: number;
  };

  // Refined products (the real stress tell)
  product: {
    gasoilCrack: number;           // (HO * 42) - BZ, $/bbl
    crackChange7d: number;
    crackChange30d: number;
    backwardation: boolean;        // crack > 20d MA & rising
  };

  // Volatility regime
  vol: {
    move: number;
    vix: number;
    moveVixRatio: number;
    movePercentile: string;
  };

  // Liquidity / FX
  liquidity: {
    dxy: number;
    dxyChange7d: number;
    goldOilRatio: number;          // GC=F / BZ=F
    goldOilChange30d: number;
  };

  // Real yield model input
  realYield10y: number;            // % e.g. 1.85

  // ETF flows (kept from v1)
  etfFlows: {
    gldPrice: number;
    gldVolume: number;
    gldChange7d: number;
    avgVolume20d: number;
    volumeRatio: number;
  };

  // Regime badges
  regimes: {
    crude: RegimeStatus;
    product: RegimeStatus;
    liquidity: RegimeStatus;
  };

  // Synthesized verdict
  verdict: Verdict;
  verdictReason: string;

  // Falsification rules (live status)
  falsification: {
    crackNormalMinersBroken: { tripped: boolean; detail: string };
    vixHighCrackFalling: { tripped: boolean; detail: string };
    goldTracksRealYield: { tripped: boolean; detail: string };
  };

  // History series (90d) for charts
  series: {
    dates: string[];
    gold: number[];
    gdx: number[];
    gdxj: number[];
    juniorRatio: number[];
    brentDubai: number[];
    gasoilCrack: number[];
    move: number[];
    vix: number[];
    dxy: number[];
    goldOilRatio: number[];
  };

  // Legacy composite kept for back-compat (0-100)
  compositeScore: number;
}
