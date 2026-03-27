# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

Grain Bin Job Estimator — a React/Vite SPA for tracking grain bin construction man-hours and predicting future labor with Google Gemini AI. See `README.md` for full details.

Two independent npm projects live in one repo:
- **Root** (`/workspace`): Vite + React + TypeScript frontend (port 3000)
- **`manhour-data/`**: Node.js (CommonJS) offline data pipeline for processing timesheet `.xlsx` files

### Running the dev server

```bash
npm run dev          # Vite dev server on http://localhost:3000
```

The app requires a `GEMINI_API_KEY` environment variable for Gemini AI features. Create a `.env.local` file in the repo root:
```
GEMINI_API_KEY=your-key-here
```
Without a valid key, the app will still load and render the UI, but "Predict Hours" and "Get Recommendation" buttons will fail with API errors.

Firebase Firestore is used as the backend database (hardcoded config in `firebaseConfig.ts`). The cloud Firestore instance may have restrictive security rules that prevent writes from unauthenticated clients.

### Build & type-check

```bash
npm run build        # Vite production build → dist/
npx tsc --noEmit     # TypeScript type-checking (no lint script defined)
```

There is no dedicated ESLint config or `npm run lint` script; `npx tsc --noEmit` serves as the primary static analysis check.

### Data pipeline (manhour-data/)

Install separately: `cd manhour-data && npm install`. Requires `.xlsx` timesheet files to be placed in the directory before running. See `manhour-data/README.md` for commands.

### Gotchas

- The `index.html` references `/index.css` which does not exist; styling is 100% Tailwind CDN. The Vite build emits a warning about this but it is harmless.
- No lockfile exists at the repo root — only `manhour-data/package-lock.json` exists. `npm install` at root generates `package-lock.json` on first run.
- No automated test suite is configured (`npm test` is not defined in root `package.json`).
