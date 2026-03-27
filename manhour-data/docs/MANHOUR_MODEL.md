# Ridge bin-hours model (retrain from scratch)

This repo ships everything needed to **merge training CSVs**, **fit** the New-build ridge model (v3), and **evaluate** predictions. No separate `ManhourData` folder is required.

## Layout

| Path | Purpose |
|------|--------|
| `model/*.mjs` | Training code (ridge, features, merge, eval, schedule API). |
| `data/bin_hours_2025_parsed.csv` | Current-year / workbook bin rows (from `scripts/parse-bin-hours.ps1` or equivalent). |
| `data/historical_training_filled.csv` | Filled historical jobs (`Drive_hrs_TO_FILL`, `Guys_TO_FILL`, etc.). |
| `bin_hours_parsed.csv` | **Merged** training file (output of merge, input to train). |
| `artifacts/model.json` | Trained coefficients + metadata (commit this for reproducible deploys). |
| `lib/bushelsCornByManufacturer.js` | Brock vs Westeel bushels (used elsewhere; training uses CSV `Bushels_k`). |

## Quick start (after clone)

```bash
cd manhour-data
npm install
npm run merge-training   # data/* → bin_hours_parsed.csv
npm run train            # → artifacts/model.json
npm run eval             # in-sample metrics on bin_hours_parsed.csv
```

Optional:

```bash
npm run eval-future      # synthetic / backlog comparison table → artifacts/future_bins_model_comparison.csv
npm run schedule -- --start 2026-04-15 --jobs jobs_sold.csv --hours-per-week 320
```

## Updating data

1. **Refresh 2025 (or current) bin export**  
   Regenerate `data/bin_hours_2025_parsed.csv` using your Excel workbook + `scripts/parse-bin-hours.ps1` (or your pipeline). Preserve columns: `Customer`, `Drive_hrs`, `Build`, `BinManufacturer`, `Diameter`, `Rings`, `Bushels_k`, `Hours`, `Guys`, specialty flags, `year`.

2. **Historical sheet**  
   Edit `data/historical_training_filled.csv` (same schema as your filled template: `Drive_hrs_TO_FILL`, `Guys_TO_FILL`, …).

3. **Rare mega-bins**  
   Optional anchor rows (e.g. 84×20 Westeel) live in `data/bin_hours_2025_parsed.csv`; re-merge after Excel refresh so they are not lost.

4. **Merge + train**  
   `npm run merge-training && npm run train`

## Model version

v3 features include `Diameter²`, `D×R`, `max(0,D−60)` (large-bin labor), specialty flags, Westeel indicator. See `model/features_bin.mjs` and `artifacts/model.json` → `featureNames`, `beta`.

## App usage

Load `artifacts/model.json` in the app and apply `predictNewBuildHours` / the same feature vector as in `model/features_bin.mjs` (see `model/bin_hours_api.mjs`).
