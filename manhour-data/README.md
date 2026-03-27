# Man-hour / bin data pipeline

Node scripts that read employee **timesheet** workbooks (Sheet1 daily hours + Sheet2 rollups), merge jobs with trust flags, attach **invoice** line text by order number, and enrich with **bin diameter/rings** parsing plus `bin_hours_for_bin_model` (excludes concrete scope).

This folder is separate from the Vite **BinQuoter** UI in the repo root; run the pipeline from here.

## Bin-hours ridge model (train from clone)

To **merge CSVs**, **retrain** `artifacts/model.json`, and **evaluate** without any external repo:

```bash
cd manhour-data
npm install
npm run merge-training
npm run train
npm run eval
```

See **`docs/MANHOUR_MODEL.md`** for file layout, `data/README.txt` for CSV roles, and `model/` for source. Optional: `npm run eval-future`, `npm run schedule -- --start YYYY-MM-DD`.

## Setup

```bash
cd manhour-data
npm install
```

Place **`.xlsx` timesheets** in this directory (same layout as your local BinData workspace). Invoice workbook: put `2024 Invoices.xlsx` next to the repo root, or under `invoices/`, or set `INVOICES_XLSX` when running attach.

## Common commands

| Command | Purpose |
|--------|---------|
| `npm run merge-training` | Merge `data/bin_hours_2025_parsed.csv` + `data/historical_training_filled.csv` → `bin_hours_parsed.csv` |
| `npm run train` | Ridge fit → `artifacts/model.json` |
| `npm run eval` | In-sample metrics on merged CSV |
| `npm run eval-future` | Backlog / scenario table → `artifacts/future_bins_model_comparison.csv` |
| `npm run schedule` | Backlog week schedule (needs `--start`, see `model/predict_schedule.mjs`) |
| `npm run assemble` | Full repair + process timesheets + job trust + audit |
| `npm run merge-jobs-trust` | Build `output/bin_jobs_clean_2023_2024_combined.csv` |
| `npm run attach-invoice-desc` | Add invoice descriptions by order # |
| `npm run enrich-bin-jobs` | Parse bin size + concrete flag |
| `npm run verify-bin` | Quality report vs 2025 calibration CSV |
| `npm run guess-bins` | Heuristic bin-size guesses from 2025 curve (exploratory) |

Outputs land in **`output/`** (gitignored — regenerate locally). Model artifacts: **`artifacts/model.json`** (committed).

## Calibration data

- `2025 Man Hour Data - 2025 Bin Hours.csv` — measured 2025 builds (reference hours by bin).
- `data/bin_hours_2025_parsed.csv` — parsed workbook rows used when merging training data.

## Docs

- `docs/MANHOUR_MODEL.md` — retrain workflow and model layout.
- `docs/ANALYSIS_PIPELINE_HANDOFF.txt` — integration notes for analysis / Firebase.

## Optional (Windows)

- `scripts/analyze-2025-hours.ps1` — sums 2025 workbook sheets without Excel COM; pass path to `2025 Man Hour Data.xlsx` as first argument.
- `scripts/parse-bin-hours.ps1` — builds `bin_hours_parsed`-style CSV from the workbook (point output at `data/bin_hours_2025_parsed.csv` when refreshing).
