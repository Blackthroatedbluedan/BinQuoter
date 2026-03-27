<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1QnLWJ2YpLE7FD38dVq64oUASmgtLma9Z

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Man-hour / bin data pipeline

The **`manhour-data/`** folder contains the Node.js pipeline (timesheets → cleaned job CSV → invoice attach → bin size enrichment) and the **ridge bin-hours model** source + training data.

- **Docs:** [manhour-data/README.md](manhour-data/README.md) · [docs/MANHOUR_MODEL.md](manhour-data/docs/MANHOUR_MODEL.md)
- **Retrain model after clone:** `cd manhour-data && npm install && npm run merge-training && npm run train` (writes `artifacts/model.json`).
- **From repo root:** `npm run manhour:train` (after `npm install` in `manhour-data/` once).

Timesheet **outputs** under `manhour-data/output/` stay gitignored; **training CSVs** in `manhour-data/data/`, merged `bin_hours_parsed.csv`, and `model/` are committed so clones can reproduce the model.
