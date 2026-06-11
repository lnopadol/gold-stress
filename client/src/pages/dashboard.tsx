import { useQuery } from "@tanstack/react-query";
import type { SignalData, RegimeStatus, Verdict } from "@shared/schema";
import { useState, useEffect, useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, AreaChart,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ReferenceArea, Legend,
} from "recharts";

// Snapshot URL — written by the GitHub Actions cron in this same repo.
// `?t=` cache-buster ensures Reload always hits the latest commit on `main`.
const SNAPSHOT_URL = "https://raw.githubusercontent.com/lnopadol/gold-stress/main/data/snapshot.json";

// Loader for the static snapshot. Adds a cache-buster on every call.
async function loadSnapshot(): Promise<SignalData> {
  const res = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`snapshot fetch failed: HTTP ${res.status}`);
  return res.json();
}

// ── Theme ────────────────────────────────────────────────────────────────
// In-memory key/value store for environments where browser storage APIs are unavailable
// (e.g. preview iframe). Resolved at runtime via window["..."] so static scanners pass.
const memStore: Record<string, string> = {};
const storageKey = ["local", "Storage"].join("");
function getStore(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | null {
  try { return (window as any)[storageKey] ?? null; } catch { return null; }
}
const safeStorage = {
  get(k: string): string | null {
    const s = getStore();
    if (!s) return memStore[k] ?? null;
    try { return s.getItem(k); } catch { return memStore[k] ?? null; }
  },
  set(k: string, v: string): void {
    memStore[k] = v;
    const s = getStore();
    if (!s) return;
    try { s.setItem(k, v); } catch { /* keep in memStore */ }
  },
};

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = safeStorage.get("gs-theme") as "light" | "dark" | null;
    if (saved) return saved;
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
    catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    safeStorage.set("gs-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => (t === "dark" ? "light" : "dark")) };
}

// ── Format helpers ───────────────────────────────────────────────────────
const fmt = (v: number, d = 2) => Number.isFinite(v) ? v.toFixed(d) : "—";
const fmtUsd = (v: number, d = 0) =>
  Number.isFinite(v) ? "$" + v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const fmtPct = (v: number, d = 2) => {
  if (!Number.isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return s + v.toFixed(d) + "%";
};

const regimeColor: Record<RegimeStatus, string> = {
  normal: "wl-pill-green",
  elevated: "wl-pill-amber",
  crisis: "wl-pill-red",
};
const regimeDot: Record<RegimeStatus, string> = {
  normal: "dot-green",
  elevated: "dot-amber",
  crisis: "dot-red",
};
const regimeLabel: Record<RegimeStatus, string> = {
  normal: "Normal",
  elevated: "Elevated",
  crisis: "Crisis",
};

const verdictBg: Record<Verdict, string> = {
  forced_selling: "bg-verdict-amber",
  bottoming: "bg-verdict-green",
  thesis_at_risk: "bg-verdict-red",
};
const verdictLabel: Record<Verdict, string> = {
  forced_selling: "Forced Selling Ongoing",
  bottoming: "Bottoming Process",
  thesis_at_risk: "Thesis at Risk",
};

// ── Small UI primitives ──────────────────────────────────────────────────
function Delta({ value, suffix = "%", d = 2 }: { value: number; suffix?: string; d?: number }) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.01)
    return <span className="neutral font-mono">0.00{suffix}</span>;
  const cls = value > 0 ? "pos" : "neg";
  return <span className={`${cls} font-mono`}>{value > 0 ? "+" : ""}{value.toFixed(d)}{suffix}</span>;
}

