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

The **`manhour-data/`** folder contains the Node.js pipeline (timesheets → cleaned job CSV → invoice attach → bin size enrichment). It complements the grain bin quoter UI above.

- **Docs:** [manhour-data/README.md](manhour-data/README.md)
- **Typical flow:** `cd manhour-data && npm install && npm run assemble` (place timesheet `.xlsx` files in that folder first).

Generated CSVs and `node_modules` under `manhour-data/` are gitignored; commit the scripts and calibration CSV only.
