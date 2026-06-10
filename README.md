# Gold Stress

Liquidity-event monitor for gold and miners. Answers one question:

> Is the current gold selloff a USD-funding scramble by energy importers that's about to exhaust, or is it morphing into something structural?

**Live:** [gold-stress.pplx.app](https://gold-stress.pplx.app)

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

## Data architecture

100% automated, no manual entry, no backend at runtime:

- A **GitHub Actions cron** ([`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml)) runs `scripts/refresh.mjs` every 6 hours.
- The script pulls Yahoo Finance (GC=F, GDX, GDXJ, GLD, HO=F, BZ=F, CL=F, ^MOVE, ^VIX, DX-Y.NYB) and FRED `DFII10` (10-Year TIPS real yield).
- It computes the verdict, regimes, falsification triggers, and 90-day series, then commits `data/snapshot.json` to `main`.
- The static frontend fetches `data/snapshot.json` from `raw.githubusercontent.com` on load and on the **Reload** button.

The cron runs on a clean GitHub IP — sidestepping the cloud-IP rate-limiting that broke direct Yahoo/FRED calls from the published sandbox.

WTI (CL=F) is used as a Dubai proxy and Heating Oil (HO=F) × 42 − Brent as a Singapore gasoil-crack proxy; both are tradable proxies that move with the underlying Platts series.

## Stack

- React + Vite + Tailwind + Recharts (Portfolio Health Check style)
- Static SPA — no server in production
- GitHub Actions + Node 20 for data refresh

## Run locally

```bash
npm install
npm run dev       # local dev server
node scripts/refresh.mjs   # regenerate data/snapshot.json from your machine
```

## Trigger a manual refresh

GitHub → Actions tab → **Refresh data snapshot** → Run workflow.
