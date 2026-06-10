# Gold Stress

Liquidity-event monitor for gold and miners. Answers one question:

> Is the current gold selloff a USD-funding scramble by energy importers that's about to exhaust, or is it morphing into something structural?

## Thesis (in one breath)

Refined-product (diesel/jet) tightness drives energy importers to dump USTs and gold for dollars. Crude logistics heal fast; refined products don't. Watch the divergence between the **Brent–Dubai spread** (crude logistics) and the **Singapore gasoil crack** (refined product stress) — and watch **junior miners** for the first sign that forced selling is done.

## What's on the dashboard

- **Verdict banner** — *Forced Selling / Bottoming / Thesis at Risk* with one-line rationale
- **Regime badges** — Crude stress · Product stress · Liquidity regime
- **8 KPIs** — Gold, fair-value gap vs real-yield model, GDXJ/GDX ratio, juniors leadership, Brent–WTI (Dubai proxy), gasoil crack, MOVE/VIX, Gold/Oil
- **Signature chart** — Crude healed vs product not healed (90d)
- **Miners vs stress** — GDXJ/GDX ratio overlaid on the crack
- **Vol regime** — MOVE vs VIX with the VIX ≥ 25 deflationary band shaded
- **Falsification panel** — three live rules with TRIPPED / intact status
- **Journal** — date-stamped notes (saved in browser)

## Data

100% automated, no manual entry:
- **Yahoo Finance** — GC=F, GDX, GDXJ, GLD, HO=F, BZ=F, CL=F, ^MOVE, ^VIX, DX-Y.NYB
- **FRED `DFII10`** — 10-Year TIPS real yield (CSV, no API key)

WTI (CL=F) is used as a Dubai proxy and Heating Oil (HO=F) × 42 − Brent as a Singapore gasoil-crack proxy; both are tradable proxies that move with the underlying Platts series.

## Stack

- React + Vite + Tailwind + Recharts (Portfolio Health Check style)
- Express + better-sqlite3 (snapshots persisted in `data.db`)
- Yahoo via curl + retry/backoff; FRED via plain CSV

## Run

```bash
npm install
npm run dev
```

Open the printed URL and click **↻ Refresh** to take the first snapshot.