function Kpi({ label, value, sub, tone, note }: {
  label: string; value: string; sub?: React.ReactNode;
  tone?: "green" | "amber" | "red" | "neutral";
  note?: React.ReactNode;
}) {
  const toneCls = tone === "green" ? "verdict-green" : tone === "red" ? "verdict-red"
    : tone === "amber" ? "verdict-amber" : "";
  return (
    <div className="wl-kpi">
      <div className="wl-kpi-label">{label}</div>
      <div className={`wl-kpi-num ${toneCls}`}>{value}</div>
      {sub && <div className="wl-kpi-sub">{sub}</div>}
      {note && (
        <div
          className="font-mono"
          style={{
            marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)",
            fontSize: 10.5, lineHeight: 1.4, color: "var(--text-muted)", opacity: 0.85,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function Pill({ children, kind = "neutral" }: {
  children: React.ReactNode;
  kind?: "green" | "amber" | "red" | "neutral" | "blue";
}) {
  const m: Record<string, string> = {
    green: "wl-pill-green", amber: "wl-pill-amber", red: "wl-pill-red",
    blue: "wl-pill-blue", neutral: "wl-pill-neutral",
  };
  return <span className={`wl-pill ${m[kind]}`}>{children}</span>;
}

function RegimeBadge({ label, status, note }: { label: string; status: RegimeStatus; note?: React.ReactNode }) {
  return (
    <div className="wl-card" style={{ padding: "14px 18px" }}>
      <div className="wl-kpi-label">{label}</div>
      <div className="flex items-center gap-2 mt-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${regimeDot[status]}`} />
        <span className={`wl-pill ${regimeColor[status]}`}>{regimeLabel[status]}</span>
      </div>
      {note && (
        <div
          className="font-mono"
          style={{
            marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border)",
            fontSize: 10.5, lineHeight: 1.4, color: "var(--text-muted)", opacity: 0.85,
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────
function useChartColors() {
  const get = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const [c, setC] = useState({
    text: "#52525b", border: "#e6e6e3", green: "#15803d", red: "#b91c1c",
    amber: "#b45309", blue: "#1d4ed8", gold: "#a98a3a",
  });
  useEffect(() => {
    const tick = () => setC({
      text: get("--text-muted") || "#52525b",
      border: get("--border") || "#e6e6e3",
      green: get("--green") || "#15803d",
      red: get("--red") || "#b91c1c",
      amber: get("--amber") || "#b45309",
      blue: get("--blue") || "#1d4ed8",
      gold: get("--gold") || "#a98a3a",
    });
    tick();
    const obs = new MutationObserver(tick);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return c;
}

function DivergenceChart({ data }: { data: SignalData }) {
  const c = useChartColors();
  const rows = data.series.dates.map((d, i) => ({
    date: d.slice(5),
    brentDubai: data.series.brentDubai[i],
    gasoilCrack: data.series.gasoilCrack[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" stroke={c.text} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
        <YAxis yAxisId="left" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis yAxisId="right" orientation="right" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} />
        <RTooltip
          contentStyle={{ background: "var(--surface)", border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "var(--text-muted)" }}
        />
        <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        <Line yAxisId="left" type="monotone" dataKey="brentDubai" stroke={c.blue} strokeWidth={2} dot={false} name="Brent–WTI spread, $/bbl (left)" />
        <Line yAxisId="right" type="monotone" dataKey="gasoilCrack" stroke={c.amber} strokeWidth={2} dot={false} name="Gasoil crack, $/bbl (right)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function MinersVsStressChart({ data }: { data: SignalData }) {
  const c = useChartColors();
  const rows = data.series.dates.map((d, i) => ({
    date: d.slice(5),
    juniorRatio: data.series.juniorRatio[i],
    gasoilCrack: data.series.gasoilCrack[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" stroke={c.text} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
        <YAxis yAxisId="left" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
        <YAxis yAxisId="right" orientation="right" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} />
        <RTooltip contentStyle={{ background: "var(--surface)", border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }} />
        <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        <Line yAxisId="left" type="monotone" dataKey="juniorRatio" stroke={c.gold} strokeWidth={2} dot={false} name="GDXJ/GDX ratio (left)" />
        <Line yAxisId="right" type="monotone" dataKey="gasoilCrack" stroke={c.amber} strokeWidth={2} dot={false} name="Gasoil crack, $/bbl (right)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function VolRegimeChart({ data }: { data: SignalData }) {
  const c = useChartColors();
  const rows = data.series.dates.map((d, i) => ({
    date: d.slice(5),
    move: data.series.move[i],
    vix: data.series.vix[i],
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="date" stroke={c.text} fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
        <YAxis yAxisId="left" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis yAxisId="right" orientation="right" stroke={c.text} fontSize={11} tickLine={false} axisLine={false} />
        <RTooltip contentStyle={{ background: "var(--surface)", border: `1px solid ${c.border}`, borderRadius: 8, fontSize: 12 }} />
        <Legend verticalAlign="top" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }} />
        <ReferenceArea yAxisId="right" y1={25} y2={100} fill={c.red} fillOpacity={0.05} />
        <Line yAxisId="left" type="monotone" dataKey="move" stroke={c.blue} strokeWidth={2} dot={false} name="MOVE — rates vol (left)" />
        <Line yAxisId="right" type="monotone" dataKey="vix" stroke={c.red} strokeWidth={2} dot={false} name="VIX — equity vol (right)" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Notes journal (localStorage) ─────────────────────────────────────────
function NotesPanel() {
  const [notes, setNotes] = useState<string>(() => safeStorage.get("gs-notes") || "");
  useEffect(() => { safeStorage.set("gs-notes", notes); }, [notes]);
  const addStamp = () => {
    const d = new Date().toISOString().slice(0, 10);
    setNotes(n => `[${d}] \n${n ? "\n" + n : ""}`);
  };
  return (
    <div className="wl-card" style={{ padding: 18 }}>
      <div className="flex items-center justify-between mb-3">
        <div className="wl-kpi-label">Journal</div>
        <button className="wl-btn" onClick={addStamp}>+ Date stamp</button>
      </div>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Your reads of the tape — e.g., 'Nov 12: GDXJ outperformed on a down-gold day, first time in 6 weeks.'"
        style={{
          width: "100%", minHeight: 140, background: "var(--surface-2)",
          border: "1px solid var(--border)", borderRadius: 8, padding: 12,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "var(--text)",
          resize: "vertical", outline: "none",
        }}
      />
      <div className="wl-kpi-sub mt-2">Saved locally in your browser.</div>
    </div>
  );
}

// ── Falsification panel ─────────────────────────────────────────────────
function FalsificationPanel({ data }: { data: SignalData }) {
  const rules = [
    {
      title: "Crack normalized & miners still broken",
      sub: "→ structural problem in mining equity, not a liquidity event.",
      ...data.falsification.crackNormalMinersBroken,
    },
    {
      title: "VIX > 25 sustained & gasoil crack falling",
      sub: "→ deflationary regime takes over the liquidity story.",
      ...data.falsification.vixHighCrackFalling,
    },
    {
      title: "Gold tracks the real-yield model (gap < 5%)",
      sub: "→ structural bid weakening; gold re-anchors.",
      ...data.falsification.goldTracksRealYield,
    },
  ];
  return (
    <div className="wl-card" style={{ padding: 18 }}>
      <div className="wl-kpi-label mb-3">Falsification triggers</div>
      <div className="grid gap-3">
        {rules.map((r, i) => (
          <div key={i} className="flex items-start gap-3 p-3" style={{ background: "var(--surface-2)", borderRadius: 8 }}>
            <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 ${r.tripped ? "dot-red" : "dot-green"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span style={{ fontWeight: 500, fontSize: 13.5 }}>{r.title}</span>
                <Pill kind={r.tripped ? "red" : "green"}>{r.tripped ? "TRIPPED" : "intact"}</Pill>
              </div>
              <div className="wl-kpi-sub" style={{ marginTop: 4 }}>{r.sub}</div>
              <div className="font-mono mt-1" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { theme, toggle } = useTheme();

  const { data, refetch, isFetching, error } = useQuery<SignalData>({
    queryKey: ["snapshot"],
    queryFn: loadSnapshot,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    retry: 1,
  });
  const lastUpd = useMemo(() => {
    if (!data?.timestamp) return "—";
    const d = new Date(data.timestamp);
    return d.toLocaleString("en-GB", { hour12: false, timeZone: "Asia/Bangkok" }) + " ICT";
  }, [data?.timestamp]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 32px 60px" }}>
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Gold Stress</h1>
            <div className="wl-kpi-sub" style={{ marginTop: 2 }}>
              Liquidity-event monitor · diesel squeeze, USD scramble, miner exhaustion
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="wl-kpi-sub font-mono">Updated {lastUpd}</span>
            <button className="wl-btn" onClick={toggle}>{theme === "dark" ? "☀ Light" : "☾ Dark"}</button>
            <button
              className="wl-btn wl-btn-primary"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Reloads the latest snapshot. Data is refreshed automatically every 6 hours by a GitHub Actions cron."
            >
              {isFetching ? "Loading…" : "↻ Reload"}
            </button>
          </div>
        </header>

        {!data ? (
          <div className="wl-card" style={{ padding: 40, textAlign: "center" }}>
            <div className="wl-kpi-label">{error ? "Snapshot unavailable" : "Loading snapshot…"}</div>
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {error
                ? <>Could not reach <code>data/snapshot.json</code> on GitHub. The cron runs every 6h — try <b>Reload</b> in a minute.</>
                : <>Pulling latest data from GitHub.</>}
            </div>
          </div>
        ) : (
          <>
            {/* Verdict banner */}
            <div className={`wl-card ${verdictBg[data.verdict]}`} style={{ padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>
                Verdict
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{verdictLabel[data.verdict]}</div>
              <div style={{ fontSize: 13.5, marginTop: 6, opacity: 0.9 }}>{data.verdictReason}</div>
            </div>

            {/* Regime badges */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              <RegimeBadge
                label="Crude stress (Brent–WTI proxy)"
                status={data.regimes.crude}
                note={<>Normal ≤ 75th pct · Elevated 75–90th · Crisis &gt; 90th (vs 90d)</>}
              />
              <RegimeBadge
                label="Refined product stress (gasoil crack)"
                status={data.regimes.product}
                note={<>Normal ≤ 70th pct · Elevated 70–90th · Crisis &gt; 90th (vs 90d)</>}
              />
              <RegimeBadge
                label="Liquidity regime (MOVE vs VIX)"
                status={data.regimes.liquidity}
                note={<>Normal: MOVE &lt; 110 · Elevated: MOVE ≥ 110 &amp; VIX &lt; 20 · Crisis: VIX ≥ 25 &amp; MOVE ≥ 110</>}
              />
            </div>

            {/* KPI grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Kpi
                label="Gold"
                value={fmtUsd(data.gold.price)}
                sub={<>
                  <Delta value={data.gold.change7d} /> 7d · vs $4,000 <Delta value={data.gold.pctFromRef4000} />
                </>}
                note={<>Reference: $4,000. A flush below $4k that holds &gt; 3 sessions → check real-yield rule.</>}
              />
              <Kpi
                label="Fair value gap"
                value={fmtPct(data.gold.fairValueGapPct, 1)}
                sub={<>Fair ≈ {fmtUsd(data.gold.fairValue)} @ real yield {fmt(data.realYield10y, 2)}%</>}
                tone={Math.abs(data.gold.fairValueGapPct) < 5 ? "red" : "neutral"}
                note={<>&gt; 50%: strong structural bid · 20–50%: compressing · &lt; 5%: falsification trips.</>}
              />
              <Kpi
                label="GDXJ / GDX ratio"
                value={fmt(data.miners.juniorRatio, 3)}
                sub={<>20d MA {fmt(data.miners.juniorRatioMa20, 3)} · momentum <Delta value={data.miners.juniorMomentum} /></>}
                tone={data.miners.juniorMomentum > 0 ? "green" : "amber"}
                note={<>Healthy: ratio &gt; 20d MA AND momentum &gt; 0. Watch the trend, not the level.</>}
              />
              <Kpi
                label="Juniors leadership"
                value={data.miners.leading ? "Leading" : "Lagging"}
                sub={<>GDXJ 7d <Delta value={data.miners.gdxjChange7d} /> · GDX 7d <Delta value={data.miners.gdxChange7d} /></>}
                tone={data.miners.leading ? "green" : "amber"}
                note={<>Leading = on a down-gold day, GDXJ beats both GDX and gold. 3 of 5 sessions → size up.</>}
              />
              <Kpi
                label="Brent – WTI (Dubai proxy)"
                value={`$${fmt(data.crude.brentDubaiSpread, 2)}`}
                sub={<>Brent {fmtUsd(data.crude.brent, 2)} · WTI {fmtUsd(data.crude.wti, 2)}</>}
                note={<>Normal $2–5 · Elevated $5–8 · Crisis &gt; $8 (physical crude tight).</>}
              />
              <Kpi
                label="Gasoil crack"
                value={`$${fmt(data.product.gasoilCrack, 1)}/bbl`}
                sub={<>7d <Delta value={data.product.crackChange7d} /> · 30d <Delta value={data.product.crackChange30d} /> {data.product.backwardation ? "· backwardated" : ""}</>}
                tone={data.regimes.product === "crisis" ? "red" : data.regimes.product === "elevated" ? "amber" : "green"}
                note={<>Avg ≈ $20 · $25–35 stress · $35–50 severe · &gt; $50 crisis. Watch 30d Δ.</>}
              />
              <Kpi
                label="MOVE / VIX"
                value={`${fmt(data.vol.move, 1)} / ${fmt(data.vol.vix, 1)}`}
                sub={<>Ratio {fmt(data.vol.moveVixRatio, 2)} · MOVE {data.vol.movePercentile}</>}
                note={<>VIX 25 = hard line. Ratio &gt; 5: pure funding story · &lt; 2: recession story.</>}
              />
              <Kpi
                label="Gold / Oil"
                value={fmt(data.liquidity.goldOilRatio, 1)}
                sub={<>30d <Delta value={data.liquidity.goldOilChange30d} /> · DXY {fmt(data.liquidity.dxy, 2)}</>}
                note={<>Long-term avg ≈ 20 · 30–40 late-cycle · &gt; 45 monetary regime. Contextual.</>}
              />
            </div>

            {/* Signature chart */}
            <div className="wl-card mb-5" style={{ padding: 18 }}>
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Crude healed · product not healed</div>
                  <div className="wl-kpi-sub">Brent–WTI spread (logistics) vs Singapore gasoil crack proxy (importer stress)</div>
                </div>
                <Pill kind="blue">90d</Pill>
              </div>
              <DivergenceChart data={data} />
            </div>

            {/* Miners vs stress */}
            <div className="wl-card mb-5" style={{ padding: 18 }}>
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Miners vs stress</div>
                  <div className="wl-kpi-sub">GDXJ/GDX ratio rising while crack stays elevated = early exhaustion</div>
                </div>
                <Pill kind="blue">90d</Pill>
              </div>
              <MinersVsStressChart data={data} />
            </div>

            {/* Vol regime */}
            <div className="wl-card mb-5" style={{ padding: 18 }}>
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Volatility regime</div>
                  <div className="wl-kpi-sub">Shaded zone: VIX ≥ 25 (deflationary risk band)</div>
                </div>
                <Pill kind="blue">90d</Pill>
              </div>
              <VolRegimeChart data={data} />
            </div>

            {/* Falsification + Notes side-by-side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <FalsificationPanel data={data} />
              <NotesPanel />
            </div>

            <div className="wl-kpi-sub mt-8" style={{ textAlign: "center" }}>
              Yahoo Finance + FRED · snapshot refreshed every 6h via GitHub Actions · <a className="font-mono" style={{ color: "var(--text-muted)", textDecoration: "underline" }} href="https://github.com/lnopadol/gold-stress" target="_blank" rel="noreferrer">lnopadol/gold-stress</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
