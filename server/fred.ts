// FRED DFII10 (10-Year TIPS yield) — free, no auth required.
// Returns latest published value in percent. Falls back to a sane default if unreachable.
import { execSync } from "child_process";

const URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10";
const FALLBACK = 1.85; // last-known good if FRED is down

export async function fetchRealYield10y(): Promise<number> {
  try {
    const csv = execSync(`curl -s --max-time 15 "${URL}"`, { encoding: "utf-8", timeout: 18000 });
    const lines = csv.trim().split("\n").slice(1); // drop header
    // Walk from the bottom; FRED uses "." for missing values
    for (let i = lines.length - 1; i >= 0; i--) {
      const [, valStr] = lines[i].split(",");
      const v = parseFloat(valStr);
      if (Number.isFinite(v)) return v;
    }
  } catch (err: any) {
    console.warn("FRED fetch failed:", err.message?.substring(0, 100));
  }
  console.warn(`Using fallback real yield: ${FALLBACK}%`);
  return FALLBACK;
}
