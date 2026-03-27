/**
 * Train ridge regression on historical bin hours (CSV).
 * Writes artifacts/model.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ridgeSolve, rmse } from "./matrix.mjs";
import {
  loadBinTrainingRecords,
  rowToFeaturesNewBuild,
  featureLabelsNewBuild,
} from "./features_bin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function leaveOneOutLambda(records, lambdas) {
  const n = records.length;
  if (n < 3) {
    console.warn("Very few training rows; predictions will be rough.");
  }
  let best = { lambda: 100, err: Infinity };
  for (const lambda of lambdas) {
    let se = 0;
    for (let i = 0; i < n; i++) {
      const train = records.filter((_, j) => j !== i);
      const X = train.map((r) => rowToFeaturesNewBuild(r));
      const y = train.map((r) => Number(r.Hours));
      const beta = ridgeSolve(X, y, lambda);
      const fi = rowToFeaturesNewBuild(records[i]);
      let pred = 0;
      for (let k = 0; k < beta.length; k++) pred += beta[k] * fi[k];
      pred = Math.max(0, pred);
      const actual = Number(records[i].Hours);
      se += (actual - pred) ** 2;
    }
    const err = Math.sqrt(se / n);
    if (err < best.err) best = { lambda, err };
  }
  return best;
}

function main() {
  const csvPath = path.join(ROOT, "bin_hours_parsed.csv");
  const outDir = path.join(ROOT, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });

  const records = loadBinTrainingRecords(csvPath, {
    yearFilter: null,
    buildNewOnly: true,
    defaultGuys: 6,
  });
  console.log(
    `Training on ${records.length} New-build bin jobs (all years in CSV; Old/Extension excluded).`
  );

  const lambdas = [0.1, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000];
  const { lambda, err } = leaveOneOutLambda(records, lambdas);
  console.log(`LOO RMSE ~ ${err.toFixed(1)} h (ridge lambda=${lambda})`);

  const X = records.map((r) => rowToFeaturesNewBuild(r));
  const y = records.map((r) => Number(r.Hours));
  const beta = ridgeSolve(X, y, lambda);
  const trainPred = X.map((row) => {
    let p = 0;
    for (let k = 0; k < beta.length; k++) p += beta[k] * row[k];
    return Math.max(0, p);
  });
  const trainRmse = rmse(y, trainPred);
  console.log(`In-sample RMSE: ${trainRmse.toFixed(1)} h`);

  const model = {
    version: 3,
    trainedAt: new Date().toISOString(),
    trainingRows: records.length,
    scope: "New_build_only",
    yearFilter: null,
    ridgeLambda: lambda,
    looRmseHours: err,
    trainRmseHours: trainRmse,
    featureNames: featureLabelsNewBuild(),
    beta,
    /** Default hours for non-bin rows if hours_override blank */
    defaults: {
      millwright_hours: 60,
      concrete_hours: 130,
    },
    notes:
      "v3: +Diameter_sq/1000 + D*R/1000 + max(0,D-60)/10. Optional: anchor rare mega-bins in data/bin_hours_2025_parsed.csv (e.g. Patron 84x20). Re-run merge-training then train after CSV edits.",
  };

  const outPath = path.join(outDir, "model.json");
  fs.writeFileSync(outPath, JSON.stringify(model, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
}

main();
