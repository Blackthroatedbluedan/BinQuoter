# Man-hour / bin data pipeline

Node scripts that read employee **timesheet** workbooks (Sheet1 daily hours + Sheet2 rollups), merge jobs with trust flags, attach **invoice** line text by order number, and enrich with **bin diameter/rings** parsing plus `bin_hours_for_bin_model` (excludes concrete scope).

This folder is separate from the Vite **BinQuoter** UI in the repo root; run the pipeline from here.

## Setup

```bash
cd manhour-data
npm install
```

Place **`.xlsx` timesheets** in this directory (same layout as your local BinData workspace). Invoice workbook: put `2024 Invoices.xlsx` next to the repo root, or under `invoices/`, or set `INVOICES_XLSX` when running attach.

## Common commands

| Command | Purpose |
|--------|---------|
| `npm run assemble` | Full repair + process timesheets + job trust + audit |
| `npm run merge-jobs-trust` | Build `output/bin_jobs_clean_2023_2024_combined.csv` |
| `npm run attach-invoice-desc` | Add invoice descriptions by order # |
| `npm run enrich-bin-jobs` | Parse bin size + concrete flag |
| `npm run verify-bin` | Quality report vs 2025 calibration CSV |
| `npm run guess-bins` | Heuristic bin-size guesses from 2025 curve (exploratory) |

Outputs land in **`output/`** (gitignored — regenerate locally).

## Calibration data

- `2025 Man Hour Data - 2025 Bin Hours.csv` — measured 2025 builds (reference hours by bin).

## Docs

- `docs/ANALYSIS_PIPELINE_HANDOFF.txt` — integration notes for analysis / Firebase.

## Optional (Windows)

- `scripts/analyze-2025-hours.ps1` — sums 2025 workbook sheets without Excel COM; pass path to `2025 Man Hour Data.xlsx` as first argument.
